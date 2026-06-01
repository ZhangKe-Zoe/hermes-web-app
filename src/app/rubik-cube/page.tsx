'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import aesjs from 'aes-js';

// ── Types ──
interface Formula { id: string; name: string; formula: string; description: string; difficulty?: 'beginner' | 'intermediate' | 'advanced'; }
interface Stats { correct: number; wrong: number; streak: number; bestStreak: number; }
interface LogEntry { id: number; time: string; message: string; type: 'info' | 'success' | 'error' | 'warning'; }

// ═══════════════════════════════════════════════════════════════════
// QiYi Smart Cube BLE Protocol (from bartekk2908/smart_cube_game_controller)
// Service: 0000fff0-0000-1000-8000-00805f9b34fb
// ALL comms on fff6 (both WRITE and NOTIFY)
// AES-128-ECB key: 57b1f9abcd5ae8a79cb98ce7578c5108
// Frame: [0xFE][LEN][PAYLOAD...][CRC16_MODBUS_LE]
// ═══════════════════════════════════════════════════════════════════

const QIYI_SERVICE = '0000fff0-0000-1000-8000-00805f9b34fb';
const QIYI_CHAR = '0000fff6-0000-1000-8000-00805f9b34fb'; // fff6 for BOTH read/write

// AES-128-ECB key
const AES_KEY_BYTES = [0x57, 0xb1, 0xf9, 0xab, 0xcd, 0x5a, 0xe8, 0xa7, 0x9c, 0xb9, 0x8c, 0xe7, 0x57, 0x8c, 0x51, 0x08];

// CRC-16 MODBUS (init=0xFFFF, poly=0xA001)
function crc16(data: Uint8Array): number {
  let crc = 0xFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? ((crc >> 1) ^ 0xA001) : (crc >> 1);
    }
  }
  return crc;
}

// AES-128-ECB encrypt (MUST create new instance each time - aes-js is stateful!)
function aesEncrypt(data: Uint8Array): Uint8Array {
  // Pad to 16-byte blocks with zeros
  const padLen = (16 - (data.length % 16)) % 16;
  const padded = new Uint8Array(data.length + padLen);
  padded.set(data);
  // Create FRESH cipher each time
  const cipher = new aesjs.ModeOfOperation.ecb(AES_KEY_BYTES);
  return cipher.encrypt(padded);
}

// AES-128-ECB decrypt (MUST create new instance each time!)
function aesDecrypt(data: Uint8Array): Uint8Array {
  const cipher = new aesjs.ModeOfOperation.ecb(AES_KEY_BYTES);
  return cipher.decrypt(data);
}

// Build message: [0xFE][LEN][PAYLOAD...][CRC16_LE] → pad to 16 → encrypt
function buildMessage(payload: number[]): Uint8Array {
  const len = payload.length + 4; // FE + LEN + payload + 2 CRC bytes
  const msg = new Uint8Array(len);
  msg[0] = 0xFE;
  msg[1] = len; // total length including FE, LEN, payload, CRC
  for (let i = 0; i < payload.length; i++) msg[i + 2] = payload[i];
  // CRC over bytes 0..len-3 (everything except CRC itself)
  const crc = crc16(msg.slice(0, len - 2));
  msg[len - 2] = crc & 0xFF;
  msg[len - 1] = (crc >> 8) & 0xFF;
  // Encrypt
  return aesEncrypt(msg);
}

// Parse received message: decrypt → verify 0xFE → extract opcode
function parseMessage(raw: Uint8Array): { opcode: number; msg: Uint8Array } | null {
  try {
    const decrypted = aesDecrypt(raw);
    // Find 0xFE magic byte
    let start = 0;
    while (start < decrypted.length && decrypted[start] !== 0xFE) start++;
    if (start >= decrypted.length) return null;

    const msgLen = decrypted[start + 1];
    if (msgLen < 4 || start + msgLen > decrypted.length) return null;

    const msg = decrypted.slice(start, start + msgLen);
    // Verify CRC (last 2 bytes, little-endian)
    const expectedCrc = msg[msgLen - 2] | (msg[msgLen - 1] << 8);
    const actualCrc = crc16(msg.slice(0, msgLen - 2));
    if (expectedCrc !== actualCrc) {
      // CRC mismatch - log but still try to parse
      console.warn('CRC mismatch', expectedCrc, actualCrc);
    }

    const opcode = msg[2];
    return { opcode, msg };
  } catch (e) {
    console.error('parseMessage error', e);
    return null;
  }
}

