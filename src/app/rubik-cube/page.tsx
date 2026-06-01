'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import aesjs from 'aes-js';

// ── Types ──
interface Formula { id: string; name: string; formula: string; description: string; difficulty?: 'beginner' | 'intermediate' | 'advanced'; }
interface Stats { correct: number; wrong: number; streak: number; bestStreak: number; }
interface LogEntry { id: number; time: string; message: string; type: 'info' | 'success' | 'error' | 'warning'; }

// ═══════════════════════════════════════════════════════════════════
// QiYi Smart Cube BLE Protocol
// Service: 0000fff0-0000-1000-8000-00805f9b34fb
// ALL comms on fff6 (both WRITE and NOTIFY)
// AES-128-ECB key: 57b1f9abcd5ae8a79cb98ce7578c5108
// ═══════════════════════════════════════════════════════════════════

const QIYI_SERVICE = '0000fff0-0000-1000-8000-00805f9b34fb';
const QIYI_CHAR = '0000fff6-0000-1000-8000-00805f9b34fb';
const AES_KEY_BYTES = [0x57, 0xb1, 0xf9, 0xab, 0xcd, 0x5a, 0xe8, 0xa7, 0x9c, 0xb9, 0x8c, 0xe7, 0x57, 0x8c, 0x51, 0x08];

function crc16(data: Uint8Array): number {
  let crc = 0xFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) crc = (crc & 1) ? ((crc >> 1) ^ 0xA001) : (crc >> 1);
  }
  return crc;
}

function aesEncrypt(data: Uint8Array): Uint8Array {
  const padLen = (16 - (data.length % 16)) % 16;
  const padded = new Uint8Array(data.length + padLen);
  padded.set(data);
  return new aesjs.ModeOfOperation.ecb(AES_KEY_BYTES).encrypt(padded);
}

function aesDecrypt(data: Uint8Array): Uint8Array {
  return new aesjs.ModeOfOperation.ecb(AES_KEY_BYTES).decrypt(data);
}

function buildMessage(payload: number[]): Uint8Array {
  const len = payload.length + 4;
  const msg = new Uint8Array(len);
  msg[0] = 0xFE; msg[1] = len;
  for (let i = 0; i < payload.length; i++) msg[i + 2] = payload[i];
  const crc = crc16(msg.slice(0, len - 2));
  msg[len - 2] = crc & 0xFF; msg[len - 1] = (crc >> 8) & 0xFF;
  return aesEncrypt(msg);
}

function parseMessage(raw: Uint8Array): { opcode: number; msg: Uint8Array } | null {
  try {
    const dec = aesDecrypt(raw);
    let s = 0;
    while (s < dec.length && dec[s] !== 0xFE) s++;
    if (s >= dec.length) return null;
    const mLen = dec[s + 1];
    if (mLen < 4 || s + mLen > dec.length) return null;
    const msg = dec.slice(s, s + mLen);
    return { opcode: msg[2], msg };
  } catch { return null; }
}

function buildAck(receivedMsg: Uint8Array): Uint8Array {
  const ack = new Uint8Array(9);
  ack[0] = 0xFE; ack[1] = 0x09;
  for (let i = 0; i < 5; i++) ack[2 + i] = receivedMsg[2 + i];
  const crc = crc16(ack.slice(0, 7));
  ack[7] = crc & 0xFF; ack[8] = (crc >> 8) & 0xFF;
  return aesEncrypt(ack);
}

function buildAppHello(macBytes: number[]): Uint8Array {
  const rev = [macBytes[5], macBytes[4], macBytes[3], macBytes[2], macBytes[1], macBytes[0]];
  const p = new Uint8Array(21);
  p[0] = 0xFE; p[1] = 0x15;
  for (let i = 0; i < 6; i++) p[13 + i] = rev[i];
  const crc = crc16(p.slice(0, 19));
  p[19] = crc & 0xFF; p[20] = (crc >> 8) & 0xFF;
  return aesEncrypt(p);
}

// Move table: byte → notation
const MOVE_TABLE: Record<number, string> = {
  0x01: "L'", 0x02: 'L', 0x03: "R'", 0x04: 'R',
  0x05: "D'", 0x06: 'D', 0x07: "U'", 0x08: 'U',
  0x09: "F'", 0x0A: 'F', 0x0B: "B'", 0x0C: 'B',
};

