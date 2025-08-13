const { parentPort, workerData } = require('worker_threads');
const vm = require('vm');
const util = require('util');

function stringify(value) {
  try {
    if (typeof value === 'string') return value;
    return util.inspect(value, { depth: 3, colors: false, maxArrayLength: 50 });
  } catch (e) {
    return String(value);
  }
}

function postLog(level, args) {
  const text = args.map((a) => stringify(a)).join(' ');
  parentPort.postMessage({ type: 'log', line: `[${level}] ${text}` });
}

let reqId = 1;
function rpcGet(key, addr) {
  return new Promise((resolve) => {
    const id = reqId++;
    const onMsg = (msg) => {
      if (msg && msg.type === 'sandbox-reply' && msg.id === id) {
        parentPort.off('message', onMsg);
        resolve(msg.value);
      }
    };
    parentPort.on('message', onMsg);
    parentPort.postMessage({ type: 'sandbox-get', id, key, addr });
  });
}

// Cache for button states to enable sync-style getters in user scripts
const buttonCache = new Map(); // addr -> { pressed, pp, up }

// 메인 프로세스로부터 버튼 상태 업데이트를 받아서 로컬 캐시 동기화
parentPort.on('message', (msg) => {
  if (msg && msg.type === 'buttons-update') {
    const { addr, pressed, pp, up } = msg;
    const a = (addr >>> 0) & 0xff;
    const current = buttonCache.get(a) || { pressed: false, pp: false, up: false };
    buttonCache.set(a, {
      pressed: pressed !== undefined ? !!pressed : current.pressed,
      pp: pp !== undefined ? !!pp : current.pp,
      up: up !== undefined ? !!up : current.up
    });
  } else if (msg && msg.type === 'buttons-snapshot') {
    // 초기 상태 스냅샷 처리
    if (msg.items && Array.isArray(msg.items)) {
      for (const item of msg.items) {
        const a = (item.addr >>> 0) & 0xff;
        buttonCache.set(a, {
          pressed: !!item.pressed,
          pp: !!item.pp,
          up: !!item.up
        });
      }
    }
  }
});

(async () => {
  const { code } = workerData || {};
  const logs = [];
  const sandbox = {
    console: {
      log: (...args) => postLog('log', args),
      info: (...args) => postLog('info', args),
      warn: (...args) => postLog('warn', args),
      error: (...args) => postLog('error', args),
    },
    alert: (text) => parentPort.postMessage({ type: 'alert', text: String(text) }),
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval,
    Math,
    Date,
    // 통신 API (동기처럼 동작)
    getButtonState: (addr) => {
      const a = (addr >>> 0) & 0xff;
      const st = buttonCache.get(a);
      if (st) return !!st.pressed;
      return false;
    },
    takePressedPending: (addr) => {
      const a = (addr >>> 0) & 0xff;
      const st = buttonCache.get(a) || { pressed: false, pp: false, up: false };
      const val = !!st.pp;
      if (st.pp) {
        st.pp = false;
        buttonCache.set(a, st);
        // pending 상태가 실제로 변경되었을 때만 메시지 전송
        parentPort.postMessage({ type: 'pending-consume', kind: 'pp', addr: a });
      }
      return val;
    },
    takeUnpressedPending: (addr) => {
      const a = (addr >>> 0) & 0xff;
      const st = buttonCache.get(a) || { pressed: false, pp: false, up: false };
      const val = !!st.up;
      if (st.up) {
        st.up = false;
        buttonCache.set(a, st);
        // pending 상태가 실제로 변경되었을 때만 메시지 전송
        parentPort.postMessage({ type: 'pending-consume', kind: 'up', addr: a });
      }
      return val;
    },
    sendColor: (addr, rgb) => parentPort.postMessage({ type: 'sandbox-tx', kind: 'color', addr, rgb }),
    sendColorRange: (start, colors) => parentPort.postMessage({ type: 'sandbox-tx', kind: 'range', start, colors }),
  };

  vm.createContext(sandbox);
  const wrapped = `(async () => {\n${String(code || '')}\n})()`;
  const script = new vm.Script(wrapped, { filename: 'user-script.js' });

  const start = Date.now();
  try {
    const pending = script.runInContext(sandbox);
    const result = await Promise.resolve(pending);
    parentPort.postMessage({ type: 'done', ok: true, result: stringify(result), timeMs: Date.now() - start });
  } catch (err) {
    parentPort.postMessage({ type: 'done', ok: false, error: String(err && err.message ? err.message : err), timeMs: Date.now() - start });
  }
})().catch((err) => {
  parentPort.postMessage({ type: 'done', ok: false, error: String(err && err.message ? err.message : err) });
});