// Build ACK: [0xFE][0x09][bytes 2-6 of received msg][CRC16_LE]
function buildAck(receivedMsg: Uint8Array): Uint8Array {
  // ACK copies bytes 2-6 from the received message (opcode + timestamp)
  const ack = new Uint8Array(9);
  ack[0] = 0xFE;
  ack[1] = 0x09; // length = 9
  // Copy bytes 2-6 from received message
  for (let i = 0; i < 5; i++) {
    ack[2 + i] = receivedMsg[2 + i];
  }
  const crc = crc16(ack.slice(0, 7));
  ack[7] = crc & 0xFF;
  ack[8] = (crc >> 8) & 0xFF;
  return aesEncrypt(ack);
}

// Build App Hello: [0xFE][0x15][00×11][MAC_REVERSED:6][CRC16_LE]
function buildAppHello(macBytes: number[]): Uint8Array {
  // MAC reversed (LSB first)
  const reversedMac = [macBytes[5], macBytes[4], macBytes[3], macBytes[2], macBytes[1], macBytes[0]];

  // Build payload: FE + 15 + 11 zeros + 6 MAC bytes + 2 CRC = 21 bytes
  const payload = new Uint8Array(21);
  payload[0] = 0xFE;
  payload[1] = 0x15; // total length = 21
  // Bytes 2-12: 11 zeros (unknown field)
  for (let i = 2; i < 13; i++) payload[i] = 0x00;
  // Bytes 13-18: reversed MAC
  for (let i = 0; i < 6; i++) payload[13 + i] = reversedMac[i];
  // CRC over bytes 0-18
  const crc = crc16(payload.slice(0, 19));
  payload[19] = crc & 0xFF;
  payload[20] = (crc >> 8) & 0xFF;
  // Encrypt (pad to 32 bytes → 2 blocks)
  return aesEncrypt(payload);
}

// Move lookup table (opcode 0x03, move byte at index 34 of decrypted message)
const MOVE_TABLE: Record<number, string> = {
  0x01: "L'", 0x02: 'L', 0x03: "R'", 0x04: 'R',
  0x05: "D'", 0x06: 'D', 0x07: "U'", 0x08: 'U',
  0x09: "F'", 0x0A: 'F', 0x0B: "B'", 0x0C: 'B',
};

// Cube state: 27 bytes → 54 facelets
// Lower nibble = first facelet, upper nibble = second facelet
// Colors: 0=orange, 1=red, 2=yellow, 3=white, 4=green, 5=blue
// Face order: White(0-8), Red(9-17), Green(18-26), Yellow(27-35), Orange(36-44), Blue(45-53)
const COLOR_MAP: Record<number, string> = {
  0: '#ff5800', // orange
  1: '#c41e3a', // red
  2: '#ffd500', // yellow
  3: '#ffffff', // white
  4: '#009e60', // green
  5: '#0051ba', // blue
};

