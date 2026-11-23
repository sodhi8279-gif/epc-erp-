const q = new URLSearchParams(location.search);
document.getElementById('srv').textContent = q.get('server') || 'your server';
document.getElementById('detail').textContent = q.get('error') ? 'Details: ' + q.get('error') : '';
document.getElementById('retry').addEventListener('click', () => window.desktop.retry());
document.getElementById('change').addEventListener('click', () => window.desktop.changeServer());
