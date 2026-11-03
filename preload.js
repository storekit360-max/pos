const { contextBridge, ipcRenderer } = require('electron');
// Keep this name in sync with renderer/js/core.js, which detects the desktop
// bridge as window.posApi. Without it the app falls back to browser storage and
// hides the desktop backup controls.
contextBridge.exposeInMainWorld('posApi', {
  load: () => ipcRenderer.invoke('db:load'),
  save: d => ipcRenderer.invoke('db:save', d),
  dataPath: () => ipcRenderer.invoke('db:path'),
  setBackup: c => ipcRenderer.invoke('backup:config', c),
  backupNow: () => ipcRenderer.invoke('backup:run'),
  backups: () => ipcRenderer.invoke('backup:list'),
  pickFolder: () => ipcRenderer.invoke('dialog:folder'),
  restore: () => ipcRenderer.invoke('backup:restore'),
  onBackupError: cb => ipcRenderer.on('backup:error', (_e, m) => cb(m)),
  licenseStatus: () => ipcRenderer.invoke('license:status'),
  startLicense: () => ipcRenderer.invoke('license:start'),
  activateLicense: key => ipcRenderer.invoke('license:activate', key),
  checkUpdate: url => ipcRenderer.invoke('update:check', url),
  downloadUpdate: (url, release) => ipcRenderer.invoke('update:download', url, release),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  downloadUiUpdate: url => ipcRenderer.invoke('update:ui:download', url),
  applyUiUpdate: () => ipcRenderer.invoke('update:ui:apply'),
  uiBootOk: () => ipcRenderer.invoke('update:ui:ok'),
  printHTML: job => ipcRenderer.invoke('print:html', job),
  openCustomerDisplay: () => ipcRenderer.invoke('customer-display:open'),
  closeCustomerDisplay: () => ipcRenderer.invoke('customer-display:close'),
  updateCustomerDisplay: data => ipcRenderer.invoke('customer-display:update', data),
  onCustomerPhoneInput: cb => ipcRenderer.on('customer-display:phone-input', (_e, phone) => cb(phone)),
  onCustomerPhoneSubmit: cb => ipcRenderer.on('customer-display:phone-submit', () => cb()),
  pickLogo: () => ipcRenderer.invoke('branding:pick-logo')
});
