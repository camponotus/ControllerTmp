// === 수정된 DDR 스타일 스크립트 (takePressedPending 펜딩 동작 반영) ===
// noteLines에 로그 넣고 실행하세요.
// 라인 형식 예: "[14:32:15.123] 00 01"

const noteLines = [
    // 예시:
    "[14:56:48.604] 05 01",
    "[14:56:49.923] 04 01",
    "[14:56:50.961] 05 00",
    "[14:56:51.560] 01 01",
    "[14:56:52.299] 04 00",
    "[14:56:52.979] 02 01",
    "[14:56:53.798] 01 00",
    "[14:56:54.456] 03 01",
    "[14:56:55.255] 02 00",
    "[14:56:55.914] 04 01",
    "[14:56:56.594] 03 00",
    "[14:56:57.613] 04 00",
];

// --- 설정값 ---
const PHYSICAL_MAX = 6;           // 실제 물리 발판 0..5
const preSignalMs = 300;          // 노트 시작 전에 어두운 노란색
const goodWindowMs = 300;         // start로부터 이내면 '흰색' 대신 '녹색'
const flashDurationMs = 150;      // 배경(전체) 색상 깜빡임 길이
const lateToleranceMs = 30;       // takePressedPending 호출 지연 보정 여유 (선택값)
const FPS = 24;                   // 프레임 제한
const frameMs = 1000 / FPS;
const BUTTON_MAX = 6;            // 버튼 주소 스캔 범위

// 색상
const DARK = [0, 0, 0];
const DARK_YELLOW = [120, 120, 0];
const YELLOW = [255, 255, 0];
const GREEN = [0, 255, 0];
const WHITE = [255, 255, 255];
const BLUE = [0, 0, 255];
const RED = [255, 0, 0];

// --- 유틸 ---
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function parseTimeToMs(timestr) {
    const [hms, msPart] = timestr.split('.');
    const [hh, mm, ss] = hms.split(':').map(Number);
    const ms = Number(msPart || 0);
    return ((hh * 3600 + mm * 60 + ss) * 1000) + ms;
}
function parseLinesToEvents(lines) {
    const events = [];
    for (const line of lines) {
        const m = line.match(/^\s*\[?(\d{2}:\d{2}:\d{2}\.\d{1,3})\]?\s+([0-9A-Fa-f]{2})\s+([0-9A-Fa-f]{2})\s*$/);
        if (!m) continue;
        const timestr = m[1];
        const addrHex = m[2];
        const flagHex = m[3];
        const t = parseTimeToMs(timestr);
        const addr = parseInt(addrHex, 16);
        const pressed = (flagHex !== '00');
        events.push({ t, addr, pressed });
    }
    if (events.length === 0) return [];
    const base = events[0].t;
    return events.map(e => ({ t: e.t - base, addr: e.addr, pressed: e.pressed }));
}
function eventsToNotes(events) {
    const notes = [];
    const open = {};
    for (const ev of events) {
        if (ev.pressed) {
            if (!open[ev.addr]) open[ev.addr] = { addr: ev.addr, start: ev.t, end: null };
        } else {
            if (open[ev.addr]) {
                open[ev.addr].end = ev.t;
                notes.push(open[ev.addr]);
                delete open[ev.addr];
            }
        }
    }
    for (const a in open) {
        const n = open[a];
        n.end = n.start + 300;
        notes.push(n);
    }
    return notes.filter(n => n.addr >= 0 && n.addr < PHYSICAL_MAX)
        .sort((a, b) => a.start - b.start);
}

// --- 상태 ---
let notes = [];
let bg = DARK;
const PAD_STATE = { OFF: DARK, BACKGROUND: bg, ACTIVE: YELLOW, GOOD: GREEN, HIT: WHITE, MISS: RED };
const padState = new Array(PHYSICAL_MAX).fill().map(() => ({ state: PAD_STATE.OFF }));

const pendingTasks = new Set();
function track(promise) {
    try { pendingTasks.add(promise); } catch { }
    promise.finally(() => { try { pendingTasks.delete(promise); } catch { } });
    return promise;
}

function setPadActive(addr) {
    padState[addr].state = PAD_STATE.ACTIVE;
}

