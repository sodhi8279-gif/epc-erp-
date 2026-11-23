// Usage: node scripts/shot.cjs <path> <out.png> [email] [password]
const { chromium } = require('playwright');
(async () => {
  const [path, out, email = 'admin@epc.local', password = 'Admin@12345'] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.goto('http://localhost:5173/login');
  await p.fill('input[type=email]', email); await p.fill('input[type=password]', password);
  await p.click('button[type=submit]'); await p.waitForURL((u) => !u.pathname.startsWith('/login'));
  await p.goto('http://localhost:5173' + path); await p.waitForTimeout(1500);
  await p.screenshot({ path: out, fullPage: true });
  if (errors.length) console.log('ERRORS:', errors.join('\n'));
  await b.close();
})();
