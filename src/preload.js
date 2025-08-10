const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  runScript: async (code, asyncTimeoutMs) => {
    // asyncTimeoutMs는 더 이상 사용하지 않지만, API 호환을 위해 인자 유지
    return ipcRenderer.invoke('run-script', { code });
  },
  onScriptLog: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('script-log', wrapped);
    // unsubscribe 함수 반환
    return () => ipcRenderer.removeListener('script-log', wrapped);
  },
  stopScript: async () => ipcRenderer.invoke('stop-script'),
  openScript: async () => ipcRenderer.invoke('open-script'),
  saveScript: async (content) => ipcRenderer.invoke('save-script', { content }),
  saveToCurrent: async (content) => ipcRenderer.invoke('save-to-current', { content }),
  // TCP client
  tcpConnect: (ip, port) => ipcRenderer.invoke('tcp-connect', { ip, port }),
  tcpDisconnect: () => ipcRenderer.invoke('tcp-disconnect'),
  onTcpStatus: (handler) => { const l = (_e, p) => handler(p); ipcRenderer.on('tcp-status', l); return () => ipcRenderer.removeListener('tcp-status', l); },
  onTcpRx: (handler) => { const l = (_e, p) => handler(p); ipcRenderer.on('tcp-rx', l); return () => ipcRenderer.removeListener('tcp-rx', l); },
  onTcpTxLocal: (handler) => { const l = (_e, p) => handler(p); ipcRenderer.on('tcp-tx-local', l); return () => ipcRenderer.removeListener('tcp-tx-local', l); },
  onButtonsReset: (handler) => { const l = () => handler(); ipcRenderer.on('buttons-reset', l); return () => ipcRenderer.removeListener('buttons-reset', l); },
  onPendingUpdated: (handler) => { const l = (_e, p) => handler(p); ipcRenderer.on('pending-updated', l); return () => ipcRenderer.removeListener('pending-updated', l); },
  sendTx: (bytes) => ipcRenderer.invoke('tcp-send', { bytes }),
  simulateSignal: (addr, value) => ipcRenderer.invoke('tcp-simulate', { addr, value }),
  setCurrentFile: (path) => ipcRenderer.send('set-current-file', path),
  onOpenedScript: (handler) => { const l = (_e, p) => handler(p); ipcRenderer.on('opened-script', l); return () => ipcRenderer.removeListener('opened-script', l); },
  onSavedScript: (handler) => { const l = (_e, p) => handler(p); ipcRenderer.on('saved-script', l); return () => ipcRenderer.removeListener('saved-script', l); },
  onRequestCode: (handler) => { const ch = 'request-code'; const l = () => handler(); ipcRenderer.on(ch, l); return () => ipcRenderer.removeListener(ch, l); },
  provideCode: (code) => ipcRenderer.emit('provide-code', null, { code }),
  onMenuRun: (handler) => { const l = () => handler(); ipcRenderer.on('menu-run', l); return () => ipcRenderer.removeListener('menu-run', l); },
  onFormatCode: (handler) => { const l = () => handler(); ipcRenderer.on('format-code', l); return () => ipcRenderer.removeListener('format-code', l); },
  onResetLayout: (handler) => { const l = () => handler(); ipcRenderer.on('reset-layout', l); return () => ipcRenderer.removeListener('reset-layout', l); },
  onResetScript: (handler) => { const l = () => handler(); ipcRenderer.on('reset-script', l); return () => ipcRenderer.removeListener('reset-script', l); },
});


