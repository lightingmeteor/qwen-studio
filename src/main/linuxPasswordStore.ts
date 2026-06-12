import { app } from 'electron';

type CommandLine = Pick<typeof app.commandLine, 'appendSwitch' | 'hasSwitch'>;

export function configureLinuxPasswordStore(
  commandLine: CommandLine = app.commandLine,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'linux') return;
  if (commandLine.hasSwitch('password-store')) return;

  commandLine.appendSwitch('password-store', 'gnome-libsecret');
}
