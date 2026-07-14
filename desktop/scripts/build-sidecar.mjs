import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const python = process.env.PYTHON || 'python';
const args = [
  '-m', 'PyInstaller',
  resolve(sourceRoot, 'packaging', 'pyinstaller', 'bossflow-backend.spec'),
  '--noconfirm',
  '--clean',
  '--distpath', resolve(sourceRoot, 'release', 'sidecar'),
  '--workpath', resolve(sourceRoot, 'release', 'pyinstaller-build'),
];
const child = spawn(python, args, {
  cwd: sourceRoot,
  env: { ...process.env, BOSSFLOW_SOURCE_DIR: sourceRoot },
  stdio: 'inherit',
});
child.on('error', (error) => {
  console.error(`无法启动 ${python}。可通过 PYTHON 环境变量指定 Python 路径。`, error);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 1));
