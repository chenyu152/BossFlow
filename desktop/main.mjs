import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, shell, Tray } from 'electron';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const isDevelopment = !app.isPackaged;
let mainWindow;
let sidecar;
let backendUrl = '';
let frontendUrl = '';
let runtimeToken = '';
let agentToken = '';
let agentConnectionFile = '';
let packagedSidecarPath = '';
let isQuitting = false;
let tray;
let desktopSettings = {
  openAtLogin: false,
  startMinimized: true,
  keepRunningInTray: false,
};

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function desktopSettingsPath() {
  return join(app.getPath('userData'), 'desktop-settings.json');
}

function agentAccessPath() {
  return join(app.getPath('userData'), 'agent-access.json');
}

function agentRuntimePath() {
  return join(app.getPath('userData'), 'agent-runtime.json');
}

async function loadAgentAccess() {
  try {
    const stored = JSON.parse(await readFile(agentAccessPath(), 'utf8'));
    agentToken = typeof stored.token === 'string' && stored.token.length >= 32 ? stored.token : '';
  } catch {
    agentToken = '';
  }
  if (!agentToken) {
    agentToken = randomBytes(32).toString('base64url');
    await mkdir(dirname(agentAccessPath()), { recursive: true });
    await writeFile(agentAccessPath(), `${JSON.stringify({ token: agentToken }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  }
  agentConnectionFile = agentRuntimePath();
}

async function writeAgentRuntime() {
  if (!agentToken || !backendUrl) return;
  await mkdir(dirname(agentConnectionFile), { recursive: true });
  await writeFile(agentConnectionFile, `${JSON.stringify({
    url: `${backendUrl}/mcp/`,
    token: agentToken,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function normalizeDesktopSettings(value = {}) {
  return {
    openAtLogin: value.openAtLogin === true,
    startMinimized: value.startMinimized !== false,
    keepRunningInTray: value.keepRunningInTray === true,
  };
}

async function loadDesktopSettings() {
  try {
    desktopSettings = normalizeDesktopSettings(JSON.parse(await readFile(desktopSettingsPath(), 'utf8')));
  } catch {
    desktopSettings = normalizeDesktopSettings();
  }
  applyLoginSettings();
}

async function saveDesktopSettings() {
  await mkdir(dirname(desktopSettingsPath()), { recursive: true });
  await writeFile(desktopSettingsPath(), `${JSON.stringify(desktopSettings, null, 2)}\n`, 'utf8');
}

function applyLoginSettings() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({
    open: desktopSettings.openAtLogin,
    path: process.execPath,
    args: ['--hidden'],
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function syncTray() {
  if (!desktopSettings.keepRunningInTray) {
    tray?.destroy();
    tray = undefined;
    return;
  }
  if (tray) return;
  const icon = await app.getFileIcon(process.execPath, { size: 'small' });
  tray = new Tray(icon);
  tray.setToolTip('BossFlow');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 BossFlow', click: showMainWindow },
    { type: 'separator' },
    { label: '退出 BossFlow', click: () => app.quit() },
  ]));
  tray.on('click', showMainWindow);
}

const desktopTheme = {
  dark: {
    backgroundColor: '#07111f',
    titleBarOverlay: { color: '#0c1a2b', symbolColor: '#f2f6fc', height: 48 },
  },
  light: {
    backgroundColor: '#f6f8fb',
    titleBarOverlay: { color: '#ffffff', symbolColor: '#172033', height: 48 },
  },
};

function applyDesktopTheme(theme) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const palette = desktopTheme[theme] || desktopTheme.light;
  mainWindow.setBackgroundColor(palette.backgroundColor);
  if (process.platform !== 'darwin') {
    mainWindow.setTitleBarOverlay(palette.titleBarOverlay);
  }
}

function developmentConfig() {
  const backendPort = process.env.BOSSFLOW_BACKEND_PORT || '8000';
  const frontendPort = process.env.BOSSFLOW_FRONTEND_PORT || '5173';
  return {
    backendUrl: process.env.BOSSFLOW_BACKEND_URL || `http://127.0.0.1:${backendPort}`,
    frontendUrl: process.env.BOSSFLOW_FRONTEND_URL || `http://127.0.0.1:${frontendPort}`,
  };
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : undefined;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForBackend(url, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {
      // The sidecar is expected to take a moment on a cold start.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('BossFlow 后端启动超时。请检查应用日志或重新安装。');
}

function trustedUrl(url) {
  try {
    return new URL(url).origin === new URL(frontendUrl).origin;
  } catch {
    return false;
  }
}

function attachDesktopRuntimeToken() {
  // Keep the capability token in the main process.  This protects the local
  // API from cross-site writes without requiring the React renderer to fetch
  // a token through preload/IPC on every request.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: [`${backendUrl}/*`] },
    (details, callback) => {
      callback({
        requestHeaders: {
          ...details.requestHeaders,
          'X-BossFlow-Token': runtimeToken,
        },
      });
    },
  );
}

async function startPackagedSidecar() {
  const port = await findFreePort();
  const resources = process.resourcesPath;
  const sidecarPath = join(resources, 'backend', 'BossFlowBackend.exe');
  const webDir = join(resources, 'web');
  const workspace = join(app.getPath('documents'), 'BossFlow');
  const resourceDir = join(resources, 'backend', '_internal');

  if (!existsSync(sidecarPath) || !existsSync(join(webDir, 'index.html'))) {
    throw new Error('桌面应用资源不完整。请重新安装 BossFlow。');
  }
  await mkdir(workspace, { recursive: true });

  runtimeToken = randomBytes(32).toString('base64url');
  packagedSidecarPath = sidecarPath;
  backendUrl = `http://127.0.0.1:${port}`;
  frontendUrl = backendUrl;
  sidecar = spawn(sidecarPath, [], {
    cwd: workspace,
    windowsHide: true,
    env: {
      ...process.env,
      BOSSFLOW_DESKTOP: '1',
      BOSSFLOW_HOME: workspace,
      BOSSFLOW_PORT: String(port),
      BOSSFLOW_RESOURCE_DIR: resourceDir,
      BOSSFLOW_RUNTIME_TOKEN: runtimeToken,
      BOSSFLOW_AGENT_TOKEN: agentToken,
      BOSSFLOW_WEB_DIR: webDir,
    },
  });
  sidecar.once('error', (error) => {
    if (!isQuitting) dialog.showErrorBox('BossFlow 后端无法启动', error.message);
  });
  sidecar.once('exit', (code) => {
    if (!isQuitting && code !== 0) {
      dialog.showErrorBox('BossFlow 后端已退出', `后端进程意外退出（代码 ${code ?? 'unknown'}）。`);
    }
  });
  await waitForBackend(backendUrl);
  await writeAgentRuntime();
}

async function createWindow() {
  const initialTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  const initialPalette = desktopTheme[initialTheme];
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform !== 'darwin' ? { titleBarOverlay: initialPalette.titleBarOverlay } : {}),
    backgroundColor: initialPalette.backgroundColor,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.on('close', (event) => {
    if (!isQuitting && desktopSettings.keepRunningInTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  if (process.platform === 'win32') mainWindow.setAccentColor(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!trustedUrl(url)) event.preventDefault();
  });
  await mainWindow.loadURL(frontendUrl);
  const hiddenLoginLaunch = process.argv.includes('--hidden')
    && desktopSettings.openAtLogin
    && desktopSettings.startMinimized
    && desktopSettings.keepRunningInTray;
  if (!hiddenLoginLaunch) mainWindow.show();
}

async function stopPackagedSidecar() {
  if (!sidecar || sidecar.exitCode !== null) {
    await unlink(agentConnectionFile).catch(() => {});
    return;
  }
  try {
    await fetch(`${backendUrl}/api/tasks/stop`, {
      method: 'POST',
      headers: { 'X-BossFlow-Token': runtimeToken },
      signal: AbortSignal.timeout(2500),
    });
  } catch {
    // The process is still terminated below if the graceful request fails.
  }
  // PyInstaller's Windows bootloader can hand work to a child process.  Kill
  // the process tree so a closed desktop window never leaves the local API or
  // a crawler process running in the background.
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const taskkill = spawn('taskkill', ['/pid', String(sidecar.pid), '/t', '/f'], { windowsHide: true });
      taskkill.once('error', resolve);
      taskkill.once('exit', resolve);
    });
  } else {
    sidecar.kill('SIGTERM');
  }
  await unlink(agentConnectionFile).catch(() => {});
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  try {
    await loadDesktopSettings();
    if (isDevelopment) {
      agentConnectionFile = agentRuntimePath();
      agentToken = process.env.BOSSFLOW_AGENT_TOKEN || '';
      const config = developmentConfig();
      backendUrl = config.backendUrl;
      frontendUrl = config.frontendUrl;
      await waitForBackend(backendUrl, 12);
      if (agentToken) await writeAgentRuntime();
    } else {
      await loadAgentAccess();
      await startPackagedSidecar();
      attachDesktopRuntimeToken();
    }
    await createWindow();
    await syncTray();
  } catch (error) {
    dialog.showErrorBox('BossFlow 无法启动', error instanceof Error ? error.message : String(error));
    await stopPackagedSidecar();
    app.quit();
  }
});

ipcMain.on('bossflow:theme-changed', (_event, theme) => {
  if (theme === 'dark' || theme === 'light') applyDesktopTheme(theme);
});

ipcMain.handle('bossflow:desktop-settings:get', () => ({
  supported: true,
  ...desktopSettings,
}));

ipcMain.handle('bossflow:desktop-settings:set', async (_event, value) => {
  desktopSettings = normalizeDesktopSettings(value);
  await saveDesktopSettings();
  applyLoginSettings();
  await syncTray();
  if (!desktopSettings.keepRunningInTray && mainWindow && !mainWindow.isVisible()) showMainWindow();
  return { supported: true, ...desktopSettings };
});

ipcMain.handle('bossflow:agent-access:get', async (event) => {
  if (!trustedUrl(event.senderFrame?.url || '')) throw new Error('Untrusted Agent access request');
  const sourceRoot = resolve(here, '..');
  const command = isDevelopment ? (process.env.PYTHON || 'python') : packagedSidecarPath;
  const args = isDevelopment
    ? [join(sourceRoot, 'backend', 'mcp_stdio_bridge.py')]
    : ['--mcp-stdio-bridge'];
  const supported = Boolean(agentToken && backendUrl && command);
  let server = {
    name: 'BossFlow MCP Server',
    status: supported ? 'unavailable' : 'disabled',
    transport: 'Streamable HTTP + stdio bridge',
    endpoint: supported ? `${backendUrl}/mcp/` : '',
    toolCount: 0,
    resourceCount: 0,
  };
  if (backendUrl) {
    try {
      const response = await fetch(`${backendUrl}/api/mcp/status`);
      if (response.ok) {
        const status = await response.json();
        server = { ...server, ...status, endpoint: `${backendUrl}${status.endpoint || '/mcp/'}` };
      }
    } catch {
      // Keep the unavailable state visible so the renderer can offer retry.
    }
  }
  return {
    supported,
    server,
    endpoint: supported ? `${backendUrl}/mcp/` : '',
    connectionFile: supported ? agentConnectionFile : '',
    stdioConfig: supported ? {
      type: 'stdio',
      command,
      args,
      env: { BOSSFLOW_AGENT_CONNECTION_FILE: agentConnectionFile },
    } : null,
    httpConfig: supported ? {
      type: 'http',
      url: `${backendUrl}/mcp/`,
      headers: { Authorization: `Bearer ${agentToken}` },
    } : null,
  };
});

app.on('second-instance', showMainWindow);

app.on('before-quit', async (event) => {
  if (isQuitting) return;
  if (isDevelopment) {
    isQuitting = true;
    return;
  }
  event.preventDefault();
  isQuitting = true;
  await stopPackagedSidecar();
  app.quit();
});

app.on('window-all-closed', () => {
  if (!desktopSettings.keepRunningInTray) app.quit();
});
