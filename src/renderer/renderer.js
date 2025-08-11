const editorEl = document.getElementById('editor');
const runBtn = document.getElementById('runBtn');
const clearBtn = document.getElementById('clearBtn');
const stopBtn = document.getElementById('stopBtn');
const resizer = document.getElementById('resizer');
const tcpIpEl = document.getElementById('tcpIp');
const tcpPortEl = document.getElementById('tcpPort');
const tcpStatusBtn = document.getElementById('tcpStatus');
const tcpConnectBtn = document.getElementById('tcpConnectBtn');
const rxLog = document.getElementById('rxLog');
const txLog = document.getElementById('txLog');
const simBtn = document.getElementById('simBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const simPanel = document.getElementById('simPanel');
const simWrapper = document.getElementById('simWrapper');
const outputEl = document.getElementById('output');
const statusEl = document.getElementById('status');
const snippetBar = document.querySelector('.snippet-bar');
// popover
const popover = document.getElementById('boardPopover');
let popoverResolve = null;
function openBoardPopover(x, y, { addr, hex }) {
  return new Promise((resolve) => {
    popoverResolve = resolve;
    const colors = [
      '#000000','#ffffff','#ff0000','#00ff00','#0000ff','#ffff00',
      '#00ffff','#ff00ff','#ff7f00','#7f00ff','#00ff7f','#7fff00'
    ];
    const html = `
      <div class="row"><label>주소</label><input id="ppAddr" type="number" min="0" max="255" value="${addr}" /></div>
      <div class="row"><label>색상</label><input id="ppHex" type="text" value="${hex || ''}" /></div>
      <div class="row"><label>팔레트</label><input id="ppColor" type="color" /></div>
      <div class="palette">${colors.map(c=>`<div class=\"swatch\" data-color=\"${c}\" style=\"background:${c}\"></div>`).join('')}</div>
      <div class="actions"><button id="ppCancel">취소</button><button id="ppOk" class="primary">확인</button></div>
    `;
    popover.innerHTML = html;
    popover.style.left = `${x + 12}px`;
    popover.style.top = `${y + 12}px`;
    popover.style.display = 'block';

    const ppAddr = popover.querySelector('#ppAddr');
    const ppHex = popover.querySelector('#ppHex');
    const ppColor = popover.querySelector('#ppColor');
    // init color input
    ppColor.value = `#${(hex||'000000').padStart(6,'0')}`;
    popover.querySelectorAll('.swatch').forEach(el => el.addEventListener('click', () => {
      ppHex.value = el.getAttribute('data-color').replace('#','').toUpperCase();
      ppColor.value = `#${ppHex.value.padStart(6,'0')}`;
    }));
    ppColor.addEventListener('input', () => {
      ppHex.value = ppColor.value.replace('#','').toUpperCase();
    });
    popover.querySelector('#ppOk').addEventListener('click', () => {
      const a = Number(ppAddr.value);
      const h = String(ppHex.value || '').trim();
      closePopover({ ok: true, addr: a, hex: h });
    });
    popover.querySelector('#ppCancel').addEventListener('click', () => closePopover({ ok: false }));
    function escHandler(e){ if (e.key === 'Escape') { closePopover({ ok:false }); } }
    window.addEventListener('keydown', escHandler, { once: true });
  });
}
function closePopover(result){
  popover.style.display = 'none';
  const r = popoverResolve; popoverResolve = null;
  if (r) r(result);
}

const SAMPLE = `// 3x2 보드 파형 데모 @24fps\n// 각 보드 i는 위상 ta[i]를 가지며, 눌림 상태면 ta[i]를 조금씩 증가시켜 시간 가속\n// RGB = sin(t+ta), sin(t+ta+2π/3), sin(t+ta+4π/3) → 0..255 로 매핑\n\nconst FPS = 24;\nconst frameMs = Math.round(1000 / FPS);\nconst baseSpeed = 2.0;          // 라디안/초\nconst pressBoostPerSec = 1.0;   // 눌림 시 ta 가속(라디안/초)\nconst boostPerFrame = pressBoostPerSec / FPS;\nconst TWO_PI = Math.PI * 2;\nconst SHIFT1 = (2 * Math.PI) / 3;   // 120°\nconst SHIFT2 = (4 * Math.PI) / 3;   // 240°\nconst toByte = (x) => { const v = Math.sin(x) * 0.5 + 0.5; return Math.max(0, Math.min(255, Math.round(v * 255))); };\nconst delay = (ms) => new Promise(r => setTimeout(r, ms));\n\nconst addrs = [0,1,2,3,4,5];\nconst ta = Array(6).fill(0);\nconst t0 = Date.now() / 1000;\nconsole.log('시작: 24fps 파형 데모');\n\nwhile (true) {\n  const t = (Date.now() / 1000 - t0) * baseSpeed;\n  const colors = [];\n  for (let i = 0; i < 6; i++) {\n    if (await getButtonState(addrs[i])) {\n      ta[i] += boostPerFrame;\n    }\n    if (takePressedPending(addrs[i])) {\n      console.log('[pressed pending]', i, 'addr=', addrs[i]);\n    }\n    if (takeUnpressedPending(addrs[i])) {\n      console.log('[unpressed pending]', i, 'addr=', addrs[i]);\n    }\n    const phase = t + ta[i];\n    const r = toByte(phase);\n    const g = toByte(phase + SHIFT1);\n    const b = toByte(phase + SHIFT2);\n    colors.push([r, g, b]);\n  }\n  sendColorRange(0, colors);\n  await delay(frameMs);\n}`;

editorEl.value = localStorage.getItem('fe:script') || SAMPLE;
const cm = CodeMirror.fromTextArea(editorEl, {
  mode: 'javascript',
  theme: 'material',
  lineNumbers: true,
  indentUnit: 2,
  tabSize: 2,
  smartIndent: true,
  matchBrackets: true,
  autoCloseBrackets: true,
});
cm.setSize('100%', '100%');
let isRunning = false;

function setBusy(busy) {
  isRunning = busy;
  runBtn.disabled = busy;
  stopBtn.disabled = !busy;
  statusEl.textContent = busy ? '실행 중…' : '';
}

function appendOutput(text) {
  outputEl.textContent += `${text}\n`;
  outputEl.scrollTop = outputEl.scrollHeight;
}

clearBtn.addEventListener('click', () => {
  outputEl.textContent = '';
  statusEl.textContent = '';
});

stopBtn.addEventListener('click', async () => {
  if (!isRunning) return;
  stopBtn.disabled = true;
  await window.api.stopScript();
});

runBtn.addEventListener('click', async () => {
  // 연결 또는 시뮬레이션에서만 실행 허용
  if (!(tcpState === 'connected' || tcpState === 'simulated')) {
    // 자동으로 시뮬레이션으로 전환
    simulated = true; setTcpState('simulated');
  }
  if (tcpState === 'connecting') return;
  const code = cm.getValue();
  localStorage.setItem('fe:script', code);
  setBusy(true);
  outputEl.textContent = '';
  let unsubscribe;

  try {
    unsubscribe = window.api.onScriptLog(({ line }) => appendOutput(line));
    const res = await window.api.runScript(code);
    if (res.logs && Array.isArray(res.logs)) {
      res.logs.forEach((line) => appendOutput(line));
    }
    if (res.ok) {
      appendOutput(`Result: ${res.result}`);
    } else {
      appendOutput(res.stopped ? '중단됨' : `Error: ${res.error}`);
    }
    if (res.stopped) statusEl.textContent = '중단됨';
    else if (typeof res.timeMs === 'number') statusEl.textContent = `완료 (${res.timeMs} ms)`;
  } catch (err) {
    appendOutput(`Error: ${err.message || String(err)}`);
  } finally {
    if (typeof unsubscribe === 'function') unsubscribe();
    setBusy(false);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter') {
    runBtn.click();
  }
  if (e.key === 'Escape') {
    stopBtn.click();
  }
});

// 최초 1회만 SAMPLE을 주입하고 이후는 사용자가 수정한 마지막 스크립트를 사용
// 이미 localStorage에 저장된 스크립트가 있으면 그대로 유지됨

// Snippets
const SNIPPETS = {
  // 기본 블록
  var: `let name = 'value';`,
  log: `console.log('메시지');`,
  sleep: `await new Promise(r => setTimeout(r, 1000));`,
  for: `for (let i = 0; i < 5; i++) {\n  console.log('i =', i);\n}`,
  while: `let i = 0;\nwhile (i < 5) {\n  console.log('i =', i);\n  i++;\n}`,
  if: `const value = 10;\nif (value > 5) {\n  console.log('크다');\n} else {\n  console.log('작거나 같다');\n}`,
  switch: `const key = 'a';\nswitch (key) {\n  case 'a':\n    console.log('A');\n    break;\n  case 'b':\n    console.log('B');\n    break;\n  default:\n    console.log('기타');\n}`,

  hello: `console.log('Hello, FloorEditor!');\nreturn 'OK';`,
  wait: `const sleep = ms => new Promise(r => setTimeout(r, ms));\nconsole.log('잠깐 기다립니다...');\nawait sleep(500);\nreturn '완료';`,
  ticks: `const id = setInterval(() => console.log('tick', Date.now()), 200);\nawait new Promise(r => setTimeout(() => { clearInterval(id); r(); }, 1200));\nreturn '틱 종료';`,
  sum: `const nums = [1,2,3,4,5];\nreturn nums.reduce((a,b)=>a+b,0);`,
  object: `const a = 1, b = 2;\nreturn { sum: a+b, product: a*b };`,
  // 특수
  alert: `alert('내용');`,
};

// 통신 스니펫 (변수명 고정 사용 지양, 자리표시자 사용)
SNIPPETS['comm-button-state'] = `// 버튼 상태 검사\nif (getButtonState(0)) {\n  // ...\n}`;
SNIPPETS['comm-button-pressed-pending'] = `// pressed pending 검사(읽으면 소거)\nif (takePressedPending(0)) {\n  // ...\n}`;
SNIPPETS['comm-button-unpressed-pending'] = `// unpressed pending 검사(읽으면 소거)\nif (takeUnpressedPending(0)) {\n  // ...\n}`;
SNIPPETS['comm-color'] = `// 단일 색 전송\nsendColor(0, [255, 0, 0]);`;
SNIPPETS['comm-color-range'] = `// 연속 색 전송\nsendColorRange(0, [[255, 0, 0], [0, 255, 0]]);`;

function insertAtCursor(textarea, text) {
  // 현재 라인의 indentation 계산
  const value = textarea.value;
  const doc = cm.getDoc();
  const sel = doc.listSelections();
  const toInsert = text.endsWith('\n') ? text : text + '\n';
  doc.replaceSelection(toInsert, 'around');
}

function insertSnippetWithSelection(raw) {
  const doc = cm.getDoc();
  const sel = doc.listSelections()[0];
  const from = sel && sel.anchor ? (sel.anchor.line < sel.head.line || (sel.anchor.line === sel.head.line && sel.anchor.ch <= sel.head.ch) ? sel.anchor : sel.head) : doc.getCursor();
  const text = (raw.endsWith('\n') ? raw : raw + '\n');
  doc.replaceSelection(text, 'around');
  // 첫 자리표시자 ${...} 선택
  const open = text.indexOf('${');
  if (open >= 0) {
    const close = text.indexOf('}', open + 2);
    const innerStart = open + 2;
    const innerEnd = close >= 0 ? close : open + 2;
    // text 내 위치를 pos로 변환
    const before = text.slice(0, innerStart);
    const selText = text.slice(innerStart, innerEnd);
    const lines = before.split('\n');
    const lineOffset = lines.length - 1;
    const chOffset = lines[lines.length - 1].length;
    const startPos = { line: from.line + lineOffset, ch: (lineOffset === 0 ? from.ch : 0) + chOffset };
    const endPos = { line: startPos.line, ch: startPos.ch + selText.length };
    doc.setSelection(startPos, endPos);
  }
}

snippetBar.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-snippet]');
  if (!btn) return;
  const key = btn.getAttribute('data-snippet');
  const code = SNIPPETS[key];
  if (!code) return;
  // CodeMirror에 삽입 → undo/redo 지원 + 첫 자리표시자 선택
  insertSnippetWithSelection(code);
});

