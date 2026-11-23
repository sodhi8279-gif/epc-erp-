document.getElementById('err').textContent = new URLSearchParams(location.search).get('error') || '';
document.getElementById('retry').addEventListener('click', () => window.desktop.retry());
document.getElementById('change').addEventListener('click', () => window.desktop.changeServer());
