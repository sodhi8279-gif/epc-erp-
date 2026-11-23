const $ = (id) => document.getElementById(id);
const fail = (m) => { $('err').textContent = m; $('err').style.display = 'block'; $('go').disabled = false; $('go').textContent = 'Create and open'; };
$('f').addEventListener('submit', async (e) => {
  e.preventDefault(); $('err').style.display = 'none';
  if ($('pw').value !== $('pw2').value) return fail('The two passwords do not match.');
  $('go').disabled = true; $('go').textContent = 'Setting up…';
  const r = await window.desktop.localSetup({ company: $('company').value, email: $('email').value, password: $('pw').value, demo: $('demo').checked });
  if (!r.ok) fail(r.error);
});
