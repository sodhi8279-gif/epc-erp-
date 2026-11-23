// Standalone mode: a private PostgreSQL and the EPC server running on this computer only.
// Data lives in %APPDATA%\EPC Contracts & Billing\local (pgdata = database, files = uploaded documents).
const { app } = require('electron');
const { execFile, fork } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { Client } = require('pg');

const WIN = process.platform === 'win32';
const res = (...p) => (app.isPackaged ? path.join(process.resourcesPath, ...p) : path.join(__dirname, '..', ...p));
const PG_BIN = (n) => res('pgsql', 'bin', WIN ? `${n}.exe` : n);
// On Windows keep data under %LOCALAPPDATA%\EPCContracts: a path without '&' or spaces suits PostgreSQL's tools best.
const dataDir = () => (WIN && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'EPCContracts', 'local') : path.join(app.getPath('userData'), 'local'));
const pgData = () => path.join(dataDir(), 'pgdata');
const stateFile = () => path.join(dataDir(), 'local.json');
const logFile = () => path.join(dataDir(), 'postgres.log');

const readState = () => { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch { return null; } };
const writeState = (s) => { fs.mkdirSync(dataDir(), { recursive: true }); fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2), { mode: 0o600 }); };

function run(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...(WIN ? {} : { LD_LIBRARY_PATH: res('pgsql', 'lib') }), ...opts.env };
    execFile(file, args, { env, windowsHide: true, timeout: opts.timeout ?? 120000 }, (err, stdout, stderr) => {
      if (err) { err.message += `\n${stderr || stdout}`; reject(err); } else resolve(stdout);
    });
  });
}
function freePort(preferred) {
  const tryPort = (p) => new Promise((resolve) => {
    const s = net.createServer(); s.unref();
    s.once('error', () => resolve(null));
    s.listen(p, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); });
  });
  return (preferred ? tryPort(preferred) : Promise.resolve(null)).then((p) => p ?? tryPort(0));
}

const isInitialised = () => fs.existsSync(path.join(pgData(), 'PG_VERSION')) && !!readState();
async function initialise() {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.rmSync(pgData(), { recursive: true, force: true });
  const state = { dbPassword: crypto.randomBytes(24).toString('hex'), jwtSecret: crypto.randomBytes(48).toString('hex'), pgPort: null, serverPort: null };
  const pw = path.join(dataDir(), 'pw.tmp');
  fs.writeFileSync(pw, state.dbPassword, { mode: 0o600 });
  try {
    await run(PG_BIN('initdb'), ['-D', pgData(), '-U', 'epc', '-A', 'scram-sha-256', `--pwfile=${pw}`, '-E', 'UTF8', '--no-locale']);
  } finally { fs.rmSync(pw, { force: true }); }
  fs.appendFileSync(path.join(pgData(), 'postgresql.conf'), "\n# EPC desktop\nlisten_addresses = '127.0.0.1'\nunix_socket_directories = ''\nmax_connections = 30\nshared_buffers = 64MB\n");
  writeState(state);
}

let pgPort;
async function startPostgres(state) {
  pgPort = await freePort(state.pgPort);
  if (pgPort !== state.pgPort) writeState({ ...state, pgPort });
  await run(PG_BIN('pg_ctl'), ['start', '-D', pgData(), '-w', '-t', '60', '-l', logFile(), '-o', `-p ${pgPort}`]).catch((e) => {
    let tail = ''; try { tail = fs.readFileSync(logFile(), 'utf8').split('\n').slice(-15).join('\n'); } catch { /* none */ }
    throw new Error(`The local database did not start.\n${e.message}\n${tail}`);
  });
}
async function stopPostgres() {
  if (!fs.existsSync(path.join(pgData(), 'postmaster.pid'))) return;
  await run(PG_BIN('pg_ctl'), ['stop', '-D', pgData(), '-m', 'fast', '-w', '-t', '30']).catch(() => undefined);
}
const dbUrl = (state, db = 'epc') => `postgresql://epc:${state.dbPassword}@127.0.0.1:${pgPort}/${db}`;

