// Puente seguro entre la interfaz y el proceso principal.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  listDocs: () => ipcRenderer.invoke('docs:list'),
  loadDoc: (id) => ipcRenderer.invoke('docs:load', id),
  saveDoc: (doc) => ipcRenderer.invoke('docs:save', doc),
  deleteDoc: (id) => ipcRenderer.invoke('docs:delete', id),
  openFile: () => ipcRenderer.invoke('file:open'),
  readPath: (p) => ipcRenderer.invoke('file:read', p),
  saveFile: (opts) => ipcRenderer.invoke('file:save', opts),
  confirm: (opts) => ipcRenderer.invoke('file:confirm', opts),
  pathForFile: (file) => webUtils.getPathForFile(file),
  reveal: (p) => ipcRenderer.invoke('file:reveal', p),
  renameFile: (opts) => ipcRenderer.invoke('file:rename', opts),
  setTheme: (t) => ipcRenderer.send('theme', t),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, cmd) => cb(cmd)),
  onOpenPath: (cb) => ipcRenderer.on('open-path', (_e, p) => cb(p)),
});
