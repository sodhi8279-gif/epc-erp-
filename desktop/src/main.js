// Desktop client: a secure window onto your company's EPC server. No data is stored on this computer except
// the server address, window size and the normal browser session (sign-in token).
const { app, BrowserWindow, Menu, ipcMain, shell, dialog, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const local = require('./local');
const updater = require('./updater');

const CONFIG = () => path.join(app.getPath('userData'), 'config.json');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
const loadConfig = () => readJson(CONFIG());
const saveConfig = (c) => { fs.mkdirSync(path.dirname(CONFIG()), { recursive: true }); fs.writeFileSync(CONFIG(), JSON.stringify(c, null, 2)); };

/** Server address: --server=… on the command line, then the user's saved choice, then the address baked in at build time. */
let localUrl = '';
/** Where the window points: the local server in this-computer mode, otherwise the company server. */
function serverUrl() {
  if (loadConfig().mode === 'local') return localUrl;
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

const page = (name, query) => win.loadFile(path.join(__dirname, name), query ? { query } : undefined);
function openApp() {
  if (loadConfig().mode === 'local') return openLocal();
  const s = serverUrl();
  if (!s) return page('setup.html');
  win.loadURL(s + '/');
}

let localStarting = false;
async function openLocal() {
  if (localUrl) return win.loadURL(localUrl + '/');
  if (localStarting) return;
  localStarting = true;
  page('starting.html', { first: local.isInitialised() ? '' : '1' });
  try {
    const r = await local.start();
    if (r.needsSetup) page('local-setup.html');
    else { localUrl = r.url; win.loadURL(localUrl + '/'); }
  } catch (err) {
    page('error.html', { error: String(err.message ?? err).slice(0, 3000) });
  } finally { localStarting = false; }
}

async function checkServer(url) {
  const res = await net.fetch(url + '/api/health', { cache: 'no-store' });
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw new Error('That address is reachable but is not an EPC Contracts & Billing server.');
}

// Only the app's own setup/offline screens (file://) may use these.
const isLocalPage = (e) => e.senderFrame?.url?.startsWith('file://');
ipcMain.handle('desktop:current', (e) => !isLocalPage(e) ? null : ({ serverUrl: loadConfig().serverUrl || '', mode: loadConfig().mode || 'server', version: app.getVersion() }));
ipcMain.handle('desktop:save-server', async (e, input) => {
  if (!isLocalPage(e)) return { ok: false, error: 'Not allowed' };
  let url;
  try { url = normalise(input); } catch { return { ok: false, error: 'Enter a web address such as erp.yourcompany.in' }; }
  if (!url) return { ok: false, error: 'Enter the server address your administrator gave you.' };
  try { await checkServer(url); } catch (err) { const ssl = /SSL|CERT/i.test(String(err.message)) && url.startsWith('https:');
    return { ok: false, error: `Could not reach ${url}. ${err.message ?? err}` + (ssl ? ' If your server does not have HTTPS yet, type the address starting with http://' : '') }; }
  saveConfig({ ...loadConfig(), serverUrl: url, mode: 'server' });
  if (localUrl) { localUrl = ''; await local.stop(); }
  openApp();
  return { ok: true };
});
ipcMain.handle('desktop:retry', (e) => isLocalPage(e) && openApp());
ipcMain.handle('desktop:admins', async (e) => (isLocalPage(e) && local.isRunning() ? local.listAdmins() : []));
ipcMain.handle('desktop:reset-admin', async (e, d) => {
  if (!isLocalPage(e) || loadConfig().mode !== 'local' || !local.isRunning()) return { ok: false, error: 'Not available' };
  const password = String(d?.password ?? '');
  if (password.length < 8) return { ok: false, error: 'Use a password of at least 8 characters.' };
  try { await local.resetAdminPassword(String(d?.email ?? ''), password); return { ok: true }; }
  catch (err) { return { ok: false, error: String(err.message ?? err) }; }
});
ipcMain.handle('desktop:use-local', (e) => { if (!isLocalPage(e)) return; saveConfig({ ...loadConfig(), mode: 'local' }); openApp(); });
ipcMain.handle('desktop:local-setup', async (e, d) => {
  if (!isLocalPage(e)) return { ok: false, error: 'Not allowed' };
  const company = String(d?.company ?? '').trim(); const email = String(d?.email ?? '').trim().toLowerCase(); const password = String(d?.password ?? '');
  if (!company) return { ok: false, error: 'Enter your company name.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Enter a valid email address for the administrator.' };
  if (password.length < 8) return { ok: false, error: 'Use a password of at least 8 characters.' };
  try { const r = await local.completeSetup({ company, email, password, demo: !!d.demo }); localUrl = r.url; win.loadURL(localUrl + '/'); return { ok: true }; }
  catch (err) { return { ok: false, error: String(err.message ?? err).slice(0, 1500) }; }
});
ipcMain.handle('desktop:change-server', (e) => isLocalPage(e) && win.loadFile(path.join(__dirname, 'setup.html')));

async function backupLocal() {
  if (loadConfig().mode !== 'local') return dialog.showMessageBox(win, { type: 'info', message: 'Backups of a company server are made on the server.', detail: 'This option is for the "this computer only" mode.' });
  const r = await dialog.showOpenDialog(win, { title: 'Choose a folder for the backup (e.g. a USB drive or OneDrive)', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return;
  page('starting.html', { backup: '1' });
  localUrl = '';
  try { const dest = await local.backup(r.filePaths[0]); await dialog.showMessageBox(win, { type: 'info', message: 'Backup saved', detail: dest }); }
  catch (err) { await dialog.showMessageBox(win, { type: 'error', message: 'Backup failed', detail: String(err.message ?? err) }); }
  openApp();
}

let updating = false;
async function checkUpdates(interactive) {
  if (updating) return;
  updating = true;
  try {
    await updater.check({
      win, interactive,
      showPage: (n, q) => page(n, q),
      restore: () => openApp(),
      beforeInstall: async () => { localUrl = ''; await local.stop(); },
    });
  } finally { updating = false; }
}

function buildMenu() {
  const template = [
    { label: 'File', submenu: [
      { label: 'Home', accelerator: 'Alt+Home', click: () => openApp() },
      { label: 'Change server or mode…', click: () => page('setup.html') },
      { label: 'Back up data on this computer…', click: () => backupLocal() },
      { label: 'Reset administrator password…', click: () => {
        if (loadConfig().mode !== 'local' || !local.isRunning()) return dialog.showMessageBox(win, { type: 'info', message: 'Available in "this computer only" mode', detail: 'On a company server, ask your administrator to reset your password under Users & roles.' });
        page('reset.html');
      } },
      { label: 'Open data folder', click: () => shell.openPath(local.dataDir()) },
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
      { label: 'Check for updates…', click: () => checkUpdates(true) },
      { type: 'separator' },
      { label: 'About', click: () => dialog.showMessageBox(win, { type: 'info', title: 'About', message: 'EPC Contracts & Billing', detail: `Desktop client ${app.getVersion()}\n${loadConfig().mode === 'local' ? 'Mode: this computer only\nData: ' + local.dataDir() : 'Server: ' + (serverUrl() || 'not set')}` }) },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => { buildMenu(); createWindow(); if (app.isPackaged) setTimeout(() => checkUpdates(false), 15000); });
  app.on('window-all-closed', () => app.quit());
  let stopping = false;
  app.on('before-quit', (e) => {
    if (stopping || !localUrl && !local.isInitialised()) return;
    e.preventDefault(); stopping = true;
    local.stop().finally(() => app.exit(0));
  });
}