/** Applies prisma/migrations in order, recording them in _prisma_migrations exactly as `prisma migrate deploy` does. */
async function migrate(state) {
  const admin = new Client({ connectionString: dbUrl(state, 'postgres') });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'epc'");
  if (!exists.rowCount) await admin.query('CREATE DATABASE epc');
  await admin.end();
  const c = new Client({ connectionString: dbUrl(state) });
  await c.connect();
  try {
    await c.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL, "checksum" VARCHAR(64) NOT NULL, "finished_at" TIMESTAMPTZ, "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT, "rolled_back_at" TIMESTAMPTZ, "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`);
    const done = new Set((await c.query('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows.map((r) => r.migration_name));
    const dir = res('local', 'migrations');
    for (const name of fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'migration.sql'))).sort()) {
      if (done.has(name)) continue;
      const sql = fs.readFileSync(path.join(dir, name, 'migration.sql'), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query('INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ($1, $2, now(), $3, 1)', [crypto.randomUUID(), checksum, name]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw new Error(`Database update ${name} failed: ${e.message}`); }
    }
    return Number((await c.query('SELECT count(*) FROM "User"')).rows[0].count);
  } finally { await c.end(); }
}

const nodeEnv = (state, extra = {}) => ({
  ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'development', DATABASE_URL: dbUrl(state), JWT_SECRET: state.jwtSecret,
  STORAGE_DIR: path.join(dataDir(), 'files'), WEB_DIST: res('local', 'web'), ...extra,
});

/** Creates the company and first administrator (and optional demo data) in an empty database. */
function seed(state, { company, email, password, demo }) {
  return new Promise((resolve, reject) => {
    const out = [];
    const p = fork(res('local', 'seed.mjs'), demo ? ['--demo'] : [], {
      env: nodeEnv(state, { SEED_COMPANY_NAME: company, SEED_COMPANY_CODE: 'HQ', SEED_ADMIN_EMAIL: email, SEED_ADMIN_PASSWORD: password }),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    p.stdout.on('data', (d) => out.push(d)); p.stderr.on('data', (d) => out.push(d));
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Setting up the company failed.\n${Buffer.concat(out).toString().slice(-1500)}`))));
  });
}

let server;
async function startServer(state) {
  const port = await freePort(state.serverPort);
  if (port !== state.serverPort) writeState({ ...readState(), serverPort: port });
  return new Promise((resolve, reject) => {
    const out = [];
    server = fork(res('local', 'server.mjs'), [], { env: nodeEnv(state, { PORT: String(port) }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    server.stdout.on('data', (d) => out.push(d)); server.stderr.on('data', (d) => out.push(d));
    server.on('message', (m) => { if (m?.type === 'ready') resolve(`http://127.0.0.1:${port}`); });
    server.on('exit', (code) => { server = null; reject(new Error(`The local server stopped (code ${code}).\n${Buffer.concat(out).toString().slice(-1500)}`)); });
  });
}

/** Starts everything. Returns { needsSetup } or { url }. */
async function start() {
  if (!isInitialised()) await initialise();
  const state = readState();
  await startPostgres(state);
  const users = await migrate(readState());
  if (users === 0) return { needsSetup: true };
  return { url: await startServer(readState()) };
}
async function completeSetup(details) {
  await seed(readState(), details);
  return { url: await startServer(readState()) };
}
async function stop() {
  if (server) { const s = server; server = null; s.removeAllListeners('exit'); s.kill(); }
  await stopPostgres();
}
/** Copies the database and documents to a folder; the database is stopped for the copy and restarted. */
async function backup(destRoot) {
  const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const dest = path.join(destRoot, `EPC-backup-${ts}`);
  await stop();
  try {
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(pgData(), path.join(dest, 'pgdata'), { recursive: true });
    if (fs.existsSync(path.join(dataDir(), 'files'))) fs.cpSync(path.join(dataDir(), 'files'), path.join(dest, 'files'), { recursive: true });
    fs.copyFileSync(stateFile(), path.join(dest, 'local.json'));
    fs.writeFileSync(path.join(dest, 'README.txt'), 'EPC Contracts & Billing backup (this-computer mode).\r\nTo restore: close the app, replace the folders pgdata and files and the file local.json in\r\n' + dataDir() + '\r\nwith the ones in this folder, then open the app.\r\n');
  } finally { /* caller restarts */ }
  return dest;
}

module.exports = { start, completeSetup, stop, backup, dataDir, isInitialised };
