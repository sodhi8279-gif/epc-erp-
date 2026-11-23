const $ = (id) => document.getElementById(id);
window.desktop.admins().then((list) => {
  for (const a of list) { const o = document.createElement('option'); o.value = a.email; o.textContent = a.email; $('email').append(o); }
  if (!list.length) { $('err').textContent = 'No administrator found.'; $('err').style.display = 'block'; }
});
const fail = (m) => { $('err').textContent = m; $('err').style.display = 'block'; $('go').disabled = false; };
$('cancel').addEventListener('click', () => window.desktop.retry());
$('f').addEventListener('submit', async (e) => {
  e.preventDefault(); $('err').style.display = 'none';
  if ($('pw').value !== $('pw2').value) return fail('The two passwords do not match.');
  $('go').disabled = true;
  const r = await window.desktop.resetAdmin({ email: $('email').value, password: $('pw').value });
  if (!r.ok) return fail(r.error);
  window.desktop.retry();
});
