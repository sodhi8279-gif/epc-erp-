// In-app updates. The app reads a small manifest published next to the installer, and if a newer version exists it
// downloads the installer, checks its SHA-256, closes the local database cleanly and runs the installer silently.
// The installer replaces the program files only (data lives elsewhere) and reopens the app.
const { app, dialog, net } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MANIFEST = process.env.EPC_UPDATE_URL || 'https://raw.githubusercontent.com/sodhi8279-gif/epc-erp-/downloads/latest.json';

const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

async function fetchManifest() {
  const r = await net.fetch(MANIFEST + '?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error(`Update check failed (${r.status}).`);
  const m = await r.json();
  if (!m.version || !m.url || !/^[0-9a-f]{64}$/.test(m.sha256 || '')) throw new Error('The update information is incomplete.');
  if (!/^https:\/\/(github\.com|raw\.githubusercontent\.com|objects\.githubusercontent\.com)\//.test(m.url)) throw new Error('The update address is not trusted.');
  return m;
}

async function download(m, win) {
  const file = path.join(os.tmpdir(), `EPC-Contracts-Setup-${m.version}.exe`);
  const r = await net.fetch(m.url, { cache: 'no-store' });
  if (!r.ok || !r.body) throw new Error(`Download failed (${r.status}).`);
  const total = Number(r.headers.get('content-length')) || m.size || 0;
  const hash = crypto.createHash('sha256'); const out = fs.createWriteStream(file);
  let got = 0;
  for await (const chunk of r.body) {
    hash.update(chunk); out.write(chunk); got += chunk.length;
    if (total) win?.setProgressBar(got / total);
  }
  await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
  win?.setProgressBar(-1);
  if (hash.digest('hex') !== m.sha256) { fs.rmSync(file, { force: true }); throw new Error('The downloaded update is damaged (checksum mismatch). Nothing was changed.'); }
  return file;
}

/**
 * @param {{ win: Electron.BrowserWindow, interactive: boolean, beforeInstall: () => Promise<void>, showPage: (name: string, q?: object) => void, restore: () => void }} o
 */
async function check(o) {
  let m;
  try { m = await fetchManifest(); } catch (e) {
    if (o.interactive) dialog.showMessageBox(o.win, { type: 'warning', message: 'Could not check for updates', detail: String(e.message ?? e) });
    return;
  }
  if (!newer(m.version, app.getVersion())) {
    if (o.interactive) dialog.showMessageBox(o.win, { type: 'info', message: 'You have the latest version', detail: `Version ${app.getVersion()}` });
    return;
  }
  if (process.platform !== 'win32') {
    if (o.interactive) dialog.showMessageBox(o.win, { type: 'info', message: `Version ${m.version} is available`, detail: 'Automatic install is available on Windows. Download it from: ' + m.url });
    return;
  }
  const { response } = await dialog.showMessageBox(o.win, {
    type: 'info', buttons: ['Update now', 'Later'], defaultId: 0, cancelId: 1,
    message: `Version ${m.version} is available`,
    detail: `You have ${app.getVersion()}.${m.notes ? '\n\n' + m.notes : ''}\n\nThe app downloads the update (about ${Math.round((m.size || 100e6) / 1e6)} MB), restarts and keeps all your data.`,
  });
  if (response !== 0) return;
  o.showPage('starting.html', { update: m.version });
  let file;
  try { file = await download(m, o.win); } catch (e) {
    await dialog.showMessageBox(o.win, { type: 'error', message: 'Update failed', detail: String(e.message ?? e) });
    return o.restore();
  }
  await o.beforeInstall();
  // /S = silent; the installer closes nothing else, replaces the program files and starts the app again.
  spawn(file, ['/S'], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  app.exit(0);
}

module.exports = { check, newer };
