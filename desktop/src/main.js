// Desktop client: a secure window onto your company's EPC server. No data is stored on this computer except
// the server address, window size and the normal browser session (sign-in token).
const { app, BrowserWindow, Menu, ipcMain, shell, dialog, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG = () => path.join(app.getPath('userData'), 'config.json');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
const loadConfig = () => readJson(CONFIG());
const saveConfig = (c) => { fs.mkdirSync(path.dirname(CONFIG()), { recursive: true }); fs.writeFileSync(CONFIG(), JSON.stringify(c, null, 2)); };

/** Server address: --server=… on the command line, then the user's saved choice, then the address baked in at build time. */
function serverUrl() {
  const arg = process.argv.find((a) => a.startsWith('--server='));
  if (arg) return normalise(arg.slice(9));
  const saved = loadConfig().serverUrl;
  if (saved) return saved;
  const baked = readJson(path.join(process.resourcesPath ?? '', 'server.json')).serverUrl || readJson(path.join(__dirname, '..', 'server.json')).serverUrl;
  return baked ? normalise(baked) : '';
}
function normalise(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const u = new URL(s);
  return u.origin;
}

let win;
function createWindow() {
  const c = loadConfig();
  win = new BrowserWindow({
    width: c.bounds?.width ?? 1360, height: c.bounds?.height ?? 860, x: c.bounds?.x, y: c.bounds?.y,
    minWidth: 960, minHeight: 600, show: false, backgroundColor: '#f7f8f5', title: 'EPC Contracts & Billing',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  if (c.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  const remember = () => { if (!win.isMaximized() && !win.isMinimized()) saveConfig({ ...loadConfig(), bounds: win.getBounds() }); };
  win.on('resize', remember); win.on('move', remember);
  win.on('close', () => saveConfig({ ...loadConfig(), maximized: win.isMaximized() }));

  // Keep the window on the company server; anything else opens in the normal browser.
  const sameOrigin = (url) => { const s = serverUrl(); try { return s && new URL(url).origin === s; } catch { return false; } };
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file://')) return;
    if (!sameOrigin(url)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (sameOrigin(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true } } };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = navigation aborted (normal)
    win.loadFile(path.join(__dirname, 'offline.html'), { query: { server: serverUrl(), error: `${desc} (${code})` } });
  });
  openApp();
}

function openApp() {
  const s = serverUrl();
  if (!s) return win.loadFile(path.join(__dirname, 'setup.html'));
  win.loadURL(s + '/');
}

async function checkServer(url) {
  const res = await net.fetch(url + '/api/health', { cache: 'no-store' });
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw new Error('That address is reachable but is not an EPC Contracts & Billing server.');
}

// Only the app's own setup/offline screens (file://) may use these.
const local = (e) => e.senderFrame?.url?.startsWith('file://');
ipcMain.handle('desktop:current', (e) => !local(e) ? null : ({ serverUrl: serverUrl(), version: app.getVersion() }));
ipcMain.handle('desktop:save-server', async (e, input) => {
  if (!local(e)) return { ok: false, error: 'Not allowed' };
  let url;
  try { url = normalise(input); } catch { return { ok: false, error: 'Enter a web address such as erp.yourcompany.in' }; }
  if (!url) return { ok: false, error: 'Enter the server address your administrator gave you.' };
  try { await checkServer(url); } catch (err) { const ssl = /SSL|CERT/i.test(String(err.message)) && url.startsWith('https:');
    return { ok: false, error: `Could not reach ${url}. ${err.message ?? err}` + (ssl ? ' If your server does not have HTTPS yet, type the address starting with http://' : '') }; }
  saveConfig({ ...loadConfig(), serverUrl: url });
  openApp();
  return { ok: true };
});
ipcMain.handle('desktop:retry', (e) => local(e) && openApp());
ipcMain.handle('desktop:change-server', (e) => local(e) && win.loadFile(path.join(__dirname, 'setup.html')));

function buildMenu() {
  const template = [
    { label: 'File', submenu: [
      { label: 'Home', accelerator: 'Alt+Home', click: () => openApp() },
      { label: 'Change server…', click: () => win.loadFile(path.join(__dirname, 'setup.html')) },
      { type: 'separator' },
      { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => win.webContents.print() },
      { type: 'separator' },
      { role: 'quit', label: 'Exit' },
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [
      { label: 'Back', accelerator: 'Alt+Left', click: () => win.webContents.navigationHistory.canGoBack() && win.webContents.navigationHistory.goBack() },
      { label: 'Forward', accelerator: 'Alt+Right', click: () => win.webContents.navigationHistory.canGoForward() && win.webContents.navigationHistory.goForward() },
      { role: 'reload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
    ] },
    { label: 'Help', submenu: [
      { label: 'About', click: () => dialog.showMessageBox(win, { type: 'info', title: 'About', message: 'EPC Contracts & Billing', detail: `Desktop client ${app.getVersion()}\nServer: ${serverUrl() || 'not set'}` }) },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => { buildMenu(); createWindow(); });
  app.on('window-all-closed', () => app.quit());
}