// ── Cube state: 27 bytes → 54 facelet colors ──
// Protocol: 0=orange, 1=red, 2=yellow, 3=white, 4=green, 5=blue
// Face order: U(0-8), R(9-17), F(18-26), D(27-35), L(36-44), B(45-53)
// Each byte: lower nibble = first facelet, upper nibble = second facelet
const CUBE_COLORS: Record<number, string> = {
  0: '#FF6600', // orange → L face in standard, but QiYi uses this
  1: '#B71234', // red → R face
  2: '#FFD500', // yellow → D face
  3: '#FFFFFF', // white → U face
  4: '#009B48', // green → F face
  5: '#0046AD', // blue → B face
};

function parseCubeState(stateBytes: number[]): string[] {
  const f: string[] = [];
  for (const b of stateBytes) {
    f.push(CUBE_COLORS[b & 0x0F] || '#333');
    f.push(CUBE_COLORS[(b >> 4) & 0x0F] || '#333');
  }
  return f; // 54 facelets
}

// ── Formula Library ──
const formulaLibrary: Record<string, Formula[]> = {
  OLL: [
    { id: 'OLL-1', name: '点→十字', formula: "F R U R' U' F'", description: '顶层十字', difficulty: 'beginner' },
    { id: 'OLL-2', name: '点→十字', formula: "F U R U' R' F'", description: '另一种十字', difficulty: 'beginner' },
    { id: 'OLL-3', name: '十字→全黄', formula: "R U R' U R U2 R'", description: '鱼形', difficulty: 'intermediate' },
    { id: 'OLL-4', name: '十字→全黄', formula: "R U2 R' U' R U' R'", description: '反鱼形', difficulty: 'intermediate' },
    { id: 'OLL-21', name: '十字+两侧', formula: "R U2 R' U' R U R' U' R U' R'", description: '21号', difficulty: 'advanced' },
    { id: 'OLL-26', name: '反鱼形', formula: "R U2 R' U' R U' R'", description: '反鱼形', difficulty: 'beginner' },
    { id: 'OLL-27', name: '正鱼形', formula: "R U R' U R U2 R'", description: '正鱼形', difficulty: 'beginner' },
  ],
  PLL: [
    { id: 'PLL-Ua', name: 'Ua', formula: "R U R' U R' U' R2 U' R' U R' U R", description: '顺时针三棱换', difficulty: 'intermediate' },
    { id: 'PLL-Ub', name: 'Ub', formula: "R' U R' U' R2 U' R' U R U R2", description: '逆时针三棱换', difficulty: 'intermediate' },
    { id: 'PLL-H', name: 'H', formula: "M2 U M2 U2 M2 U M2", description: '对棱换', difficulty: 'beginner' },
    { id: 'PLL-T', name: 'T', formula: "R U R' U' R' F R2 U' R' U' R U R' F'", description: 'T排列', difficulty: 'intermediate' },
  ],
  F2L: [
    { id: 'F2L-1', name: '基础1', formula: "U R U' R'", description: '角在底棱在顶', difficulty: 'beginner' },
    { id: 'F2L-2', name: '基础2', formula: "U' F' U F", description: '角在底棱在顶', difficulty: 'beginner' },
    { id: 'F2L-3', name: '基础3', formula: "R U' R'", description: '都在底层', difficulty: 'beginner' },
    { id: 'F2L-5', name: '角朝上', formula: "R U2 R' U' R U R'", description: '白色朝上', difficulty: 'intermediate' },
  ],
};

// ── 3D Cube Component (responsive, colors from real cube) ──
// Facelet layout for 3×3 cube:
// U face (white on top): facelets[0..8] arranged 3×3
// R face (red on right): facelets[9..17]
// F face (green on front): facelets[18..26]
// D face (yellow on bottom): facelets[27..35]
// L face (orange on left): facelets[36..44]
// B face (blue on back): facelets[45..53]