// Board 3x2
const boardEl = document.getElementById('board');
const defaultAddrs = [2,1,0,3,4,5];
const cells = [];
const cellState = defaultAddrs.map((addr) => ({ addr, color: [0,0,0], pressed: false, pendingPressed: false, pendingUnpressed: false }));

function renderBoard() {
  boardEl.innerHTML = '';
  cells.length = 0;
  cellState.forEach((st, i) => {
    const cell = document.createElement('div');
    cell.className = 'cell' + (st.pressed ? ' pressed' : '');
    cell.style.background = `rgb(${st.color[0]}, ${st.color[1]}, ${st.color[2]})`;
    const addr = document.createElement('div'); addr.className = 'addr'; addr.textContent = String(st.addr);
    const dotP = document.createElement('div'); dotP.className = 'pend pendP' + (st.pendingPressed ? ' show' : '');
    const dotU = document.createElement('div'); dotU.className = 'pend pendU' + (st.pendingUnpressed ? ' show' : '');
    cell.appendChild(addr); cell.appendChild(dotP); cell.appendChild(dotU);
    cell.addEventListener('click', async (ev) => {
      console.debug('[board] cell clicked index=', i, 'addr=', st.addr);
      const initHex = st.color.map(v=>v.toString(16).padStart(2,'0')).join('');
      const res = await openBoardPopover(ev.clientX, ev.clientY, { addr: st.addr, hex: initHex });
      if (!res.ok) return;
      const newAddr = Number(res.addr);
      if (Number.isFinite(newAddr) && newAddr >= 0 && newAddr <= 255) {
        if (cellState.some((c, idx) => idx !== i && c.addr === newAddr)) {
          alert('이미 사용중인 주소');
          return;
        }
        st.addr = newAddr;
      }
      const hex = (res.hex || '').replace(/[^0-9a-fA-F]/g, '');
      if (hex.length >= 6) {
        const r = parseInt(hex.slice(0,2), 16) || 0; const g = parseInt(hex.slice(2,4), 16) || 0; const b = parseInt(hex.slice(4,6), 16) || 0;
        st.color = [r,g,b];
        const payload = [st.addr & 0xFF, 1, r & 0xFF, g & 0xFF, b & 0xFF];
        appendHex(txLog, payload);
        await window.api.sendTx(payload);
      }
      updateCellUI(i);
    });
    boardEl.appendChild(cell);
    cells.push(cell);
  });
}

