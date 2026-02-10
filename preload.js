const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getFiles: () => ipcRenderer.invoke('get-files'),
  saveFile: (fileData) => ipcRenderer.invoke('save-file', fileData),
  deleteFile: (cid) => ipcRenderer.invoke('delete-file', cid),
  readFile: (cid) => ipcRenderer.invoke('read-file', cid),
  updateFileTags: (cid, tags) => ipcRenderer.invoke('update-file-tags', cid, tags),
  calculateHash: (content) => ipcRenderer.invoke('calculate-hash', content),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  activateFile: (cid) => ipcRenderer.invoke('activate-file', cid),
  deactivateFile: (cid) => ipcRenderer.invoke('deactivate-file', cid)
});
