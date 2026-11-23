const q = new URLSearchParams(location.search);
if (q.get('first')) { document.getElementById('t').textContent = 'Preparing this computer…'; document.getElementById('d').textContent = 'Creating a private database for your data. This takes up to a minute the first time.'; }
if (q.get('backup')) { document.getElementById('t').textContent = 'Backing up…'; document.getElementById('d').textContent = 'Copying your database and documents. The app reopens when it is done.'; }