function updateCellUI(index) {
  const st = cellState[index];
  const cell = cells[index];
  if (!cell) return;
  cell.style.background = `rgb(${st.color[0]}, ${st.color[1]}, ${st.color[2]})`;
  const addrEl = cell.querySelector('.addr'); if (addrEl) addrEl.textContent = String(st.addr);
  cell.classList.toggle('pressed', !!st.pressed);
  const dotP = cell.querySelector('.pendP'); if (dotP) dotP.classList.toggle('show', st.pendingPressed);
  const dotU = cell.querySelector('.pendU'); if (dotU) dotU.classList.toggle('show', st.pendingUnpressed);
}
renderBoard();

// RX handling: 0xFFx4 or addr/value
window.api.onTcpRx?.((payload) => {
  if (!payload?.bytes) return;
  const bytes = payload.bytes;
  // log already handled above
  // handle addr/value
  if (bytes.length === 2) {
    const [addr, val] = bytes;
    const idx = cellState.findIndex(c => c.addr === addr);
    if (idx >= 0) {
      const st = cellState[idx];
      const pressed = val === 1;
      if (pressed && !st.pressed) st.pendingPressed = true;
      if (!pressed && st.pressed) st.pendingUnpressed = true;
      st.pressed = pressed;
      // update UI
      updateCellUI(idx);
    }
  }
});

