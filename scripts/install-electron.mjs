import { spawnSync } from 'node:child_process';

const command = process.platform === 'win32' ? 'install-electron.cmd' : 'install-electron';
const env = {
  ...process.env,
  ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
};

const result = spawnSync(command, {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
