const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('customerDisplay', {
  onData: cb => ipcRenderer.on('customer-display:data', (_e, data) => cb(data)),
  enterPhone: phone => ipcRenderer.send('customer-display:phone-input', phone),
  submitPhone: () => ipcRenderer.send('customer-display:phone-submit')
});