function parseCubeState(stateBytes: number[]): string[] {
  const facelets: string[] = [];
  for (const b of stateBytes) {
    facelets.push(COLOR_MAP[b & 0x0F] || '#333');
    facelets.push(COLOR_MAP[(b >> 4) & 0x0F] || '#333');
  }
  return facelets;
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

// ── Styles ──
const S = {
  page: { minHeight: '100vh', background: 'linear-gradient(135deg, #030712, #0f172a, #030712)', color: '#e2e8f0', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif' } as React.CSSProperties,
  glass: { background: 'rgba(255,255,255,0.03)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '16px' } as React.CSSProperties,
  card: { background: 'rgba(0,0,0,0.2)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)' } as React.CSSProperties,
  btn: (a?: boolean) => ({ padding: '6px 14px', fontSize: '13px', fontWeight: 600 as const, borderRadius: '8px', border: 'none', cursor: 'pointer' as const, background: a ? '#06b6d4' : 'rgba(255,255,255,0.06)', color: a ? '#fff' : '#94a3b8' } as React.CSSProperties),
  btnSm: { padding: '4px 10px', fontSize: '11px', fontWeight: 500, borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#94a3b8', cursor: 'pointer' } as React.CSSProperties,
  mono: { fontFamily: '"SF Mono", Menlo, Consolas, monospace' } as React.CSSProperties,
};
function diffMeta(d?: string) {
  switch (d) { case 'beginner': return { label: '初级', color: '#4ade80', bg: 'rgba(74,222,128,0.15)' }; case 'intermediate': return { label: '中级', color: '#facc15', bg: 'rgba(250,204,21,0.15)' }; case 'advanced': return { label: '高级', color: '#f87171', bg: 'rgba(248,113,113,0.15)' }; default: return { label: '全部', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' }; }
}

// ── 3D Cube (from real cube state) ──
function Cube3D({ rx, ry, facelets }: { rx: number; ry: number; facelets?: string[] }) {
  // Default colors if no real state
  const defaultFacelets = useMemo(() => {
    const f: string[] = [];
    for (let i = 0; i < 9; i++) f.push('#ffffff');  // U white
    for (let i = 0; i < 9; i++) f.push('#c41e3a');  // R red
    for (let i = 0; i < 9; i++) f.push('#009e60');  // F green
    for (let i = 0; i < 9; i++) f.push('#ffd500');  // D yellow
    for (let i = 0; i < 9; i++) f.push('#ff5800');  // L orange
    for (let i = 0; i < 9; i++) f.push('#0051ba');  // B blue
    return f;
  }, []);

  const f = facelets || defaultFacelets;
  // Map facelets to 3D cubie faces
  // U(0-8), R(9-17), F(18-26), D(27-35), L(36-44), B(45-53)
  const cubies = useMemo(() => {
    const r: { x: number; y: number; z: number; faces: Record<string, string> }[] = [];
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          const faces: Record<string, string> = {};
          // Map 3D position to facelet index
          if (y === 1) faces.top = f[(1 - z) * 3 + (x + 1)]; // U face
          if (y === -1) faces.bottom = f[27 + (1 + z) * 3 + (x + 1)]; // D face
          if (z === 1) faces.front = f[18 + (1 - y) * 3 + (x + 1)]; // F face
          if (z === -1) faces.back = f[45 + (1 - y) * 3 + (1 - x)]; // B face (mirrored)
          if (x === 1) faces.right = f[9 + (1 - y) * 3 + (1 - z)]; // R face
          if (x === -1) faces.left = f[36 + (1 - y) * 3 + (z + 1)]; // L face
          r.push({ x, y, z, faces });
        }
      }
    }
    return r;
  }, [f]);

  return (
    <div style={{ perspective: '600px', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 120, height: 120, position: 'relative', transformStyle: 'preserve-3d', transform: `rotateX(${rx}deg) rotateY(${ry}deg)`, transition: 'transform 0.1s' }}>
        {cubies.map(({ x, y, z, faces }, i) => (
          <div key={i} style={{ position: 'absolute', width: 36, height: 36, transformStyle: 'preserve-3d', transform: `translate3d(${x*38+42}px,${-y*38+42}px,${z*38}px)` }}>
            {([['top','rotateX(90deg) translateZ(18px)'],['bottom','rotateX(-90deg) translateZ(18px)'],['front','translateZ(18px)'],['back','rotateY(180deg) translateZ(18px)'],['right','rotateY(90deg) translateZ(18px)'],['left','rotateY(-90deg) translateZ(18px)']] as [string,string][]).map(([k,t]) => <div key={k} style={{ position:'absolute', width:36, height:36, transform:t, background:faces[k]||'#1a1a2e', border:'1.5px solid #0a0a1a', borderRadius:3, boxSizing:'border-box' }} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main ──
export default function RubikCubeTrainer() {
  const [cat, setCat] = useState('OLL');
  const [formula, setFormula] = useState<Formula|null>(null);
  const [practicing, setPracticing] = useState(false);
  const [moves, setMoves] = useState<string[]>([]);
  const [wrongs, setWrongs] = useState<Set<number>>(new Set());
  const [stats, setStats] = useState<Stats>({ correct:0, wrong:0, streak:0, bestStreak:0 });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [time, setTime] = useState(0);
  const [connected, setConnected] = useState(false);
  const [connStatus, setConnStatus] = useState('未连接');
  const [connecting, setConnecting] = useState(false);
  const [rx, setRx] = useState(-25); const [ry, setRy] = useState(35);
  const [diff, setDiff] = useState('all');
  const [hlStep, setHlStep] = useState(-1);
  const [lastMove, setLastMove] = useState<string|null>(null);
  const [battery, setBattery] = useState<number|null>(null);
  const [showSafari, setShowSafari] = useState(false);
  const [cubeFacelets, setCubeFacelets] = useState<string[]|null>(null);

  const startRef = useRef<number|null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const logId = useRef(0);
  const dragging = useRef(false);
  const lastM = useRef({ x:0, y:0 });
  const connLock = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const charRef = useRef<any>(null); // fff6 characteristic

  const addLog = useCallback((msg: string, type: LogEntry['type']='info') => {
    logId.current++;
    setLogs(p => [{ id: logId.current, time: new Date().toLocaleTimeString(), message: msg, type }, ...p].slice(0, 80));
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
          setStats(p => { const ns = p.streak+1; return { correct: p.correct+1, wrong: p.wrong, streak: ns, bestStreak: Math.max(p.bestStreak, ns) }; });
          addLog(`✅ ${idx+1}: ${move}`, 'success'); setHlStep(idx+1);
        } else {
          setStats(p => ({ ...p, wrong: p.wrong+1, streak: 0 }));
          setWrongs(p => new Set(p).add(idx));
          addLog(`❌ 期望${expected[idx]}，实际${move}`, 'error');
        }
        setMoves(p => [...p, move]);
        if (idx+1 === expected.length && act === exp) {
          const t = ((Date.now()-(startRef.current||Date.now()))/1000).toFixed(1);
          addLog(`🎉 完成！${t}s`, 'success'); setPracticing(false);
          if (timerRef.current) clearInterval(timerRef.current);
        }
      }
    }
  }, [formula, practicing, moves, addLog]);

  // ── BLE Connect (from bartekk2908/smart_cube_game_controller) ──
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

      // ═══ Use fff6 for BOTH read/write (per reference project) ═══
      const mainChar = await service.getCharacteristic(QIYI_CHAR);
      charRef.current = mainChar;
      addLog('✅ fff6 (READ+WRITE+NOTIFY)', 'success');

      // MAC address of this cube: CC:A3:00:00:CC:3E
      const MAC_BYTES = [0xCC, 0xA3, 0x00, 0x00, 0xCC, 0x3E];

      // ═══ Subscribe to notifications FIRST ═══
      mainChar.addEventListener('characteristicvaluechanged', ((event: Event) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const val = (event.target as any).value as DataView;
        if (!val) return;
        const raw = new Uint8Array(val.buffer);
        const hex = Array.from(raw).map(b => b.toString(16).padStart(2, '0')).join(' ');
        addLog(`📦 ${hex.slice(0, 40)}${hex.length > 40 ? '...' : ''}`, 'info');

        // Parse the encrypted message
        const parsed = parseMessage(raw);
        if (!parsed) { addLog('⚠️ 解析失败', 'warning'); return; }

        const { opcode, msg } = parsed;

        if (opcode === 0x02) {
          // ═══ Cube Hello ═══
          // msg[0]=FE, msg[1]=len, msg[2]=02, msg[3-6]=timestamp, msg[7-33]=state, msg[34]=?, msg[35]=battery
          const batteryLevel = msg[35];
          setBattery(batteryLevel);
          addLog(`🧊 Cube Hello! 电量:${batteryLevel}%`, 'success');

          // Parse cube state (27 bytes starting at offset 7)
          const stateBytes = Array.from(msg.slice(7, 34));
          const facelets = parseCubeState(stateBytes);
          setCubeFacelets(facelets);

          // MUST send ACK (opcode + timestamp = bytes 2-6)
          const ack = buildAck(msg);
          charRef.current.writeValueWithoutResponse(ack).then(() => {
            addLog('📤 ACK sent', 'info');
          }).catch((e: unknown) => addLog(`ACK失败: ${e}`, 'warning'));

        } else if (opcode === 0x03) {
          // ═══ State Change (move detected) ═══
          // msg[0]=FE, msg[1]=0x5E(94), msg[2]=03, msg[3-6]=timestamp
          // msg[7-33]=state(27 bytes), msg[34]=move byte, msg[35]=battery
          const moveByte = msg[34];
          const move = MOVE_TABLE[moveByte];
          if (move) {
            handleMove(move);
          } else {
            addLog(`未知移动: 0x${moveByte.toString(16)}`, 'warning');
          }

          const batteryLevel = msg[35];
          if (batteryLevel !== undefined) setBattery(batteryLevel);

          // Update cube state visualization
          const stateBytes = Array.from(msg.slice(7, 34));
          const facelets = parseCubeState(stateBytes);
          setCubeFacelets(facelets);

          // Send ACK if needed (byte 91 = 1)
          if (msg.length >= 92 && msg[91] === 1) {
            const ack = buildAck(msg);
            charRef.current.writeValueWithoutResponse(ack).catch(() => {});
          }

        } else if (opcode === 0x04) {
          addLog('🧊 状态已同步', 'success');
        } else if (opcode === 0x05) {
          addLog(`🧊 当前状态 (${msg.length}B)`, 'success');
        } else {
          addLog(`opcode=0x${opcode.toString(16)} len=${msg.length}`, 'info');
        }
      }) as EventListener);

      await mainChar.startNotifications();
      addLog('🔔 已订阅 fff6 通知', 'success');

      // Small delay to ensure subscription is active
      await new Promise(r => setTimeout(r, 100));

      // ═══ Send App Hello (FIRST message - cube won't respond without it) ═══
      // Format: [FE][15][00×11][MAC_REVERSED:6][CRC16_LE] = 21 bytes → pad to 32 → encrypt
      const helloMsg = buildAppHello(MAC_BYTES);
      const helloHex = Array.from(helloMsg).map(b => b.toString(16).padStart(2, '0')).join(' ');
      addLog(`📤 App Hello: ${helloHex.slice(0, 40)}...`, 'info');

      // Use writeValueWithoutResponse (this cube doesn't support writeValue)
      await mainChar.writeValueWithoutResponse(helloMsg);
      addLog('📤 App Hello 已发送', 'success');

      // Wait for Cube Hello response (should come within 1-2 seconds)
      addLog('⏳ 等待 Cube Hello...', 'info');

      setConnected(true);
      setConnStatus(`已连接: ${device.name}`);
      addLog('✅ 连接完成，转动魔方试试！', 'success');

      // Handle disconnect
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
    if (f) { setFormula(f); setMoves([]); setWrongs(new Set()); setHlStep(-1); addLog(`选择: ${f.id}`, 'info'); }
  }, [formulas, addLog]);

  const startPractice = useCallback(() => {
    if (!formula) { addLog('请先选择公式', 'error'); return; }
    setPracticing(true); setMoves([]); setWrongs(new Set()); setHlStep(0);
    setStats({ correct:0, wrong:0, streak:0, bestStreak:0 }); setTime(0);
    startRef.current = Date.now(); addLog(`开始: ${formula.id}`, 'success');
    timerRef.current = setInterval(() => { if (startRef.current) setTime(parseFloat(((Date.now()-startRef.current)/1000).toFixed(1))); }, 100);
  }, [formula, addLog]);

  const resetPractice = useCallback(() => {
    setPracticing(false); setMoves([]); setWrongs(new Set()); setHlStep(-1);
    setStats({ correct:0, wrong:0, streak:0, bestStreak:0 }); setTime(0);
    startRef.current = null; if (timerRef.current) clearInterval(timerRef.current); addLog('已重置', 'info');
  }, [addLog]);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);
  useEffect(() => { if (typeof window !== 'undefined' && /^((?!chrome|android).)*safari/i.test(navigator.userAgent) && !('bluetooth' in navigator)) setShowSafari(true); }, []);

  const progress = formula ? (moves.length / formula.formula.split(' ').length) * 100 : 0;

  return (
    <div style={S.page}>
      {showSafari && <div style={{ background:'rgba(245,158,11,0.1)', borderBottom:'1px solid rgba(245,158,11,0.2)', padding:'10px 16px', textAlign:'center', fontSize:13, color:'#fbbf24' }}>⚠️ Safari不支持蓝牙，请用Chrome/Edge</div>}

      <header style={{ padding:'20px 24px 12px' }}>
        <div style={{ maxWidth:1400, margin:'0 auto', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <h1 style={{ fontSize:26, fontWeight:700, margin:0, background:'linear-gradient(135deg,#22d3ee,#3b82f6,#a855f7)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>🎲 魔方速拧公式训练</h1>
            <p style={{ fontSize:12, color:'#64748b', margin:'4px 0 0' }}>CFOP · 奇艺智能魔方 BLE</p>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            {lastMove && <div style={{ ...S.mono, fontSize:20, fontWeight:700, color:'#22d3ee', padding:'4px 12px', background:'rgba(34,211,238,0.1)', borderRadius:8, border:'1px solid rgba(34,211,238,0.2)' }}>{lastMove}</div>}
            {battery !== null && <div style={{ fontSize:12, color:'#94a3b8', padding:'4px 10px', background:'rgba(255,255,255,0.04)', borderRadius:12 }}>🔋 {battery}%</div>}
            <div style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:20, fontSize:12, background:connected?'rgba(74,222,128,0.1)':'rgba(255,255,255,0.04)', border:`1px solid ${connected?'rgba(74,222,128,0.3)':'rgba(255,255,255,0.08)'}`, color:connected?'#4ade80':'#64748b' }}>
              <span style={{ width:8, height:8, borderRadius:'50%', background:connected?'#4ade80':'#475569', animation:connected?'pulse 2s infinite':'none' }} />
              {connStatus}
            </div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth:1400, margin:'0 auto', padding:'0 24px 24px', display:'grid', gridTemplateColumns:'280px 1fr 360px', gap:16 }}>
        {/* Left - Formula Library */}
        <div style={{ ...S.glass, overflow:'hidden', display:'flex', flexDirection:'column' }}>
          <div style={{ padding:16, borderBottom:'1px solid rgba(255,255,255,0.06)' }}><h2 style={{ fontSize:15, fontWeight:600, margin:0 }}>📚 公式库</h2></div>
          <div style={{ display:'flex', gap:4, padding:'10px 12px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
            {Object.keys(formulaLibrary).map(c => <button key={c} onClick={() => { setCat(c); setFormula(null); setMoves([]); }} style={S.btn(cat===c)}>{c}</button>)}
          </div>
          <div style={{ display:'flex', gap:4, padding:'8px 12px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
            {['all','beginner','intermediate','advanced'].map(d => <button key={d} onClick={() => setDiff(d)} style={{ ...S.btnSm, color:diff===d?'#e2e8f0':'#64748b', background:diff===d?'rgba(255,255,255,0.08)':'transparent' }}>{d==='all'?'全部':diffMeta(d).label}</button>)}
          </div>
          <div style={{ flex:1, overflow:'auto', padding:'8px 12px' }}>
            {formulas.map(f => {
              const dm = diffMeta(f.difficulty);
              return (
                <div key={f.id} onClick={() => selectFormula(f.id)} style={{ padding:'10px 12px', borderRadius:10, cursor:'pointer', marginBottom:4, background:formula?.id===f.id?'rgba(6,182,212,0.15)':'transparent', border:`1px solid ${formula?.id===f.id?'rgba(6,182,212,0.3)':'transparent'}`, transition:'all 0.15s' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:13, fontWeight:600, color:formula?.id===f.id?'#22d3ee':'#e2e8f0' }}>{f.id}</span>
                    <span style={{ fontSize:10, padding:'2px 6px', borderRadius:4, background:dm.bg, color:dm.color }}>{dm.label}</span>
                  </div>
                  <div style={{ fontSize:11, color:'#94a3b8', marginTop:4 }}>{f.name}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Center - 3D Cube + Practice */}
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          <div style={{ ...S.glass, padding:16, display:'flex', flexDirection:'column', alignItems:'center', gap:12, minHeight:240 }}>
            <div style={{ width:200, height:200 }}>
              <Cube3D rx={rx} ry={ry} facelets={cubeFacelets || undefined} />
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={connect} disabled={connecting || connected} style={{ ...S.btn(!connected), opacity:connecting?0.5:1, padding:'8px 20px' }}>
                {connecting ? '连接中...' : connected ? '已连接' : '🔗 连接魔方'}
              </button>
              {connected && <div style={{ fontSize:11, color:'#4ade80', alignSelf:'center' }}>BLE Ready</div>}
            </div>
          </div>

          {formula && (
            <div style={{ ...S.glass, padding:20 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                <div>
                  <h3 style={{ fontSize:18, fontWeight:700, margin:0, color:'#e2e8f0' }}>{formula.id}: {formula.name}</h3>
                  <p style={{ fontSize:12, color:'#64748b', margin:'4px 0 0' }}>{formula.description}</p>
                </div>
                <div style={{ display:'flex', gap:6 }}>
                  {!practicing ? <button onClick={startPractice} style={S.btn(true)}>▶ 开始练习</button> : <button onClick={resetPractice} style={S.btn(false)}>⏹ 重置</button>}
                </div>
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:12 }}>
                {formula.formula.split(' ').map((m, i) => (
                  <span key={i} style={{ ...S.mono, fontSize:16, fontWeight:600, padding:'6px 12px', borderRadius:8, background:i===hlStep?'rgba(74,222,128,0.2)':wrongs.has(i)?'rgba(248,113,113,0.2)':i<moves.length?'rgba(255,255,255,0.06)':'rgba(255,255,255,0.03)', color:i===hlStep?'#4ade80':wrongs.has(i)?'#f87171':i<moves.length?'#94a3b8':'#64748b', border:`1px solid ${i===hlStep?'rgba(74,222,128,0.3)':wrongs.has(i)?'rgba(248,113,113,0.3)':'rgba(255,255,255,0.06)'}`, transition:'all 0.15s' }}>{m}</span>
                ))}
              </div>
              {practicing && <div style={{ height:3, background:'rgba(255,255,255,0.06)', borderRadius:2, overflow:'hidden' }}><div style={{ height:'100%', width:`${progress}%`, background:'linear-gradient(90deg,#22d3ee,#3b82f6)', borderRadius:2, transition:'width 0.3s' }} /></div>}
              {practicing && <div style={{ fontSize:12, color:'#64748b', textAlign:'center', marginTop:8 }}>{time.toFixed(1)}s · 步骤 {moves.length}/{formula.formula.split(' ').length}</div>}
            </div>
          )}
        </div>

        {/* Right - Stats + Log */}
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          <div style={{ ...S.glass, padding:16 }}>
            <h2 style={{ fontSize:15, fontWeight:600, margin:'0 0 12px' }}>📊 统计</h2>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
              {[{ l:'正确', v:stats.correct, c:'#4ade80' },{ l:'错误', v:stats.wrong, c:'#f87171' },{ l:'连续', v:stats.streak, c:'#22d3ee' },{ l:'最佳', v:stats.bestStreak, c:'#facc15' }].map(s => <div key={s.l} style={{ ...S.card, padding:'10px 12px', textAlign:'center' }}><div style={{ fontSize:22, fontWeight:700, color:s.c }}>{s.v}</div><div style={{ fontSize:10, color:'#64748b' }}>{s.l}</div></div>)}
            </div>
          </div>
          <div style={{ ...S.glass, flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
            <div style={{ padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}><h2 style={{ fontSize:15, fontWeight:600, margin:0 }}>📋 日志</h2></div>
            <div style={{ flex:1, overflow:'auto', padding:'8px 12px' }}>
              {logs.map(l => <div key={l.id} style={{ fontSize:11, padding:'4px 0', display:'flex', gap:8, color:l.type==='error'?'#f87171':l.type==='success'?'#4ade80':l.type==='warning'?'#fbbf24':'#94a3b8' }}><span style={{ ...S.mono, color:'#475569', flexShrink:0 }}>{l.time}</span><span>{l.message}</span></div>)}
            </div>
          </div>
        </div>
      </main>

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  );
}
