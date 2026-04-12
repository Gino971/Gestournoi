const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  readData: (key) => ipcRenderer.invoke('read-data', key),
  writeData: (key, data) => ipcRenderer.invoke('write-data', { key, data }),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  exportPDF: (options) => ipcRenderer.invoke('print-to-pdf', options),
  confirm: (message) => ipcRenderer.invoke('show-confirm-dialog', message),
  alert: (message) => ipcRenderer.invoke('show-alert-dialog', message),
  choice: (message, buttons) => ipcRenderer.invoke('show-choice-dialog', { message, buttons }),
  saveBackup: (filename, content) => ipcRenderer.invoke('save-backup', { filename, content }),
  listBackups: () => ipcRenderer.invoke('list-backups'),
  readBackup: (filename) => ipcRenderer.invoke('read-backup', filename),
  deleteBackup: (filename) => ipcRenderer.invoke('delete-backup', filename),
  getPaths: () => ipcRenderer.invoke('get-paths'),
  platform: process.platform
})
