import { describe, expect, it, vi } from 'vitest';
import { configureLinuxPasswordStore } from '../linuxPasswordStore';

function createCommandLine(existingSwitches: string[] = []) {
  return {
    appendSwitch: vi.fn(),
    hasSwitch: vi.fn((name: string) => existingSwitches.includes(name)),
  };
}

describe('configureLinuxPasswordStore', () => {
  it('uses gnome-libsecret on Linux when no password store is configured', () => {
    const commandLine = createCommandLine();

    configureLinuxPasswordStore(commandLine, 'linux');

    expect(commandLine.appendSwitch).toHaveBeenCalledWith('password-store', 'gnome-libsecret');
  });

  it('does not override an explicit password store', () => {
    const commandLine = createCommandLine(['password-store']);

    configureLinuxPasswordStore(commandLine, 'linux');

    expect(commandLine.appendSwitch).not.toHaveBeenCalled();
  });

  it('does nothing outside Linux', () => {
    const commandLine = createCommandLine();

    configureLinuxPasswordStore(commandLine, 'win32');

    expect(commandLine.appendSwitch).not.toHaveBeenCalled();
  });
});
