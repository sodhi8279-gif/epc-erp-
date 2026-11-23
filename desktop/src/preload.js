// Only the setup and offline screens use this bridge; the server's pages get nothing beyond a normal browser.
const { contextBridge, ipcRenderer } = require('electron');
if (location.protocol === 'file:') contextBridge.exposeInMainWorld('desktop', {
  current: () => ipcRenderer.invoke('desktop:current'),
  saveServer: (url) => ipcRenderer.invoke('desktop:save-server', url),
  retry: () => ipcRenderer.invoke('desktop:retry'),
  changeServer: () => ipcRenderer.invoke('desktop:change-server'),
});
