import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function commandExists(command) {
  const probe = process.platform === 'win32' ? 'where' : 'command';
  const args = process.platform === 'win32' ? [command] : ['-v', command];
  return spawnSync(probe, args, {
    stdio: 'ignore',
    shell: process.platform !== 'win32',
  }).status === 0;
}

function sessionBusPath() {
  const address = process.env.DBUS_SESSION_BUS_ADDRESS;
  if (!address?.startsWith('unix:path=')) return '';
  return address.slice('unix:path='.length).split(',')[0];
}

const electronVite = process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite';
let command = electronVite;
let args = ['dev'];
let shell = process.platform === 'win32';

if (process.platform === 'linux') {
  const busPath = sessionBusPath();
  const hasSessionBus = busPath && existsSync(busPath);

  if (!hasSessionBus && commandExists('dbus-run-session')) {
    command = 'dbus-run-session';
    args = [
      '--',
      'sh',
      '-lc',
      'if command -v gnome-keyring-daemon >/dev/null 2>&1; then eval "$(gnome-keyring-daemon --start --components=secrets)"; fi; exec electron-vite dev',
    ];
    shell = false;
  }
}

const result = spawnSync(command, args, {
  stdio: 'inherit',
  shell,
  env: process.env,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