// pending 값이 take* 호출로 소거되었을 때 즉시 UI 반영
window.api.onPendingUpdated?.(({ addr, pp, up }) => {
  const idx = cellState.findIndex(c => c.addr === addr);
  if (idx >= 0) {
    cellState[idx].pendingPressed = !!pp;
    cellState[idx].pendingUnpressed = !!up;
    updateCellUI(idx);
  }
});

// TX 반영: 보드 색 업데이트 (단일/연속)
function applyTxToBoard(bytes) {
  if (!Array.isArray(bytes) || bytes.length < 2) return;
  const start = bytes[0] & 0xff;
  const len = bytes[1] & 0xff;
  if (bytes.length === 5 && len === 1) {
    const rgb = [bytes[2] & 0xff, bytes[3] & 0xff, bytes[4] & 0xff];
    const idx = cellState.findIndex(c => c.addr === start);
    if (idx >= 0) { cellState[idx].color = rgb; updateCellUI(idx); }
  } else if (bytes.length >= 2 + (len * 3)) {
    for (let i = 0; i < len; i++) {
      const r = bytes[2 + i*3] & 0xff;
      const g = bytes[3 + i*3] & 0xff;
      const b = bytes[4 + i*3] & 0xff;
      const addr = (start + i) & 0xff;
      const idx = cellState.findIndex(c => c.addr === addr);
      if (idx >= 0) { cellState[idx].color = [r,g,b]; updateCellUI(idx); }
    }
  }
}

