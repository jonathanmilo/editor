// Puente seguro entre la interfaz y el proceso principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  listDocs: () => ipcRenderer.invoke('docs:list'),
  loadDoc: (id) => ipcRenderer.invoke('docs:load', id),
  saveDoc: (doc) => ipcRenderer.invoke('docs:save', doc),
  deleteDoc: (id) => ipcRenderer.invoke('docs:delete', id),
  openFile: () => ipcRenderer.invoke('file:open'),
  exportFile: (opts) => ipcRenderer.invoke('file:export', opts),
  reveal: (p) => ipcRenderer.invoke('file:reveal', p),
  setTheme: (t) => ipcRenderer.send('theme', t),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, cmd) => cb(cmd)),
});
