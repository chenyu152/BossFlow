import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const basePython = process.env.BOSSFLOW_PACKAGING_PYTHON || process.env.PYTHON || 'python';
const releaseVenv = resolve(sourceRoot, '.venv-release');
const python = process.platform === 'win32'
  ? resolve(releaseVenv, 'Scripts', 'python.exe')
  : resolve(releaseVenv, 'bin', 'python');
const packagingRequirements = resolve(sourceRoot, 'packaging', 'pyinstaller', 'requirements.txt');
const projectRequirements = resolve(sourceRoot, 'requirements.txt');
const dependencyStamp = resolve(releaseVenv, '.bossflow-requirements.sha256');
const args = [
  '-m', 'PyInstaller',
  resolve(sourceRoot, 'packaging', 'pyinstaller', 'bossflow-backend.spec'),
  '--noconfirm',
  '--clean',
  '--distpath', resolve(sourceRoot, 'release', 'sidecar'),
  '--workpath', resolve(sourceRoot, 'release', 'pyinstaller-build'),
];

function run(command, commandArgs, env = process.env) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, commandArgs, {
      cwd: sourceRoot,
      env,
      stdio: 'inherit',
    });
    child.once('error', rejectRun);
    child.once('exit', (code) => (code === 0
      ? resolveRun()
      : rejectRun(new Error(`${command} exited with ${code}`))));
  });
}

async function requirementsHash() {
  const contents = await Promise.all([
    readFile(packagingRequirements),
    readFile(projectRequirements),
  ]);
  const hash = createHash('sha256');
  contents.forEach((content) => hash.update(content));
  return hash.digest('hex');
}

async function ensureReleaseEnvironment() {
  if (!existsSync(python)) {
    console.log('Creating isolated BossFlow release environment...');
    await run(basePython, ['-m', 'venv', releaseVenv]);
  }

  const expectedStamp = await requirementsHash();
  const currentStamp = await readFile(dependencyStamp, 'utf8').catch(() => '');
  if (currentStamp.trim() !== expectedStamp) {
    console.log('Installing minimal sidecar dependencies...');
    await run(python, [
      '-m', 'pip', 'install', '--disable-pip-version-check',
      '-r', packagingRequirements,
    ]);
    // OpenCV wheels install into the same cv2 directory. A developer may have
    // an old contrib/headless wheel in a reused venv, which leaves duplicate
    // binaries behind even after the normal dependency install.
    await run(python, [
      '-m', 'pip', 'uninstall', '-y',
      'opencv-contrib-python', 'opencv-contrib-python-headless', 'opencv-python-headless',
    ]);
    await run(python, [
      '-m', 'pip', 'install', '--disable-pip-version-check',
      '--force-reinstall', '--no-deps', 'opencv-python==5.0.0.93',
    ]);
    await writeFile(dependencyStamp, `${expectedStamp}\n`, 'utf8');
  }
}

try {
  await ensureReleaseEnvironment();
  await run(python, args, {
    ...process.env,
    BOSSFLOW_SOURCE_DIR: sourceRoot,
  });
} catch (error) {
  console.error('无法构建 BossFlow sidecar。可通过 BOSSFLOW_PACKAGING_PYTHON 指定基础 Python。', error);
  process.exit(1);
}