function setPadBackground(addr) {
    padState[addr].state = PAD_STATE.BACKGROUND;
}

function setPadGood(addr) {
    padState[addr].state = PAD_STATE.GOOD;
}

function setPadHit(addr) {
    padState[addr].state = PAD_STATE.HIT;
}

async function flashBackground(color, duration) {
    const saved = bg;
    bg = color;
    // 모든 패드 상태 갱신
    for (let i = 0; i < PHYSICAL_MAX; i++) {
        if (padState[i].state === PAD_STATE.BACKGROUND) {
            padState[i].state = color;
        }
    }
    // 화면에 반영
    sendColorRange(0, padState.map(p => p.state));

    // duration 후 복구
    await sleep(duration);
    bg = saved;
    for (let i = 0; i < PHYSICAL_MAX; i++) {
        if (padState[i].state === color) {
            padState[i].state = PAD_STATE.BACKGROUND;
        }
    }
    sendColorRange(0, padState.map(p => p.state));
}

// --- 메인 실행 ---
async function main() {
    console.info("Parsing note lines...");
    const events = parseLinesToEvents(noteLines);
    notes = eventsToNotes(events).map(n => ({ ...n, hit: false, active: false }));
    if (notes.length === 0) {
        alert("노트 데이터가 비어있습니다. noteLines에 로그를 넣어주세요.");
        return;
    }
    console.info(`Parsed ${notes.length} notes.`);
    for (const n of notes) {
        console.log(n);
    }

    // 마지막 노트 종료 시각
    const lastEnd = Math.max(...notes.map(n => n.end));

    // 초기화: 모든 패드 끄기
    sendColorRange(0, new Array(PHYSICAL_MAX).fill(DARK));

    const startTime = Date.now();
    function nowRel() { return Date.now() - startTime; }

    let nextAt = Date.now() + frameMs;
    let running = true;

    let currentNodes = [];

    while (running) {
        const t = nowRel();

        // 활성 노트 추가
        for (const n of notes) {
            if (!n.active && t >= n.start) {
                currentNodes.push(n);
                setPadActive(n.addr);
                n.active = true;
            }
        }

        // 활성 노트 수명 종료
        for (const n of currentNodes) {
            if (n.active && t >= n.end) {
                setPadBackground(n.addr);
                currentNodes = currentNodes.filter(node => node !== n);
            }
        }

        // pressed 펜딩 확인
        try {
            for (let a = 0; a < BUTTON_MAX; a++) {
                try {
                    if (takePressedPending(a)) {
                        console.log("takePressedPending", a);
                        const cand = notes.find(nt => nt.addr === a && nt.active && !nt.hit);
                        if (cand) {
                            const delta = t - cand.start;
                            if (delta <= goodWindowMs) {
                                setPadGood(a);
                                cand.hit = true;
                                await flashBackground(BLUE, flashDurationMs);
                            } else {
                                setPadHit(a);
                                cand.hit = true;
                                await flashBackground(BLUE, flashDurationMs);
                            }
                        } else {
                            await flashBackground(RED, flashDurationMs);
                        }
                    }
                } catch (e) {
                    console.error("takePressedPending error:", e);
                }
            }

            // unpressed 펜딩 확인 
            for (let a = 0; a < BUTTON_MAX; a++) {
                try {
                    if (takeUnpressedPending(a)) {
                        console.log("takeUnpressedPending", a);
                    }
                } catch (e) {
                    console.error("takeUnpressedPending error:", e);
                }
            }

            // 컬러 업데이트
            sendColorRange(0, padState.map(p => p.state));

            // 마지막 노트의 end로부터 1초 후 종료
            if (t >= lastEnd + 1000) {
                break;
            }

            // 프레임 타이밍 제어
            const wait = nextAt - Date.now();
            if (wait > 0) await sleep(wait);
            nextAt += frameMs;
            if (Date.now() - nextAt > frameMs * 5) {
                nextAt = Date.now() + frameMs;
            }
        } catch (e) {
            console.error("main error:", e);
        }

    }
    // 종료 시 전체 끄기
    sendColorRange(0, new Array(PHYSICAL_MAX).fill(DARK));
}

// 실행
let mainPromise = main().catch(console.error);
await mainPromise;
