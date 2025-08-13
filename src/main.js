const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const util = require('util');
const { Worker } = require('worker_threads');
const net = require('net');

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  return mainWindow;
}

// Recent files and menu
const currentFileByWindow = new Map();
let recentFiles = [];

async function loadRecentFiles() {
  try {
    const p = path.join(app.getPath('userData'), 'recent.json');
    const txt = await fs.readFile(p, 'utf8');
    const obj = JSON.parse(txt);
    recentFiles = Array.isArray(obj.files) ? obj.files : [];
  } catch {}
}

async function saveRecentFiles() {
  try {
    const p = path.join(app.getPath('userData'), 'recent.json');
    await fs.writeFile(p, JSON.stringify({ files: recentFiles }, null, 2), 'utf8');
  } catch {}
}

function addRecentFile(filePath) {
  recentFiles = [filePath, ...recentFiles.filter((f) => f !== filePath)].slice(0, 10);
  saveRecentFiles();
  buildMenu();
}

function getFocusedWindow() {
  const wins = BrowserWindow.getAllWindows();
  return wins.find((w) => w.isFocused()) || wins[0] || null;
}

function requestCodeFromRenderer(win) {
  return new Promise((resolve) => {
    const onProvide = (event, payload) => {
      if (event.sender !== win.webContents) return;
      ipcMain.removeListener('provide-code', onProvide);
      resolve(typeof payload?.code === 'string' ? payload.code : '');
    };
    ipcMain.on('provide-code', onProvide);
    win.webContents.send('request-code');
    setTimeout(() => {
      try { ipcMain.removeListener('provide-code', onProvide); } catch {}
      resolve(undefined);
    }, 10000);
  });
}

