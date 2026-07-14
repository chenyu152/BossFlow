import electron from 'electron';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn(electron, ['.'], {
  cwd: desktopDir,
  env: process.env,
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 1));