window.api.onTcpTxLocal?.((payload) => {
  if (payload?.bytes) { appendHex(txLog, payload.bytes); applyTxToBoard(payload.bytes); }
});

// 버튼 상태 초기화 → UI 반영
window.api.onButtonsReset?.(() => {
  for (let i = 0; i < cellState.length; i++) {
    cellState[i].pressed = false;
    cellState[i].pendingPressed = false;
    cellState[i].pendingUnpressed = false;
    updateCellUI(i);
  }
});


// TCP UI
let tcpState = 'disconnected';
let simulated = false;
function setTcpState(state) {
  tcpState = state;
  tcpStatusBtn.classList.remove('red', 'yellow', 'green', 'blue');
  if (state === 'connecting') tcpStatusBtn.classList.add('yellow');
  else if (state === 'connected') tcpStatusBtn.classList.add(simulated ? 'blue' : 'green');
  else if (state === 'simulated') tcpStatusBtn.classList.add('blue');
  else tcpStatusBtn.classList.add('red');
  const map = { connecting: '연결 시도중', connected: simulated ? '시뮬레이션(연결됨)' : '연결됨', simulated: '시뮬레이션', disconnected: '해제' };
  const el = document.getElementById('tcpStatusText');
  if (el) el.textContent = map[state] || '해제';
  if (simWrapper) simWrapper.style.display = state === 'simulated' ? '' : 'none';
}
setTcpState('disconnected');

tcpConnectBtn.addEventListener('click', async () => {
  if (tcpState === 'connected') {
    await window.api.tcpDisconnect();
    return;
  }
  if (tcpState === 'connecting') return; // 이미 시도중일 때 중복 방지
  if (simulated) return; // 시뮬레이션 중에는 연결 시도 불가
  setTcpState('connecting');
  await window.api.tcpConnect(tcpIpEl.value.trim(), Number(tcpPortEl.value));
});

simBtn.addEventListener('click', () => {
  if (tcpState === 'connecting') return; // 연결 시도중 제한
  simulated = !simulated;
  setTcpState(simulated ? 'simulated' : 'disconnected');
});

disconnectBtn.addEventListener('click', async () => {
  if (tcpState === 'connecting') return;
  if (tcpState === 'connected') {
    await window.api.tcpDisconnect();
  }
  // 실행 중이면 중단
  if (isRunning) {
    await window.api.stopScript();
  }
  simulated = false;
  setTcpState('disconnected');
});