function buildMenu() {
  const recentSubmenu = recentFiles.length
    ? recentFiles.map((fp) => ({
        label: fp,
        click: async () => {
          const win = getFocusedWindow();
          if (!win) return;
          try {
            const content = await fs.readFile(fp, 'utf8');
            currentFileByWindow.set(win.id, fp);
            addRecentFile(fp);
            if (!win.isDestroyed()) win.webContents.send('opened-script', { path: fp, content });
          } catch (err) {
            dialog.showErrorBox('파일 열기 실패', String(err?.message || err));
          }
        },
      }))
    : [{ label: '최근 항목 없음', enabled: false }];

  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open…', accelerator: 'CmdOrCtrl+O', click: async () => {
            const win = getFocusedWindow(); if (!win) return;
            const { canceled, filePaths } = await dialog.showOpenDialog(win, {
              title: '스크립트 열기', properties: ['openFile'], filters: [
                { name: 'Scripts', extensions: ['js', 'txt'] },
                { name: 'All Files', extensions: ['*'] },
              ],
            });
            if (canceled || !filePaths || !filePaths[0]) return;
            try {
              const content = await fs.readFile(filePaths[0], 'utf8');
              currentFileByWindow.set(win.id, filePaths[0]);
              addRecentFile(filePaths[0]);
              if (!win.isDestroyed()) win.webContents.send('opened-script', { path: filePaths[0], content });
            } catch (err) {
              dialog.showErrorBox('파일 열기 실패', String(err?.message || err));
            }
          }
        },
        {
          label: 'Save', accelerator: 'CmdOrCtrl+S', click: async () => {
            const win = getFocusedWindow(); if (!win) return;
            const filePath = currentFileByWindow.get(win.id);
            const code = await requestCodeFromRenderer(win);
            if (code === undefined) return;
            if (filePath) {
              try { await fs.writeFile(filePath, code, 'utf8'); addRecentFile(filePath); if (!win.isDestroyed()) win.webContents.send('saved-script', { path: filePath }); }
              catch (err) { dialog.showErrorBox('저장 실패', String(err?.message || err)); }
            } else {
              const { canceled, filePath: saveTo } = await dialog.showSaveDialog(win, { title: '스크립트 저장', filters: [ { name: 'JavaScript', extensions: ['js'] }, { name: 'Text', extensions: ['txt'] } ] });
              if (canceled || !saveTo) return;
              try { await fs.writeFile(saveTo, code, 'utf8'); currentFileByWindow.set(win.id, saveTo); addRecentFile(saveTo); if (!win.isDestroyed()) win.webContents.send('saved-script', { path: saveTo }); }
              catch (err) { dialog.showErrorBox('저장 실패', String(err?.message || err)); }
            }
          }
        },
        { type: 'separator' },
        { label: 'Recent Files', submenu: recentSubmenu },
        { type: 'separator' },
        { role: 'quit', label: process.platform === 'darwin' ? 'Quit' : 'Exit' },
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Format Code', accelerator: 'Alt+Shift+F', click: () => { const win = getFocusedWindow(); if (win) win.webContents.send('format-code'); } },
        { label: 'Reset Script to Sample', click: () => { const win = getFocusedWindow(); if (win) win.webContents.send('reset-script'); } },
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reset Layout', click: () => { const win = getFocusedWindow(); if (win) win.webContents.send('reset-layout'); } },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'reload' },
      ]
    },
    {
      label: 'Run',
      submenu: [
        { label: 'Run', accelerator: 'CmdOrCtrl+Enter', click: () => { const win = getFocusedWindow(); if (win) win.webContents.send('menu-run'); } },
        { label: 'Stop', accelerator: 'Esc', click: async () => { const win = getFocusedWindow(); if (!win) return; const entry = runningByWindow.get(win.id); if (entry) { await entry.worker.terminate().catch(()=>{}); } } },
      ]
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function stringifyForOutput(value) {
  try {
    if (typeof value === 'string') return value;
    return util.inspect(value, { depth: 3, colors: false, maxArrayLength: 50 });
  } catch (err) {
    return String(value);
  }
}
// windowId -> { worker, resolve }
const runningByWindow = new Map();
const tcpByWindow = new Map(); // windowId -> { socket }
const buttonStateByWindow = new Map(); // windowId -> Map(addr -> { pressed, pp, up })

ipcMain.handle('run-script', async (event, payload) => {
  const { code } = payload || {};
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, error: 'No window' };
  const windowId = win.id;

  if (runningByWindow.has(windowId)) {
    return { ok: false, error: 'A script is already running' };
  }

  // 새 스크립트 실행 시 pending 플래그를 초기화 (pressed 상태는 유지)
  {
    const bs = buttonStateByWindow.get(windowId);
    if (bs) {
      for (const [addr, st] of bs.entries()) {
        if (st && (st.pp || st.up)) {
          st.pp = false;
          st.up = false;
          bs.set(addr, st);
        }
      }
    }
  }

  const workerPath = path.join(__dirname, 'runner', 'worker.js');
  const worker = new Worker(workerPath, { workerData: { code } });

  // 워커에 현재 버튼 상태 스냅샷 전송
  const bs = buttonStateByWindow.get(windowId);
  if (bs) {
    const snapshot = [];
    for (const [addr, st] of bs.entries()) {
      snapshot.push({ addr, pressed: st.pressed, pp: st.pp, up: st.up });
    }
    worker.postMessage({ type: 'buttons-snapshot', items: snapshot });
  }

  const resultPromise = new Promise((resolve) => {
    runningByWindow.set(windowId, { worker, resolve });

    worker.on('message', (msg) => {
      if (msg && msg.type === 'log') {
        const line = String(msg.line ?? '');
        if (!win.isDestroyed()) win.webContents.send('script-log', { line });
      } else if (msg && msg.type === 'alert') {
        const text = String(msg.text ?? '');
        if (!win.isDestroyed()) {
          dialog.showMessageBox(win, {
            type: 'info',
            title: '알림',
            message: text,
            buttons: ['확인'],
            noLink: true,
          }).catch(() => {});
        }
      } else if (msg && msg.type === 'sandbox-tx') {
        if (msg.kind === 'color') {
          const arr = [msg.addr & 0xff, 1, msg.rgb?.[0] & 0xff, msg.rgb?.[1] & 0xff, msg.rgb?.[2] & 0xff];
          if (tcpByWindow.get(windowId)) tcpByWindow.get(windowId).socket.write(Buffer.from(arr));
          broadcast(win, 'tcp-tx-local', { bytes: arr });
        } else if (msg.kind === 'range') {
          const bytes = [msg.start & 0xff, (msg.colors?.length || 0) & 0xff];
          for (const c of (msg.colors || [])) bytes.push((c?.[0] || 0) & 0xff, (c?.[1] || 0) & 0xff, (c?.[2] || 0) & 0xff);
          if (tcpByWindow.get(windowId)) tcpByWindow.get(windowId).socket.write(Buffer.from(bytes));
          broadcast(win, 'tcp-tx-local', { bytes });
        }
      } else if (msg && msg.type === 'sandbox-get') {
        const bs = buttonStateByWindow.get(windowId) || new Map();
        if (msg.key === 'getButtonState') {
          const st = bs.get(msg.addr & 0xff);
          worker.postMessage({ type: 'sandbox-reply', id: msg.id, value: !!(st && st.pressed) });
        } else if (msg.key === 'takePressedPending') {
          const a = msg.addr & 0xff; const st = bs.get(a) || { pressed: false, pp: false, up: false };
          const val = !!st.pp; st.pp = false; bs.set(a, st);
          broadcast(win, 'pending-updated', { addr: a, pp: st.pp, up: st.up });
          worker.postMessage({ type: 'buttons-update', addr: a, pressed: st.pressed, pp: st.pp, up: st.up });
          worker.postMessage({ type: 'sandbox-reply', id: msg.id, value: val });
        } else if (msg.key === 'takeUnpressedPending') {
          const a = msg.addr & 0xff; const st = bs.get(a) || { pressed: false, pp: false, up: false };
          const val = !!st.up; st.up = false; bs.set(a, st);
          broadcast(win, 'pending-updated', { addr: a, pp: st.pp, up: st.up });
          worker.postMessage({ type: 'buttons-update', addr: a, pressed: st.pressed, pp: st.pp, up: st.up });
          worker.postMessage({ type: 'sandbox-reply', id: msg.id, value: val });
        }
              } else if (msg && msg.type === 'pending-consume') {
          // Worker consumed pending synchronously -> update main state and UI
          const a = (msg.addr >>> 0) & 0xff;
          const bs = buttonStateByWindow.get(windowId) || new Map();
          const st = bs.get(a) || { pressed: false, pp: false, up: false };
          if (msg.kind === 'pp') st.pp = false;
          if (msg.kind === 'up') st.up = false;
          bs.set(a, st);
          buttonStateByWindow.set(windowId, bs);
          broadcast(win, 'pending-updated', { addr: a, pp: st.pp, up: st.up });
          // 워커 캐시도 동기화
          worker.postMessage({ type: 'buttons-update', addr: a, pressed: st.pressed, pp: st.pp, up: st.up });
      } else if (msg && msg.type === 'done') {
        resolve({ ok: msg.ok, result: msg.result, error: msg.error, logs: msg.logs || [], timeMs: msg.timeMs });
        runningByWindow.delete(windowId);
      }
    });

    worker.on('error', (err) => {
      resolve({ ok: false, error: String(err && err.message ? err.message : err) });
      runningByWindow.delete(windowId);
    });

    worker.on('exit', (code) => {
      if (runningByWindow.has(windowId)) {
        // terminated without sending 'done'
        const entry = runningByWindow.get(windowId);
        entry.resolve({ ok: false, error: 'Stopped by user', stopped: true });
        runningByWindow.delete(windowId);
      }
    });
  });

  return resultPromise;
});

