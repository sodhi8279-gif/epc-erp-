// Browser smoke test: signs in as several roles and opens every screen, failing on any page error or crash.
// Usage: node scripts/smoke.cjs [baseUrl]   (API + web must be running, demo seed loaded)
const { chromium } = require('playwright');
const base = process.argv[2] ?? 'http://localhost:5173';
(async () => {
  const b = await chromium.launch();
  let failures = 0;
  for (const [email, pw] of [['admin@epc.local', 'Admin@12345'], ['billing.engineer@demo.local', 'Demo@12345'], ['storekeeper@demo.local', 'Demo@12345'], ['head.commercial@demo.local', 'Demo@12345']]) {
    const p = await b.newPage({ viewport: { width: 1366, height: 900 } });
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(base + '/login');
    await p.fill('input[type=email]', email); await p.fill('input[type=password]', pw); await p.click('button[type=submit]');
    await p.waitForURL((u) => !u.pathname.startsWith('/login'));
    const projects = await p.evaluate(async () => (await (await fetch('/api/projects', { headers: { authorization: 'Bearer ' + localStorage.getItem('epc_token') } })).json()));
    const demo = projects.find((x) => x.code === 'DEMO-PL');
    const pr = `/p/${demo.id}`;
    const routes = ['/', '/projects', '/subcontractors', '/materials', pr, `${pr}/contracts`, `${pr}/work-orders`, `${pr}/work-orders/new`, `${pr}/allocation`, `${pr}/measurements`, `${pr}/measurements/new`,
      ...['stock', 'receipts', 'issues', 'returns', 'ledger', 'norms', 'reconciliation'].map((m) => `${pr}/materials/${m}`)];
    if (email.startsWith('admin')) routes.push('/admin/users', '/audit');
    for (const r of routes) {
      await p.goto(base + r); await p.waitForTimeout(700);
      const h1 = await p.locator('h1').first().textContent({ timeout: 3000 }).catch(() => null);
      const bad = errs.splice(0);
      if (!h1 || bad.length) { failures++; console.log(`FAIL ${email} ${r}: ${h1 ?? 'no heading'} ${bad.join('; ')}`); }
    }
    console.log(`${email}: ${routes.length} screens checked`);
    await p.close();
  }
  await b.close();
  if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
  console.log('Smoke test passed');
})();
