import { app, BrowserWindow, shell } from 'electron';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { registerIpc } from './ipc';
import { normalizeExternalUrl } from '../shared/externalLinks';

function openSafeExternal(rawUrl: string): void {
  const url = normalizeExternalUrl(rawUrl);
  if (url) void shell.openExternal(url).catch(console.error);
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
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isExpectedRendererUrl(url, rendererEntryUrl)) return;

    event.preventDefault();
    openSafeExternal(url);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
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
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