window.api.onTcpStatus?.(({ status }) => {
  setTcpState(status);
  tcpConnectBtn.textContent = status === 'connected' ? '끊기' : '연결';
  if (status === 'disconnected' && simulated) setTcpState('simulated');
});

function appendHex(pre, bytes) {
  const hex = bytes.map(b => b.toString(16).padStart(2, '0')).join(' ');
  pre.textContent += hex + '\n';
  pre.scrollTop = pre.scrollHeight;
}

window.api.onTcpRx?.((payload) => {
  if (payload?.bytes) appendHex(rxLog, payload.bytes);
});
window.api.onTcpTxLocal?.((payload) => {
  if (payload?.bytes) appendHex(txLog, payload.bytes);
});

// Simulation panel: pressed/unpressed buttons per cell
function renderSimPanel() {
  if (!simPanel) return;
  simPanel.innerHTML = '';
  cellState.forEach((st) => {
    const press = document.createElement('button'); press.textContent = `${st.addr} press`;
    const release = document.createElement('button'); release.textContent = `${st.addr} release`;
    press.addEventListener('click', () => window.api.simulateSignal(st.addr, 1));
    release.addEventListener('click', () => window.api.simulateSignal(st.addr, 0));
    const wrap = document.createElement('div'); wrap.appendChild(press); wrap.appendChild(release);
    simPanel.appendChild(wrap);
  });
}
renderSimPanel();

// 메뉴/IPC 통합
window.api.onOpenedScript?.(({ path, content }) => {
  cm.setValue(content || '');
  window.api.setCurrentFile?.(path);
});
window.api.onSavedScript?.(({ path }) => {});
window.api.onRequestCode?.(() => { window.api.provideCode?.(cm.getValue()); });
window.api.onMenuRun?.(() => runBtn.click());
window.api.onFormatCode?.(() => formatCode());
window.api.onResetLayout?.(() => resetLayout());
window.api.onResetScript?.(() => {
  console.debug('[menu] Reset Script to Sample');
  cm.setValue(SAMPLE);
  localStorage.setItem('fe:script', SAMPLE);
});

// 자동 저장 (현재 파일이 있을 때만 실 저장 시도)
let autosaveTimer;
cm.on('change', () => {
  localStorage.setItem('fe:script', cm.getValue());
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async () => {
    const code = cm.getValue();
    await window.api?.saveToCurrent?.(code);
  }, 1000);
});

function ensurePrettier() {
  return new Promise((resolve) => {
    if (window.prettier && window.prettierPlugins) return resolve();
    const s1 = document.createElement('script');
    s1.src = 'https://unpkg.com/prettier@2.8.8/standalone.js';
    const s2 = document.createElement('script');
    s2.src = 'https://unpkg.com/prettier@2.8.8/parser-babel.js';
    let loaded = 0; const done = () => { if (++loaded === 2) resolve(); };
    s1.onload = done; s2.onload = done;
    document.body.appendChild(s1); document.body.appendChild(s2);
  });
}

async function formatCode() {
  try {
    await ensurePrettier();
    const src = cm.getValue();
    const formatted = window.prettier.format(src, { parser: 'babel', plugins: window.prettierPlugins, singleQuote: true, semi: true });
    cm.setValue(formatted);
  } catch (err) {
    appendOutput(`Error: 포맷 실패 - ${err?.message || err}`);
  }
}

