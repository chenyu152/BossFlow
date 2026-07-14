import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const isDevelopment = !app.isPackaged;
let mainWindow;
let sidecar;
let backendUrl = '';
let frontendUrl = '';
let runtimeToken = '';
let isQuitting = false;

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
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    webPreferences: {
      preload: join(here, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!trustedUrl(url)) event.preventDefault();
  });
  await mainWindow.loadURL(frontendUrl);
  mainWindow.show();
}

async function stopPackagedSidecar() {
  if (!sidecar || sidecar.exitCode !== null) return;
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
}

ipcMain.handle('bossflow:get-runtime-token', (event) => {
  if (!trustedUrl(event.senderFrame.url)) throw new Error('Untrusted renderer');
  return runtimeToken;
});

app.whenReady().then(async () => {
  try {
    if (isDevelopment) {
      const config = developmentConfig();
      backendUrl = config.backendUrl;
      frontendUrl = config.frontendUrl;
      await waitForBackend(backendUrl, 12);
    } else {
      await startPackagedSidecar();
    }
    await createWindow();
  } catch (error) {
    dialog.showErrorBox('BossFlow 无法启动', error instanceof Error ? error.message : String(error));
    await stopPackagedSidecar();
    app.quit();
  }
});

app.on('before-quit', async (event) => {
  if (isQuitting || isDevelopment) return;
  event.preventDefault();
  isQuitting = true;
  await stopPackagedSidecar();
  app.quit();
});

app.on('window-all-closed', () => app.quit());
