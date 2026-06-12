import { app, BrowserWindow, shell } from 'electron';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { registerIpc } from './ipc';
import { normalizeExternalUrl } from '../shared/externalLinks';
import { logError, logInfo, logWarn } from './logger';
import { configureLinuxPasswordStore } from './linuxPasswordStore';

configureLinuxPasswordStore();

function openSafeExternal(rawUrl: string): void {
  const url = normalizeExternalUrl(rawUrl);
  if (url) {
    logInfo('shell.openExternal', { url });
    void shell.openExternal(url).catch((error) => logError('shell.openExternal.failed', { error }));
  }
}

function isExpectedRendererUrl(rawUrl: string, rendererEntryUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (devUrl) return url.origin === new URL(devUrl).origin;

    const entryUrl = new URL(rendererEntryUrl);
    return url.protocol === 'file:' && url.pathname === entryUrl.pathname;
  } catch {
    return false;
  }
}

function createWindow(): void {
  const rendererEntryUrl = process.env['ELECTRON_RENDERER_URL']
    ?? pathToFileURL(join(__dirname, '../renderer/index.html')).toString();
  logInfo('app.window.create', {
    renderer: process.env['ELECTRON_RENDERER_URL'] ? 'dev-server' : 'file',
  });
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Qwen Studio Desktop',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on('ready-to-show', () => {
    logInfo('app.window.ready');
    mainWindow.show();
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isExpectedRendererUrl(url, rendererEntryUrl)) return;

    event.preventDefault();
    logWarn('navigation.external.blocked', { url });
    openSafeExternal(url);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    logInfo('navigation.windowOpen.denied', { url });
    openSafeExternal(url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  logInfo('app.ready', { platform: process.platform, version: app.getVersion() });
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  logInfo('app.windowAllClosed', { platform: process.platform });
  if (process.platform !== 'darwin') app.quit();
});
