const $ = (id) => document.getElementById(id);
window.desktop.current().then((c) => { $('url').value = c.serverUrl || ''; $('ver').textContent = 'Desktop client ' + c.version; });
$('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('go').disabled = true; $('go').textContent = 'Checking…'; $('err').style.display = 'none';
  const r = await window.desktop.saveServer($('url').value);
  if (!r.ok) { $('err').textContent = r.error; $('err').style.display = 'block'; $('go').disabled = false; $('go').textContent = 'Connect'; }
});
$('local').addEventListener('click', () => { $('local').disabled = true; $('local').textContent = 'Starting…'; window.desktop.useLocal(); });