// 드래그로 순서 바꾸기
(() => {
  const editorPane = document.querySelector('.editor-pane');
  const outputPane = document.querySelector('.output-pane');
  const container = document.querySelector('.container');
  function isBefore(a, b) { return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING; }
  function swapTo(order) {
    if (order === 'output-first') {
      container.insertBefore(outputPane, editorPane);
      container.insertBefore(resizer, outputPane);
    } else {
      container.insertBefore(editorPane, outputPane);
      container.insertBefore(resizer, outputPane);
    }
    localStorage.setItem('fe:layout:order', order);
  }
  function applySavedOrder() {
    const saved = localStorage.getItem('fe:layout:order');
    if (saved === 'output-first' || saved === 'editor-first') swapTo(saved);
  }
  applySavedOrder();
  function onDragStart(e) {
    const src = e.target.closest('[data-pane]');
    if (!src) return e.preventDefault();
    e.dataTransfer.setData('application/x-floor-pane', src.getAttribute('data-pane'));
    // 텍스트 드롭 방지
    e.dataTransfer.setData('text/plain', '');
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(e) {
    // resizer에는 드롭 금지
    if (e.target.id === 'resizer') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }
  function onDropEditor(e) {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/x-floor-pane');
    if (!type) return;
    if (type === 'output') swapTo('editor-first');
  }
  function onDropOutput(e) {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/x-floor-pane');
    if (!type) return;
    if (type === 'editor') swapTo('output-first');
  }
  editorPane.addEventListener('dragstart', onDragStart);
  outputPane.addEventListener('dragstart', onDragStart);
  editorPane.addEventListener('dragover', onDragOver);
  outputPane.addEventListener('dragover', onDragOver);
  editorPane.addEventListener('drop', onDropEditor);
  outputPane.addEventListener('drop', onDropOutput);
})();

function resetLayout() {
  const container = document.querySelector('.container');
  const editorPane = document.querySelector('.editor-pane');
  const outputPane = document.querySelector('.output-pane');
  const resizer = document.getElementById('resizer');
  localStorage.removeItem('fe:layout:leftWidth');
  localStorage.removeItem('fe:layout:order');
  container.style.gridTemplateColumns = '';
  // 기본 순서: editor | resizer | output
  container.insertBefore(editorPane, outputPane);
  container.insertBefore(resizer, outputPane);
}

// Drag resizer
(() => {
  if (!resizer) return;
  let dragging = false;
  const container = document.querySelector('.container');
  const RESIZER_WIDTH = 6;
  const MIN_LEFT = 150;
  const MIN_RIGHT = 150;

  // 초기값 복원
  const saved = localStorage.getItem('fe:layout:leftWidth');
  if (saved) {
    container.style.gridTemplateColumns = `${saved}px ${RESIZER_WIDTH}px 1fr`;
  }
  function onMouseDown(ev) {
    dragging = true;
    document.body.style.userSelect = 'none';
  }
  function onMouseMove(ev) {
    if (!dragging) return;
    const rect = container.getBoundingClientRect();
    const styles = window.getComputedStyle(container);
    const padL = parseFloat(styles.paddingLeft) || 0;
    const padR = parseFloat(styles.paddingRight) || 0;
    const totalContent = rect.width - padL - padR;
    const xFromContentLeft = ev.clientX - rect.left - padL;
    let leftWidth = xFromContentLeft;
    // 좌/우 최소 폭 보장
    leftWidth = Math.max(MIN_LEFT, Math.min(totalContent - MIN_RIGHT, leftWidth));
    container.style.gridTemplateColumns = `${leftWidth}px ${RESIZER_WIDTH}px 1fr`;
  }
  function onMouseUp() {
    dragging = false;
    document.body.style.userSelect = '';
    // 저장
    const cols = (container.style.gridTemplateColumns || '').split(' ');
    const leftPx = cols[0]?.endsWith('px') ? parseFloat(cols[0]) : null;
    if (leftPx) localStorage.setItem('fe:layout:leftWidth', String(leftPx));
  }
  function onDoubleClick() {
    // 50:50 초기화
    const rect = container.getBoundingClientRect();
    const styles = window.getComputedStyle(container);
    const padL = parseFloat(styles.paddingLeft) || 0;
    const padR = parseFloat(styles.paddingRight) || 0;
    const totalContent = rect.width - padL - padR;
    const leftWidth = Math.max(MIN_LEFT, Math.min(totalContent - MIN_RIGHT, totalContent / 2));
    container.style.gridTemplateColumns = `${leftWidth}px ${RESIZER_WIDTH}px 1fr`;
    localStorage.setItem('fe:layout:leftWidth', String(leftWidth));
  }
  resizer.addEventListener('mousedown', onMouseDown);
  resizer.addEventListener('dblclick', onDoubleClick);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
})();


