const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  versions: process.versions,
});

contextBridge.exposeInMainWorld('electronAuth', {
  hashPassword: (username, password) => ipcRenderer.invoke('auth:hash-password', username, password),
  verifyPassword: (username, password, passwordHash) => ipcRenderer.invoke('auth:verify-password', username, password, passwordHash),
  isLegacyPasswordHash: (passwordHash) => ipcRenderer.invoke('auth:is-legacy-password-hash', passwordHash),
  getBootstrapAdmin: () => ipcRenderer.invoke('auth:get-bootstrap-admin'),
});