function Cube3D({ rx, ry, facelets, size = 180 }: { rx: number; ry: number; facelets?: string[]; size?: number }) {
  const defaultF = useMemo(() => {
    const f: string[] = [];
    for (let i = 0; i < 9; i++) f.push('#FFFFFF'); // U
    for (let i = 0; i < 9; i++) f.push('#B71234'); // R
    for (let i = 0; i < 9; i++) f.push('#009B48'); // F
    for (let i = 0; i < 9; i++) f.push('#FFD500'); // D
    for (let i = 0; i < 9; i++) f.push('#FF6600'); // L
    for (let i = 0; i < 9; i++) f.push('#0046AD'); // B
    return f;
  }, []);
  const f = facelets || defaultF;

  // Get facelet color for a specific face + row + col
  // faceOffset: U=0, R=9, F=18, D=27, L=36, B=45
  const getColor = (faceOffset: number, row: number, col: number) => {
    return f[faceOffset + row * 3 + col] || '#333';
  };

  const cubieSize = size / 3.5;
  const gap = size * 0.015;
  const cubeSize = cubieSize * 3 + gap * 4;

  return (
    <div style={{ perspective: `${size * 3}px`, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        width: cubeSize, height: cubeSize, position: 'relative',
        transformStyle: 'preserve-3d',
        transform: `rotateX(${rx}deg) rotateY(${ry}deg)`,
        transition: 'transform 0.15s ease-out'
      }}>
        {/* Generate 27 cubies */}
        {Array.from({ length: 27 }).map((_, idx) => {
          const x = idx % 3 - 1;           // -1, 0, 1 (left to right)
          const y = 1 - Math.floor(idx / 9); // 1, 0, -1 (top to bottom)
          const z = 1 - Math.floor(idx / 3) % 3; // 1, 0, -1 (front to back)

          const faces: Record<string, string> = {};
          // Top face (y=1): U face, row=z+1→0..2, col=x+1→0..2
          if (y === 1) faces.top = getColor(0, 1 - z, x + 1);
          // Bottom face (y=-1): D face
          if (y === -1) faces.bottom = getColor(27, z + 1, x + 1);
          // Front face (z=1): F face
          if (z === 1) faces.front = getColor(18, 1 - y, x + 1);
          // Back face (z=-1): B face (mirrored)
          if (z === -1) faces.back = getColor(45, 1 - y, 2 - x);
          // Right face (x=1): R face
          if (x === 1) faces.right = getColor(9, 1 - y, 1 - z);
          // Left face (x=-1): L face
          if (x === -1) faces.left = getColor(36, 1 - y, z + 1);

          const tx = x * (cubieSize + gap) + cubeSize / 2 - cubieSize / 2;
          const ty = -y * (cubieSize + gap) + cubeSize / 2 - cubieSize / 2;
          const tz = z * (cubieSize / 2 + gap);

          return (
            <div key={idx} style={{
              position: 'absolute', width: cubieSize, height: cubieSize,
              transformStyle: 'preserve-3d',
              transform: `translate3d(${tx}px, ${ty}px, ${tz}px)`
            }}>
              {([
                ['top', `rotateX(90deg) translateZ(${cubieSize / 2}px)`],
                ['bottom', `rotateX(-90deg) translateZ(${cubieSize / 2}px)`],
                ['front', `translateZ(${cubieSize / 2}px)`],
                ['back', `rotateY(180deg) translateZ(${cubieSize / 2}px)`],
                ['right', `rotateY(90deg) translateZ(${cubieSize / 2}px)`],
                ['left', `rotateY(-90deg) translateZ(${cubieSize / 2}px)`],
              ] as [string, string][]).map(([k, t]) => (
                <div key={k} style={{
                  position: 'absolute', width: cubieSize, height: cubieSize,
                  transform: t,
                  background: faces[k] || '#1a1a2e',
                  border: '1px solid #0a0a1a',
                  borderRadius: cubieSize * 0.08,
                  boxSizing: 'border-box',
                }} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Formula Detail Card (shared between mobile & desktop) ──
function FormulaDetail({ formula, practicing, moves, wrongs, hlStep, progress, time, onStart, onReset }: {
  formula: Formula; practicing: boolean; moves: string[]; wrongs: Set<number>; hlStep: number;
  progress: number; time: number; onStart: () => void; onReset: () => void;
}) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#e2e8f0' }}>{formula.id}: {formula.name}</h3>
          <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>{formula.description}</p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {!practicing ? <button onClick={onStart} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer', background: '#06b6d4', color: '#fff' }}>▶ 开始</button> : <button onClick={onReset} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: '#94a3b8' }}>⏹ 重置</button>}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {formula.formula.split(' ').map((m, i) => (
          <span key={i} style={{
            fontFamily: '"SF Mono", Menlo, monospace', fontSize: 16, fontWeight: 600,
            padding: '6px 12px', borderRadius: 8,
            background: i === hlStep ? 'rgba(74,222,128,0.2)' : wrongs.has(i) ? 'rgba(248,113,113,0.2)' : i < moves.length ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
            color: i === hlStep ? '#4ade80' : wrongs.has(i) ? '#f87171' : i < moves.length ? '#94a3b8' : '#64748b',
            border: `1px solid ${i === hlStep ? 'rgba(74,222,128,0.3)' : wrongs.has(i) ? 'rgba(248,113,113,0.3)' : 'rgba(255,255,255,0.06)'}`,
            transition: 'all 0.15s'
          }}>{m}</span>
        ))}
      </div>
      {practicing && (
        <>
          <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg,#22d3ee,#3b82f6)', borderRadius: 2, transition: 'width 0.3s' }} />
          </div>
          <div style={{ fontSize: 12, color: '#64748b', textAlign: 'center', marginTop: 8 }}>{time.toFixed(1)}s · 步骤 {moves.length}/{formula.formula.split(' ').length}</div>
        </>
      )}
    </div>
  );
}

// ── Main Component ──
export default function RubikCubeTrainer() {
  const [cat, setCat] = useState('OLL');
  const [formula, setFormula] = useState<Formula | null>(null);
  const [practicing, setPracticing] = useState(false);
  const [moves, setMoves] = useState<string[]>([]);
  const [wrongs, setWrongs] = useState<Set<number>>(new Set());
  const [stats, setStats] = useState<Stats>({ correct: 0, wrong: 0, streak: 0, bestStreak: 0 });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [time, setTime] = useState(0);
  const [connected, setConnected] = useState(false);
  const [connStatus, setConnStatus] = useState('未连接');
  const [connecting, setConnecting] = useState(false);
  const [rx, setRx] = useState(-25); const [ry, setRy] = useState(35);
  const [diff, setDiff] = useState('all');
  const [hlStep, setHlStep] = useState(-1);
  const [lastMove, setLastMove] = useState<string | null>(null);
  const [battery, setBattery] = useState<number | null>(null);
  const [showSafari, setShowSafari] = useState(false);
  const [cubeFacelets, setCubeFacelets] = useState<string[] | null>(null);
  const [showLog, setShowLog] = useState(false);

  const startRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logId = useRef(0);
  const dragging = useRef(false);
  const lastM = useRef({ x: 0, y: 0 });
  const connLock = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const charRef = useRef<any>(null);

  const addLog = useCallback((msg: string, type: LogEntry['type'] = 'info') => {
    logId.current++;
    setLogs(p => [{ id: logId.current, time: new Date().toLocaleTimeString(), message: msg, type }, ...p].slice(0, 60));
  }, []);

  const formulas = useMemo(() => {
    const l = formulaLibrary[cat] || [];
    return diff === 'all' ? l : l.filter(f => f.difficulty === diff);
  }, [cat, diff]);

  const handleMove = useCallback((move: string) => {
    setLastMove(move);
    addLog(`🎲 ${move}`, 'success');
    if (formula && practicing) {
      const expected = formula.formula.split(' ');
      const idx = moves.length;
      if (idx < expected.length) {
        const exp = expected[idx].replace(/\s+/g, '').toUpperCase();
        const act = move.replace(/\s+/g, '').toUpperCase();
        if (act === exp) {
          setStats(p => { const ns = p.streak + 1; return { correct: p.correct + 1, wrong: p.wrong, streak: ns, bestStreak: Math.max(p.bestStreak, ns) }; });
          addLog(`✅ ${idx + 1}: ${move}`, 'success'); setHlStep(idx + 1);
        } else {
          setStats(p => ({ ...p, wrong: p.wrong + 1, streak: 0 }));
          setWrongs(p => new Set(p).add(idx));
          addLog(`❌ 期望${expected[idx]}，实际${move}`, 'error');
        }
        setMoves(p => [...p, move]);
        if (idx + 1 === expected.length && act === exp) {
          const t = ((Date.now() - (startRef.current || Date.now())) / 1000).toFixed(1);
          addLog(`🎉 完成！${t}s`, 'success'); setPracticing(false);
          if (timerRef.current) clearInterval(timerRef.current);
        }
      }
    }
  }, [formula, practicing, moves, addLog]);

  // ── BLE Connect ──
  const connect = useCallback(async () => {
    if (connLock.current) return;
    connLock.current = true; setConnecting(true);

    if (!('bluetooth' in navigator)) {
      const ua = navigator.userAgent;
      addLog(/^((?!chrome|android).)*safari/i.test(ua) ? '⚠️ Safari不支持蓝牙，请用Chrome' : '⚠️ 不支持Web Bluetooth', 'error');
      connLock.current = false; setConnecting(false); return;
    }

    addLog('🔍 搜索奇艺智能魔方...', 'info');
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bt = (navigator as unknown as { bluetooth: { requestDevice: (o: Record<string, unknown>) => Promise<any> } }).bluetooth;
      const device = await bt.requestDevice({
        filters: [{ namePrefix: 'QY' }],
        optionalServices: [QIYI_SERVICE],
      });
      addLog(`📱 ${device.name}`, 'success');

      const server = await device.gatt.connect();
      addLog('🔗 GATT OK', 'info');
      const service = await server.getPrimaryService(QIYI_SERVICE);
      const mainChar = await service.getCharacteristic(QIYI_CHAR);
      charRef.current = mainChar;
      addLog('✅ fff6 (READ+WRITE+NOTIFY)', 'success');

      const MAC_BYTES = [0xCC, 0xA3, 0x00, 0x00, 0xCC, 0x3E];

      // Subscribe to notifications
      mainChar.addEventListener('characteristicvaluechanged', ((event: Event) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const val = (event.target as any).value as DataView;
        if (!val) return;
        const raw = new Uint8Array(val.buffer);

        const parsed = parseMessage(raw);
        if (!parsed) return;
        const { opcode, msg } = parsed;

        if (opcode === 0x02) {
          // Cube Hello
          const batt = msg[35];
          setBattery(batt);
          addLog(`🧊 Cube Hello! 电量:${batt}%`, 'success');
          const stateBytes = Array.from(msg.slice(7, 34));
          setCubeFacelets(parseCubeState(stateBytes));
          const ack = buildAck(msg);
          charRef.current?.writeValueWithoutResponse(ack).catch(() => {});
        } else if (opcode === 0x03) {
          // State Change
          const moveByte = msg[34];
          const move = MOVE_TABLE[moveByte];
          if (move) handleMove(move);
          const batt = msg[35];
          if (batt !== undefined) setBattery(batt);
          const stateBytes = Array.from(msg.slice(7, 34));
          setCubeFacelets(parseCubeState(stateBytes));
          if (msg.length >= 92 && msg[91] === 1) {
            const ack = buildAck(msg);
            charRef.current?.writeValueWithoutResponse(ack).catch(() => {});
          }
        } else if (opcode === 0x04) {
          addLog('🧊 状态已同步', 'success');
        }
      }) as EventListener);

      await mainChar.startNotifications();
      addLog('🔔 已订阅通知', 'success');
      await new Promise(r => setTimeout(r, 100));

      // Send App Hello
      const helloMsg = buildAppHello(MAC_BYTES);
      await mainChar.writeValueWithoutResponse(helloMsg);
      addLog('📤 App Hello 已发送', 'success');

      setConnected(true);
      setConnStatus(`已连接: ${device.name}`);
      addLog('✅ 连接完成，转动魔方！', 'success');

      device.addEventListener('gattserverdisconnected', () => {
        setConnected(false); setConnStatus('已断开');
        charRef.current = null; setBattery(null); setCubeFacelets(null);
        addLog('🔌 已断开', 'warning');
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '未知错误';
      addLog(msg.includes('cancelled') ? '用户取消' : `❌ ${msg}`, 'error');
    } finally {
      connLock.current = false; setConnecting(false);
    }
  }, [addLog, handleMove]);

  const selectFormula = useCallback((id: string) => {
    const f = formulas.find(x => x.id === id);
    if (f) { setFormula(f); setMoves([]); setWrongs(new Set()); setHlStep(-1); }
  }, [formulas]);

  const startPractice = useCallback(() => {
    if (!formula) return;
    setPracticing(true); setMoves([]); setWrongs(new Set()); setHlStep(0);
    setStats({ correct: 0, wrong: 0, streak: 0, bestStreak: 0 }); setTime(0);
    startRef.current = Date.now(); addLog(`开始: ${formula.id}`, 'success');
    timerRef.current = setInterval(() => { if (startRef.current) setTime(parseFloat(((Date.now() - startRef.current) / 1000).toFixed(1))); }, 100);
  }, [formula, addLog]);

  const resetPractice = useCallback(() => {
    setPracticing(false); setMoves([]); setWrongs(new Set()); setHlStep(-1);
    setStats({ correct: 0, wrong: 0, streak: 0, bestStreak: 0 }); setTime(0);
    startRef.current = null; if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);
  useEffect(() => { if (typeof window !== 'undefined' && /^((?!chrome|android).)*safari/i.test(navigator.userAgent) && !('bluetooth' in navigator)) setShowSafari(true); }, []);

  const progress = formula ? (moves.length / formula.formula.split(' ').length) * 100 : 0;

  const diffMeta = (d?: string) => {
    switch (d) {
      case 'beginner': return { label: '初级', color: '#4ade80', bg: 'rgba(74,222,128,0.15)' };
      case 'intermediate': return { label: '中级', color: '#facc15', bg: 'rgba(250,204,21,0.15)' };
      case 'advanced': return { label: '高级', color: '#f87171', bg: 'rgba(248,113,113,0.15)' };
      default: return { label: '全部', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' };
    }
  };

  // ── Touch drag for 3D rotation ──
  const cubeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = cubeRef.current;
    if (!el) return;
    const onStart = (ex: number, ey: number) => { dragging.current = true; lastM.current = { x: ex, y: ey }; };
    const onMove = (ex: number, ey: number) => {
      if (!dragging.current) return;
      const dx = ex - lastM.current.x; const dy = ey - lastM.current.y;
      setRy(p => p + dx * 0.5); setRx(p => p - dy * 0.5);
      lastM.current = { x: ex, y: ey };
    };
    const onEnd = () => { dragging.current = false; };
    const mD = (e: MouseEvent) => onStart(e.clientX, e.clientY);
    const mM = (e: MouseEvent) => onMove(e.clientX, e.clientY);
    const tS = (e: TouchEvent) => { const t = e.touches[0]; onStart(t.clientX, t.clientY); };
    const tM = (e: TouchEvent) => { const t = e.touches[0]; onMove(t.clientX, t.clientY); };
    el.addEventListener('mousedown', mD); window.addEventListener('mousemove', mM); window.addEventListener('mouseup', onEnd);
    el.addEventListener('touchstart', tS, { passive: true }); el.addEventListener('touchmove', tM, { passive: true }); el.addEventListener('touchend', onEnd);
    return () => { el.removeEventListener('mousedown', mD); window.removeEventListener('mousemove', mM); window.removeEventListener('mouseup', onEnd); el.removeEventListener('touchstart', tS); el.removeEventListener('touchmove', tM); el.removeEventListener('touchend', onEnd); };
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #030712, #0f172a, #030712)', color: '#e2e8f0', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif' }}>
      {showSafari && <div style={{ background: 'rgba(245,158,11,0.1)', borderBottom: '1px solid rgba(245,158,11,0.2)', padding: '10px 16px', textAlign: 'center', fontSize: 13, color: '#fbbf24' }}>⚠️ Safari不支持蓝牙，请用Chrome/Edge</div>}

      {/* ── Header ── */}
      <header style={{ padding: '16px 16px 8px' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, background: 'linear-gradient(135deg,#22d3ee,#3b82f6,#a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>🎲 魔方速拧训练</h1>
            <p style={{ fontSize: 11, color: '#64748b', margin: '2px 0 0' }}>CFOP · 奇艺智能魔方 BLE</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {lastMove && <div style={{ fontFamily: '"SF Mono", Menlo, monospace', fontSize: 18, fontWeight: 700, color: '#22d3ee', padding: '3px 10px', background: 'rgba(34,211,238,0.1)', borderRadius: 8, border: '1px solid rgba(34,211,238,0.2)' }}>{lastMove}</div>}
            {battery !== null && <div style={{ fontSize: 11, color: '#94a3b8', padding: '3px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 12 }}>🔋 {battery}%</div>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 20, fontSize: 11, background: connected ? 'rgba(74,222,128,0.1)' : 'rgba(255,255,255,0.04)', border: `1px solid ${connected ? 'rgba(74,222,128,0.3)' : 'rgba(255,255,255,0.08)'}`, color: connected ? '#4ade80' : '#64748b' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? '#4ade80' : '#475569' }} />
              {connStatus}
            </div>
          </div>
        </div>
      </header>

      {/* ═══════ MOBILE LAYOUT (< 768px) ═══════ */}
      <div className="mobile-layout">
        {/* Cube + Connect */}
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, margin: '0 16px', padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div ref={cubeRef} style={{ width: 200, height: 200, touchAction: 'none' }}>
            <Cube3D rx={rx} ry={ry} facelets={cubeFacelets || undefined} size={180} />
          </div>
          <div style={{ display: 'flex', gap: 8, width: '100%' }}>
            <button onClick={connect} disabled={connecting || connected} style={{ flex: 1, padding: '10px 0', fontSize: 14, fontWeight: 600, borderRadius: 10, border: 'none', cursor: connecting ? 'wait' : 'pointer', background: connected ? 'rgba(74,222,128,0.15)' : '#06b6d4', color: connected ? '#4ade80' : '#fff', opacity: connecting ? 0.5 : 1 }}>
              {connecting ? '连接中...' : connected ? '✅ 已连接' : '🔗 连接魔方'}
            </button>
            <button onClick={() => setShowLog(p => !p)} style={{ padding: '10px 14px', fontSize: 13, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#94a3b8', cursor: 'pointer' }}>📋</button>
          </div>
          {showLog && (
            <div style={{ width: '100%', maxHeight: 200, overflow: 'auto', background: 'rgba(0,0,0,0.3)', borderRadius: 10, padding: 10 }}>
              {logs.map(l => <div key={l.id} style={{ fontSize: 10, padding: '2px 0', display: 'flex', gap: 6, color: l.type === 'error' ? '#f87171' : l.type === 'success' ? '#4ade80' : '#94a3b8' }}><span style={{ fontFamily: 'monospace', color: '#475569', flexShrink: 0 }}>{l.time}</span><span>{l.message}</span></div>)}
            </div>
          )}
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, padding: '12px 16px' }}>
          {[{ l: '正确', v: stats.correct, c: '#4ade80' }, { l: '错误', v: stats.wrong, c: '#f87171' }, { l: '连续', v: stats.streak, c: '#22d3ee' }, { l: '最佳', v: stats.bestStreak, c: '#facc15' }].map(s => (
            <div key={s.l} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.04)', padding: '8px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.c }}>{s.v}</div>
              <div style={{ fontSize: 10, color: '#64748b' }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* Category tabs */}
        <div style={{ display: 'flex', gap: 4, padding: '0 16px 8px' }}>
          {Object.keys(formulaLibrary).map(c => <button key={c} onClick={() => { setCat(c); setFormula(null); setMoves([]); }} style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer', background: cat === c ? '#06b6d4' : 'rgba(255,255,255,0.06)', color: cat === c ? '#fff' : '#94a3b8' }}>{c}</button>)}
        </div>

        {/* Formula list */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '0 16px 12px', WebkitOverflowScrolling: 'touch' }}>
          {formulas.map(f => {
            const dm = diffMeta(f.difficulty);
            return (
              <div key={f.id} onClick={() => selectFormula(f.id)} style={{ flexShrink: 0, padding: '10px 14px', borderRadius: 10, cursor: 'pointer', background: formula?.id === f.id ? 'rgba(6,182,212,0.15)' : 'rgba(255,255,255,0.03)', border: `1px solid ${formula?.id === f.id ? 'rgba(6,182,212,0.3)' : 'rgba(255,255,255,0.06)'}` }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: formula?.id === f.id ? '#22d3ee' : '#e2e8f0' }}>{f.id}</div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{f.name}</div>
                <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: dm.bg, color: dm.color, marginTop: 4, display: 'inline-block' }}>{dm.label}</span>
              </div>
            );
          })}
        </div>

        {/* Formula detail */}
        {formula && (
          <div style={{ padding: '0 16px 16px' }}>
            <FormulaDetail formula={formula} practicing={practicing} moves={moves} wrongs={wrongs} hlStep={hlStep} progress={progress} time={time} onStart={startPractice} onReset={resetPractice} />
          </div>
        )}
      </div>

      {/* ═══════ DESKTOP LAYOUT (≥ 768px) ═══════ */}
      <div className="desktop-layout">
        <main style={{ maxWidth: 1400, margin: '0 auto', padding: '0 24px 24px', display: 'grid', gridTemplateColumns: '260px 1fr 320px', gap: 16 }}>
          {/* Left - Formula Library */}
          <div style={{ background: 'rgba(255,255,255,0.03)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: 16, borderBottom: '1px solid rgba(255,255,255,0.06)' }}><h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>📚 公式库</h2></div>
            <div style={{ display: 'flex', gap: 4, padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              {Object.keys(formulaLibrary).map(c => <button key={c} onClick={() => { setCat(c); setFormula(null); setMoves([]); }} style={{ padding: '6px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer', background: cat === c ? '#06b6d4' : 'rgba(255,255,255,0.06)', color: cat === c ? '#fff' : '#94a3b8' }}>{c}</button>)}
            </div>
            <div style={{ display: 'flex', gap: 4, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              {['all', 'beginner', 'intermediate', 'advanced'].map(d => <button key={d} onClick={() => setDiff(d)} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 500, borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)', background: diff === d ? 'rgba(255,255,255,0.08)' : 'transparent', color: diff === d ? '#e2e8f0' : '#64748b', cursor: 'pointer' }}>{d === 'all' ? '全部' : diffMeta(d).label}</button>)}
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
              {formulas.map(f => {
                const dm = diffMeta(f.difficulty);
                return (
                  <div key={f.id} onClick={() => selectFormula(f.id)} style={{ padding: '10px 12px', borderRadius: 10, cursor: 'pointer', marginBottom: 4, background: formula?.id === f.id ? 'rgba(6,182,212,0.15)' : 'transparent', border: `1px solid ${formula?.id === f.id ? 'rgba(6,182,212,0.3)' : 'transparent'}`, transition: 'all 0.15s' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: formula?.id === f.id ? '#22d3ee' : '#e2e8f0' }}>{f.id}</span>
                      <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: dm.bg, color: dm.color }}>{dm.label}</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{f.name}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Center - 3D Cube + Practice */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: 'rgba(255,255,255,0.03)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, minHeight: 280 }}>
              <div ref={cubeRef} style={{ width: 240, height: 240, touchAction: 'none' }}>
                <Cube3D rx={rx} ry={ry} facelets={cubeFacelets || undefined} size={220} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={connect} disabled={connecting || connected} style={{ padding: '8px 24px', fontSize: 14, fontWeight: 600, borderRadius: 10, border: 'none', cursor: connecting ? 'wait' : 'pointer', background: connected ? 'rgba(74,222,128,0.15)' : '#06b6d4', color: connected ? '#4ade80' : '#fff', opacity: connecting ? 0.5 : 1 }}>
                  {connecting ? '连接中...' : connected ? '✅ 已连接' : '🔗 连接魔方'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: '#475569' }}>拖拽旋转魔方</div>
            </div>
            {formula && <FormulaDetail formula={formula} practicing={practicing} moves={moves} wrongs={wrongs} hlStep={hlStep} progress={progress} time={time} onStart={startPractice} onReset={resetPractice} />}
          </div>

          {/* Right - Stats + Log */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: 'rgba(255,255,255,0.03)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: 16 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px' }}>📊 统计</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[{ l: '正确', v: stats.correct, c: '#4ade80' }, { l: '错误', v: stats.wrong, c: '#f87171' }, { l: '连续', v: stats.streak, c: '#22d3ee' }, { l: '最佳', v: stats.bestStreak, c: '#facc15' }].map(s => (
                  <div key={s.l} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.04)', padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: s.c }}>{s.v}</div>
                    <div style={{ fontSize: 10, color: '#64748b' }}>{s.l}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.03)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}><h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>📋 日志</h2></div>
              <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
                {logs.map(l => <div key={l.id} style={{ fontSize: 11, padding: '3px 0', display: 'flex', gap: 8, color: l.type === 'error' ? '#f87171' : l.type === 'success' ? '#4ade80' : l.type === 'warning' ? '#fbbf24' : '#94a3b8' }}><span style={{ fontFamily: 'monospace', color: '#475569', flexShrink: 0 }}>{l.time}</span><span>{l.message}</span></div>)}
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Responsive CSS */}
      <style>{`
        .mobile-layout { display: none; }
        .desktop-layout { display: block; }
        @media (max-width: 767px) {
          .mobile-layout { display: block; }
          .desktop-layout { display: none; }
        }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
      `}</style>
    </div>
  );
}
