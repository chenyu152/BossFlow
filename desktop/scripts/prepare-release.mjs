import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(desktopDir, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: 'inherit',
      // Windows command shims such as npm.cmd require a shell on some Node
      // runtimes; without it the release command can fail with spawn EINVAL.
      shell: process.platform === 'win32',
    });
    child.once('error', rejectRun);
    child.once('exit', (code) => (code === 0 ? resolveRun() : rejectRun(new Error(`${command} exited with ${code}`))));
  });
}

try {
  await run(npm, ['run', 'build'], resolve(sourceRoot, 'bossspider-web'));
  await run('node', ['./scripts/build-sidecar.mjs'], desktopDir);
} catch (error) {
  console.error('BossFlow 发布资源准备失败。', error);
  process.exit(1);
}