ipcMain.handle('stop-script', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false };
  const windowId = win.id;
  const entry = runningByWindow.get(windowId);
  if (!entry) return { ok: true, already: true };
  try {
    win.webContents.send('script-log', { line: '[info] 사용자에 의해 중단 요청' });
    await entry.worker.terminate();
    runningByWindow.delete(windowId);
    resetButtonStates(win, windowId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('open-script', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '스크립트 열기',
    properties: ['openFile'],
    filters: [
      { name: 'Scripts', extensions: ['js', 'txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };
  try {
    const content = await fs.readFile(filePaths[0], 'utf8');
    return { ok: true, path: filePaths[0], content };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('save-script', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { content } = payload || {};
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '스크립트 저장',
    filters: [
      { name: 'JavaScript', extensions: ['js'] },
      { name: 'Text', extensions: ['txt'] },
    ],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    await fs.writeFile(filePath, String(content ?? ''), 'utf8');
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

app.whenReady().then(() => {
  createMainWindow();
  loadRecentFiles().then(buildMenu);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
function broadcast(win, channel, payload) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

function setTcpStatus(win, status) {
  broadcast(win, 'tcp-status', { status });
}

function resetButtonStates(win, windowId) {
  const bs = buttonStateByWindow.get(windowId);
  if (bs) {
    for (const [addr, st] of bs.entries()) {
      bs.set(addr, { pressed: false, pp: false, up: false });
    }
  }
  broadcast(win, 'buttons-reset', {});
}

ipcMain.handle('tcp-connect', async (event, { ip, port }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const windowId = win.id;
  if (tcpByWindow.has(windowId)) {
    try { tcpByWindow.get(windowId).socket.destroy(); } catch {}
    tcpByWindow.delete(windowId);
  }
  setTcpStatus(win, 'connecting');
  return await new Promise((resolve) => {
    const socket = new net.Socket();
    let ffCount = 0;
    socket.connect(Number(port), String(ip), () => {
      tcpByWindow.set(windowId, { socket });
      setTcpStatus(win, 'connected');
      resolve({ ok: true });
    });
    socket.on('data', (buf) => {
      broadcast(win, 'tcp-rx', { bytes: Array.from(buf.values()) });
      // manage special 0xFF*4 and addr/value stream
      let bs = buttonStateByWindow.get(windowId);
      if (!bs) { bs = new Map(); buttonStateByWindow.set(windowId, bs); }
      let i = 0;
      while (i < buf.length) {
        const b = buf[i];
        if (b === 0xFF) {
          ffCount += 1;
          i += 1;
          if (ffCount >= 4) {
            dialog.showMessageBox(win, { type: 'warning', title: '알림', message: '다른 위치에서 사용중' }).catch(()=>{});
          }
          continue;
        }
        ffCount = 0;
        if (i + 1 < buf.length) {
          const addr = buf[i];
          const val = buf[i + 1];
          i += 2;
          const prev = bs.get(addr) || { pressed: false, pp: false, up: false };
          const pressed = val === 1;
          const newState = {
            pressed,
            pp: pressed && !prev.pressed ? true : prev.pp,
            up: !pressed && prev.pressed ? true : prev.up,
          };
          bs.set(addr, newState);
          // 워커에 상태 업데이트 전송
          const entry = runningByWindow.get(windowId);
          if (entry && entry.worker) {
            entry.worker.postMessage({ type: 'buttons-update', addr, ...newState });
          }
        } else {
          break;
        }
      }
    });
    socket.on('close', () => {
      setTcpStatus(win, 'disconnected');
      dialog.showMessageBox(win, { type: 'info', title: '알림', message: '연결 종료됨' });
      tcpByWindow.delete(windowId);
      buttonStateByWindow.delete(windowId);
      // stop running script when disconnected
      const entry = runningByWindow.get(windowId);
      if (entry) {
        try { entry.worker.terminate(); } catch {}
        runningByWindow.delete(windowId);
      }
      resetButtonStates(win, windowId);
    });
    socket.on('error', (err) => {
      setTcpStatus(win, 'disconnected');
      // 에러는 로그로만 표시하고 빈 RX 이벤트는 발생시키지 않음
      console.error('TCP connection error:', err);
      resolve({ ok: false, error: String(err?.message || err) });
    });
  });
});

ipcMain.handle('tcp-disconnect', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const windowId = win.id;
  const ent = tcpByWindow.get(windowId);
  if (!ent) return { ok: true };
  try { ent.socket.destroy(); } catch {}
  tcpByWindow.delete(windowId);
  setTcpStatus(win, 'disconnected');
  return { ok: true };
});

ipcMain.handle('tcp-send', async (event, { bytes }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const ent = tcpByWindow.get(win.id);
  if (!ent) return { ok: false, error: 'not connected' };
  try {
    const buf = Buffer.from(bytes);
    ent.socket.write(buf);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// Simulation: inject addr/value as if received from TCP
ipcMain.handle('tcp-simulate', async (event, { addr, value }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const windowId = win.id;
  // update internal button state for scripts
  let bs = buttonStateByWindow.get(windowId);
  if (!bs) { bs = new Map(); buttonStateByWindow.set(windowId, bs); }
  const prev = bs.get(addr & 0xff) || { pressed: false, pp: false, up: false };
  const pressed = (value & 0xff) === 1;
  const newState = {
    pressed,
    pp: pressed && !prev.pressed ? true : prev.pp,
    up: !pressed && prev.pressed ? true : prev.up,
  };
  bs.set(addr & 0xff, newState);
  // 워커에 상태 업데이트 전송
  const entry = runningByWindow.get(windowId);
  if (entry && entry.worker) {
    entry.worker.postMessage({ type: 'buttons-update', addr: addr & 0xff, ...newState });
  }
  // echo to renderer for logs/UI
  broadcast(win, 'tcp-rx', { bytes: [addr & 0xff, pressed ? 1 : 0] });
  return { ok: true };
});



// save to current file (autosave)
ipcMain.handle('save-to-current', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false };
  const filePath = currentFileByWindow.get(win.id);
  if (!filePath) return { ok: false, noTarget: true };
  const { content } = payload || {};
  try {
    await fs.writeFile(filePath, String(content ?? ''), 'utf8');
    addRecentFile(filePath);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.on('set-current-file', (event, filePath) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  currentFileByWindow.set(win.id, filePath || null);
  if (filePath) addRecentFile(filePath);
});
