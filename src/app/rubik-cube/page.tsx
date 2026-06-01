'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// ── Types ──
interface Formula { id: string; name: string; formula: string; description: string; difficulty?: 'beginner' | 'intermediate' | 'advanced'; }
interface Stats { correct: number; wrong: number; streak: number; bestStreak: number; }
interface LogEntry { id: number; time: string; message: string; type: 'info' | 'success' | 'error' | 'warning'; }

// ── Qiyi Smart Cube Protocol (from CSDN blog) ──
// Service: 0000fff0-0000-1000-8000-00805f9b34fb
// Read/Notify: fff1, Write: fff2
// AES-128-ECB key: "0102030405060708" (ASCII hex: 30313032303330343035303630373038)
// Frame: [0xAA][LEN_H][LEN_L][CMD][DATA...][XOR][0x55]

const QIYI_SERVICE = '0000fff0-0000-1000-8000-00805f9b34fb';
// Auto-discover: will probe all characteristics on the service
// Typical layout for QY-QYSC-S-CC3E: fff4(WRITE), fff5(WRITE), fff6(NOTIFY), fff7(READ)
const QIYI_CHAR_FALLBACK_NOTIFY = '0000fff6-0000-1000-8000-00805f9b34fb';
const QIYI_CHAR_FALLBACK_WRITE = '0000fff4-0000-1000-8000-00805f9b34fb';

// CRC-16 MODBUS
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

// AES key: 57b1f9abcd5ae8a79cb98ce7578c5108 (from Codeberg protocol docs)
const AES_KEY = [0x57, 0xb1, 0xf9, 0xab, 0xcd, 0x5a, 0xe8, 0xa7, 0x9c, 0xb9, 0x8c, 0xe7, 0x57, 0x8c, 0x51, 0x08];

// ── AES-128-ECB (pure JS) ──
const SBOX = [
  0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
  0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
  0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
  0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
  0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
  0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
  0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
  0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
  0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
  0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
  0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
  0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
  0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
  0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
  0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
  0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16,
];
const INV_SBOX = new Uint8Array(256);
for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;

const RCON = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];

function gfMul(a: number, b: number): number {
  let p = 0;
  for (let i = 0; i < 8; i++) { if (b & 1) p ^= a; const hi = a & 0x80; a = (a << 1) & 0xFF; if (hi) a ^= 0x1b; b >>= 1; }
  return p;
}

function keyExpansion(key: number[]): number[] {
  const w = new Array(176);
  for (let i = 0; i < 16; i++) w[i] = key[i];
  for (let i = 16; i < 176; i += 4) {
    let temp = [w[i-4], w[i-3], w[i-2], w[i-1]];
    if (i % 16 === 0) temp = [SBOX[temp[1]] ^ RCON[i/16-1], SBOX[temp[2]], SBOX[temp[3]], SBOX[temp[0]]];
    for (let j = 0; j < 4; j++) w[i+j] = w[i-16+j] ^ temp[j];
  }
  return w;
}

function aesEncryptBlock(block: number[], ek: number[]): number[] {
  const s = [...block];
  for (let i = 0; i < 16; i++) s[i] ^= ek[i];
  for (let round = 1; round < 10; round++) {
    for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
    let t = s[1]; s[1]=s[5]; s[5]=s[9]; s[9]=s[13]; s[13]=t;
    t=s[2]; s[2]=s[10]; s[10]=t; t=s[6]; s[6]=s[14]; s[14]=t;
    t=s[3]; s[3]=s[15]; s[15]=s[11]; s[11]=s[7]; s[7]=t;
    for (let c = 0; c < 4; c++) {
      const i = c*4; const a=[s[i],s[i+1],s[i+2],s[i+3]];
      s[i]=gfMul(a[0],2)^gfMul(a[1],3)^a[2]^a[3]; s[i+1]=a[0]^gfMul(a[1],2)^gfMul(a[2],3)^a[3];
      s[i+2]=a[0]^a[1]^gfMul(a[2],2)^gfMul(a[3],3); s[i+3]=gfMul(a[0],3)^a[1]^a[2]^gfMul(a[3],2);
    }
    for (let i = 0; i < 16; i++) s[i] ^= ek[round*16+i];
  }
  for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
  let t = s[1]; s[1]=s[5]; s[5]=s[9]; s[9]=s[13]; s[13]=t;
  t=s[2]; s[2]=s[10]; s[10]=t; t=s[6]; s[6]=s[14]; s[14]=t;
  t=s[3]; s[3]=s[15]; s[15]=s[11]; s[11]=s[7]; s[7]=t;
  for (let i = 0; i < 16; i++) s[i] ^= ek[10*16+i];
  return s;
}

function aesDecryptBlock(block: number[], ek: number[]): number[] {
  const s = [...block];
  for (let i = 0; i < 16; i++) s[i] ^= ek[10*16+i];
  for (let round = 9; round >= 1; round--) {
    let t = s[13]; s[13]=s[9]; s[9]=s[5]; s[5]=s[1]; s[1]=t;
    t=s[2]; s[2]=s[10]; s[10]=t; t=s[6]; s[6]=s[14]; s[14]=t;
    t=s[3]; s[3]=s[7]; s[7]=s[11]; s[11]=s[15]; s[15]=t;
    for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]];
    for (let i = 0; i < 16; i++) s[i] ^= ek[round*16+i];
    for (let c = 0; c < 4; c++) {
      const i = c*4; const a=[s[i],s[i+1],s[i+2],s[i+3]];
      s[i]=gfMul(a[0],14)^gfMul(a[1],11)^gfMul(a[2],13)^gfMul(a[3],9);
      s[i+1]=gfMul(a[0],9)^gfMul(a[1],14)^gfMul(a[2],11)^gfMul(a[3],13);
      s[i+2]=gfMul(a[0],13)^gfMul(a[1],9)^gfMul(a[2],14)^gfMul(a[3],11);
      s[i+3]=gfMul(a[0],11)^gfMul(a[1],13)^gfMul(a[2],9)^gfMul(a[3],14);
    }
  }
  let t = s[13]; s[13]=s[9]; s[9]=s[5]; s[5]=s[1]; s[1]=t;
  t=s[2]; s[2]=s[10]; s[10]=t; t=s[6]; s[6]=s[14]; s[14]=t;
  t=s[3]; s[3]=s[7]; s[7]=s[11]; s[11]=s[15]; s[15]=t;
  for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]];
  for (let i = 0; i < 16; i++) s[i] ^= ek[i];
  return s;
}

function aesEcbEncrypt(data: Uint8Array): Uint8Array {
  const ek = keyExpansion(AES_KEY);
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 16) {
    const block = Array.from(data.slice(i, i + 16));
    result.set(aesEncryptBlock(block, ek), i);
  }
  return result;
}

function aesEcbDecrypt(data: Uint8Array): Uint8Array {
  const ek = keyExpansion(AES_KEY);
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 16) {
    const block = Array.from(data.slice(i, i + 16));
    result.set(aesDecryptBlock(block, ek), i);
  }
  return result;
}

// Build frame: [0xAA][LEN_H][LEN_L][CMD][DATA...][XOR][0x55]
function buildFrame(cmd: number, data: number[]): Uint8Array {
  const payloadLen = 1 + data.length + 1; // cmd + data + xor
  const frame = new Uint8Array(4 + payloadLen); // AA + LEN_H + LEN_L + payload + 55
  frame[0] = 0xAA;
  frame[1] = (payloadLen >> 8) & 0xFF;
  frame[2] = payloadLen & 0xFF;
  frame[3] = cmd;
  for (let i = 0; i < data.length; i++) frame[4 + i] = data[i];
  // XOR checksum: XOR of cmd through last data byte
  let xor = cmd;
  for (let i = 0; i < data.length; i++) xor ^= data[i];
  frame[4 + data.length] = xor;
  frame[5 + data.length] = 0x55;
  return frame;
}

// Build encrypted frame: encrypt the payload part, then wrap in frame
function buildEncryptedFrame(cmd: number, data: number[]): Uint8Array {
  // Build plaintext payload (cmd + data), pad to 16 bytes, encrypt
  const plain = new Uint8Array(1 + data.length);
  plain[0] = cmd;
  for (let i = 0; i < data.length; i++) plain[i + 1] = data[i];
  // Pad to multiple of 16
  const padLen = (16 - (plain.length % 16)) % 16;
  const padded = new Uint8Array(plain.length + padLen);
  padded.set(plain);
  const encrypted = aesEcbEncrypt(padded);
  // Build frame with encrypted data
  const frameLen = encrypted.length + 1 + 1; // encrypted + xor + 55
  const frame = new Uint8Array(4 + frameLen);
  frame[0] = 0xAA;
  frame[1] = (frameLen >> 8) & 0xFF;
  frame[2] = frameLen & 0xFF;
  frame[3] = 0x00; // cmd is inside encrypted payload
  frame.set(encrypted, 4);
  // XOR of encrypted data
  let xor = 0;
  for (let i = 0; i < encrypted.length; i++) xor ^= encrypted[i];
  frame[4 + encrypted.length] = xor;
  frame[5 + encrypted.length] = 0x55;
  return frame;
}

// Parse received frame
function parseFrame(data: Uint8Array): { cmd: number; payload: Uint8Array } | null {
  if (data.length < 6 || data[0] !== 0xAA || data[data.length - 1] !== 0x55) return null;
  const cmd = data[3];
  // Extract encrypted payload (between cmd and xor+55)
  const encPayload = data.slice(4, data.length - 2);
  if (encPayload.length === 0) return { cmd, payload: new Uint8Array(0) };
  // Decrypt
  const decrypted = aesEcbDecrypt(encPayload);
  return { cmd, payload: decrypted };
}

// Parse received encrypted message: decrypt → find 0xFE → extract opcode + data
function parseMessage(encrypted: Uint8Array): { opcode: number; data: Uint8Array } | null {
  try {
    const decrypted = aesEcbDecrypt(encrypted);
    // Find 0xFE start byte
    let start = 0;
    while (start < decrypted.length && decrypted[start] !== 0xFE) start++;
    if (start >= decrypted.length) return null;

    const msgLen = decrypted[start + 1];
    if (msgLen < 4 || start + msgLen > decrypted.length) return null;

    const msg = decrypted.slice(start, start + msgLen);
    // Verify CRC-16 MODBUS (little-endian, last 2 bytes)
    const expectedCrc = msg[msgLen - 2] | (msg[msgLen - 1] << 8);
    const actualCrc = crc16(msg.slice(0, msgLen - 2));
    // CRC check (log mismatch but still parse)
    if (expectedCrc !== actualCrc) {
      // CRC mismatch - try anyway
    }

    const opcode = msg[2]; // Byte 2 is opcode
    const data = msg.slice(2, msgLen - 2); // opcode + timestamp + payload (minus CRC)
    return { opcode, data };
  } catch {
    return null;
  }
}

// Build encrypted message: [0xFE][Length][Payload...][CRC16_LE] → pad → encrypt
function buildMessage(payload: number[]): Uint8Array {
  const len = payload.length + 4; // FE + len + payload + 2 CRC bytes
  const msg = new Uint8Array(len);
  msg[0] = 0xFE;
  msg[1] = len;
  for (let i = 0; i < payload.length; i++) msg[i + 2] = payload[i];
  const crc = crc16(msg.slice(0, len - 2));
  msg[len - 2] = crc & 0xFF;
  msg[len - 1] = (crc >> 8) & 0xFF;
  // Pad to 16-byte blocks
  const padLen = (16 - (msg.length % 16)) % 16;
  const padded = new Uint8Array(msg.length + padLen);
  padded.set(msg);
  return aesEcbEncrypt(padded);
}

// Move lookup table (from protocol docs, byte at offset 32 in State Change)
const MOVE_TABLE: Record<number, string> = {
  0x01: "L'", 0x02: 'L', 0x03: "R'", 0x04: 'R',
  0x05: "D'", 0x06: 'D', 0x07: "U'", 0x08: 'U',
  0x09: "F'", 0x0A: 'F', 0x0B: "B'", 0x0C: 'B',
};

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

// ── 3D Cube ──
function Cube3D({ rx, ry }: { rx: number; ry: number }) {
  const cubies = useMemo(() => {
    const r: { x: number; y: number; z: number; f: Record<string, string> }[] = [];
    for (let x=-1;x<=1;x++) for (let y=-1;y<=1;y++) for (let z=-1;z<=1;z++) {
      const f: Record<string, string> = {};
      if (y===1) f.top='#fff'; if (y===-1) f.bottom='#ffd500'; if (z===1) f.front='#c41e3a';
      if (z===-1) f.back='#ff5800'; if (x===1) f.right='#009e60'; if (x===-1) f.left='#0051ba';
      r.push({ x, y, z, f });
    }
    return r;
  }, []);
  return (
    <div style={{ perspective: '600px', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 120, height: 120, position: 'relative', transformStyle: 'preserve-3d', transform: `rotateX(${rx}deg) rotateY(${ry}deg)`, transition: 'transform 0.1s' }}>
        {cubies.map(({ x, y, z, f }, i) => (
          <div key={i} style={{ position: 'absolute', width: 36, height: 36, transformStyle: 'preserve-3d', transform: `translate3d(${x*38+42}px,${-y*38+42}px,${z*38}px)` }}>
            {([['top','rotateX(90deg) translateZ(18px)'],['bottom','rotateX(-90deg) translateZ(18px)'],['front','translateZ(18px)'],['back','rotateY(180deg) translateZ(18px)'],['right','rotateY(90deg) translateZ(18px)'],['left','rotateY(-90deg) translateZ(18px)']] as [string,string][]).map(([k,t]) => <div key={k} style={{ position:'absolute', width:36, height:36, transform:t, background:f[k]||'#1a1a2e', border:'1.5px solid #0a0a1a', borderRadius:3, boxSizing:'border-box' }} />)}
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

  const startRef = useRef<number|null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const logId = useRef(0);
  const dragging = useRef(false);
  const lastM = useRef({ x:0, y:0 });
  const connLock = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const writeRef = useRef<any>(null);
  const sessionToken = useRef<number[]>([]);
  const cubeStateRef = useRef<number[]>([]);
  const heartbeatRef = useRef<ReturnType<typeof setInterval>|null>(null);

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

  // Connect Qiyi cube
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

      // Per protocol docs: ALL communication uses fff6 (both WRITE and NOTIFY)
      const mainChar = await service.getCharacteristic(QIYI_CHAR_FALLBACK_NOTIFY); // fff6
      writeRef.current = mainChar;
      addLog('✅ fff6 (WRITE+NOTIFY)', 'success');

      // Get MAC address from device (needed for App Hello)
      // Web Bluetooth doesn't expose MAC directly, but we can try to get it from advertisement
      // If not available, we'll try with zeros (some cubes accept it)
      // MAC address of cube: CC:A3:00:00:CC:3E (reversed: 3E:CC:00:00:A3:CC)
      const macBytes = [0xCC, 0xA3, 0x00, 0x00, 0xCC, 0x3E];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const adv = (device as any).__adv_data;
      if (adv) {
        addLog(`广播数据: ${Array.from(adv).map((b: unknown) => (b as number).toString(16).padStart(2, '0')).join(' ')}`, 'info');
      }

      // Subscribe to fff6 notifications
      mainChar.addEventListener('characteristicvaluechanged', ((event: Event) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const val = (event.target as any).value as DataView;
        if (!val) return;
        const raw = new Uint8Array(val.buffer);
        const hex = Array.from(raw).map(b => b.toString(16).padStart(2, '0')).join(' ');
        addLog(`📦 ${hex.slice(0, 50)}${hex.length > 50 ? '...' : ''}`, 'info');

        const parsed = parseMessage(raw);
        if (!parsed) { addLog('⚠️ 解析失败', 'warning'); return; }

        if (parsed.opcode === 0x02) {
          // Cube Hello - initial state + battery
          if (parsed.data.length >= 34) {
            const stateBytes = Array.from(parsed.data.slice(5, 32));
            cubeStateRef.current = stateBytes.reduce<number[]>((acc, b) => { acc.push(b & 0x0F, (b >> 4) & 0x0F); return acc; }, []);
            const batt = parsed.data[33];
            setBattery(batt);
            addLog(`🧊 Cube Hello! 电量:${batt}%`, 'success');

            // Send ACK (bytes 3-7 of received message)
            const ackPayload = [parsed.data[1], parsed.data[2], parsed.data[3], parsed.data[4], parsed.data[5]];
            const ackMsg = buildMessage([0x01, ...ackPayload]);
            mainChar.writeValue(ackMsg).then(() => addLog('📤 ACK 已发送', 'info')).catch((e: unknown) => addLog(`ACK失败: ${e}`, 'warning'));
          }
        } else if (parsed.opcode === 0x03) {
          // State Change - move detected
          if (parsed.data.length >= 34) {
            const moveByte = parsed.data[32]; // Move byte at offset 32
            const move = MOVE_TABLE[moveByte];
            if (move) handleMove(move);
            else addLog(`未知移动: 0x${moveByte.toString(16)}`, 'warning');

            const batt = parsed.data[33];
            if (batt !== undefined) setBattery(batt);

            // Check if ACK needed (byte 91 = needs_ack flag)
            if (parsed.data.length >= 91 && parsed.data[90] === 1) {
              const ackPayload = [parsed.data[1], parsed.data[2], parsed.data[3], parsed.data[4], parsed.data[5]];
              const ackMsg = buildMessage([0x01, ...ackPayload]);
              mainChar.writeValue(ackMsg).catch(() => {});
            }
          }
        } else if (parsed.opcode === 0x04) {
          addLog('🧊 状态已同步', 'success');
        } else if (parsed.opcode === 0x05) {
          addLog(`🧊 当前状态 (${parsed.data.length}B)`, 'success');
        } else {
          addLog(`opcode=0x${parsed.opcode.toString(16)} data=${parsed.data.length}B`, 'info');
        }
      }) as EventListener);

      await mainChar.startNotifications();
      addLog('🔔 已订阅 fff6 通知', 'success');

      // ═══ Send App Hello (MANDATORY - first message, cube won't respond without it) ═══
      // Format: [0xFE][0x15][00...11 bytes MAC_reversed][CRC16_LE]
      // MAC goes at bytes 13-18, reversed
      const helloPayload = new Array(19).fill(0x00);
      helloPayload[0] = 0x15; // length = 21
      // Bytes 1-11: unknown, can be zeros
      // Bytes 12-17: MAC address reversed
      for (let i = 0; i < 6; i++) helloPayload[12 + i] = macBytes[5 - i];

      const helloMsg = buildMessage(helloPayload);
      const helloHex = Array.from(helloMsg).map(b => b.toString(16).padStart(2, '0')).join(' ');
      addLog(`📤 App Hello: ${helloHex.slice(0, 40)}...`, 'info');
      await mainChar.writeValue(helloMsg);
      addLog('📤 App Hello 已发送', 'success');

      // Wait for Cube Hello response
      await new Promise(r => setTimeout(r, 1000));

      // Also try reading fff7 for initial state
      try {
        const fff7 = await service.getCharacteristic('0000fff7-0000-1000-8000-00805f9b34fb');
        const val = await fff7.readValue();
        const hex = Array.from(new Uint8Array(val.buffer)).map(b => b.toString(16).padStart(2, '0')).join(' ');
        addLog(`📖 fff7: ${hex.slice(0, 60)}`, 'info');
      } catch { /* ok */ }

      // Start heartbeat (send ACK periodically)
      heartbeatRef.current = setInterval(() => {
        if (writeRef.current) {
          const hb = buildMessage([0x08]);
          writeRef.current.writeValue(hb).catch(() => {});
        }
      }, 2000);
      addLog('💓 心跳已启动', 'info');

      // Query battery - send Request State to get current state
      const reqStateMsg = buildMessage([0x05, 0x05, 0x05, 0x05, 0x05]);
      await mainChar.writeValue(reqStateMsg).catch(() => {});

      setConnected(true);
      setConnStatus(`已连接: ${device.name}`);
      addLog('✅ 连接完成，转动魔方！', 'success');

      device.addEventListener('gattserverdisconnected', () => {
        setConnected(false); setConnStatus('已断开'); writeRef.current = null; setBattery(null);
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
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

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); if (heartbeatRef.current) clearInterval(heartbeatRef.current); }, []);
  useEffect(() => { if (typeof window !== 'undefined' && /^((?!chrome|android).)*safari/i.test(navigator.userAgent) && !('bluetooth' in navigator)) setShowSafari(true); }, []);

  const progress = formula ? (moves.length / formula.formula.split(' ').length) * 100 : 0;
  const allMoves = ["U","U'","U2","D","D'","D2","R","R'","R2","L","L'","L2","F","F'","F2","B","B'","B2"];

  return (
    <div style={S.page}>
      {showSafari && <div style={{ background:'rgba(245,158,11,0.1)', borderBottom:'1px solid rgba(245,158,11,0.2)', padding:'10px 16px', textAlign:'center', fontSize:13, color:'#fbbf24' }}>⚠️ Safari不支持蓝牙，请用Chrome/Edge</div>}

      <header style={{ padding:'20px 24px 12px' }}>
        <div style={{ maxWidth:1400, margin:'0 auto', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <h1 style={{ fontSize:26, fontWeight:700, margin:0, background:'linear-gradient(135deg,#22d3ee,#3b82f6,#a855f7)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>🎲 魔方速拧公式训练</h1>
            <p style={{ fontSize:12, color:'#64748b', margin:'4px 0 0' }}>CFOP · 奇艺智能魔方 BLE 协议</p>
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
        {/* Left */}
        <div style={{ ...S.glass, overflow:'hidden', display:'flex', flexDirection:'column' }}>
          <div style={{ padding:16, borderBottom:'1px solid rgba(255,255,255,0.06)' }}><h2 style={{ fontSize:15, fontWeight:600, margin:0 }}>📚 公式库</h2></div>
          <div style={{ display:'flex', gap:4, padding:'10px 12px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
            {Object.keys(formulaLibrary).map(c => <button key={c} onClick={() => { setCat(c); setFormula(null); setMoves([]); }} style={S.btn(cat===c)}>{c}</button>)}
          </div>
          <div style={{ display:'flex', gap:4, padding:'8px 12px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
            {['all','beginner','intermediate','advanced'].map(d => <button key={d} onClick={() => setDiff(d)} style={{ ...S.btnSm, background:diff===d?'rgba(255,255,255,0.1)':'transparent', color:diff===d?'#e2e8f0':'#64748b' }}>{d==='all'?'全部':diffMeta(d).label}</button>)}
          </div>
          <div style={{ flex:1, overflow:'auto', padding:'6px 8px' }}>
            {formulas.map(f => { const dm = diffMeta(f.difficulty); return (
              <div key={f.id} onClick={() => selectFormula(f.id)} style={{ padding:'10px 12px', marginBottom:2, borderRadius:10, cursor:'pointer', background:formula?.id===f.id?'rgba(6,182,212,0.1)':'transparent', border:formula?.id===f.id?'1px solid rgba(6,182,212,0.3)':'1px solid transparent' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}><span style={{ fontSize:12, fontWeight:600, color:'#22d3ee' }}>{f.id}</span>{f.difficulty && <span style={{ fontSize:10, padding:'2px 6px', borderRadius:4, background:dm.bg, color:dm.color }}>{dm.label}</span>}</div>
                <div style={{ ...S.mono, fontSize:13, color:'#fbbf24' }}>{f.formula}</div>
                <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>{f.name} · {f.description}</div>
              </div>
            ); })}
          </div>
        </div>

        {/* Center */}
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          <div style={S.glass}>
            <div style={{ padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span style={{ fontSize:13, color:'#94a3b8' }}>3D 预览</span>
              <div style={{ display:'flex', gap:4 }}>
                {['U','D','R','L','F','B'].map(f => <button key={f} onClick={() => { const m:Record<string,[number,number]>={U:[0,90],D:[0,-90],R:[90,0],L:[-90,0],F:[0,0],B:[180,0]}; const [dx,dy]=m[f]; setRx(p=>p+dx*0.3); setRy(p=>p+dy*0.3); }} style={{ ...S.btnSm, width:28, height:28, padding:0, display:'flex', alignItems:'center', justifyContent:'center', ...S.mono }}>{f}</button>)}
              </div>
            </div>
            <div style={{ height:300, cursor:'grab', userSelect:'none' }} onMouseDown={e => { dragging.current=true; lastM.current={x:e.clientX,y:e.clientY}; }} onMouseMove={e => { if (!dragging.current) return; setRy(p=>p+(e.clientX-lastM.current.x)*0.5); setRx(p=>p-(e.clientY-lastM.current.y)*0.5); lastM.current={x:e.clientX,y:e.clientY}; }} onMouseUp={() => dragging.current=false} onMouseLeave={() => dragging.current=false}>
              <Cube3D rx={rx} ry={ry} />
            </div>
          </div>
          <div style={{ ...S.glass, padding:16 }}>
            <h3 style={{ fontSize:13, fontWeight:600, color:'#94a3b8', margin:'0 0 8px' }}>🎮 手动录入</h3>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:6 }}>
              {allMoves.map(m => <button key={m} onClick={() => handleMove(m)} disabled={!practicing && !connected} style={{ ...S.mono, padding:'10px 0', fontSize:13, fontWeight:600, borderRadius:8, border:'none', cursor:(!practicing&&!connected)?'not-allowed':'pointer', opacity:(!practicing&&!connected)?0.3:1, background:'rgba(255,255,255,0.06)', color:'#e2e8f0' }}>{m}</button>)}
            </div>
          </div>
        </div>

        {/* Right */}
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          <div style={{ ...S.glass, padding:'14px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ width:10, height:10, borderRadius:'50%', background:connected?'#4ade80':connecting?'#fbbf24':'#475569', animation:(connected||connecting)?'pulse 2s infinite':'none' }} />
              <span style={{ fontSize:13, color:'#94a3b8' }}>{connStatus}</span>
            </div>
            <button onClick={connect} disabled={connecting} style={{ padding:'8px 20px', fontSize:13, fontWeight:600, borderRadius:10, border:'none', cursor:connecting?'wait':'pointer', background:connecting?'rgba(107,114,128,0.3)':'linear-gradient(135deg,#06b6d4,#3b82f6)', color:'#fff' }}>{connecting?'搜索中...':connected?'已连接':'🔗 连接魔方'}</button>
          </div>

          <div style={{ ...S.glass, padding:20 }}>
            <h2 style={{ fontSize:16, fontWeight:600, margin:'0 0 16px' }}>🎯 练习</h2>
            {formula ? (<>
              <div style={{ ...S.card, padding:14, marginBottom:16 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                  <span style={{ fontSize:13, fontWeight:600, color:'#22d3ee' }}>{formula.id}: {formula.name}</span>
                  {formula.difficulty && (() => { const dm=diffMeta(formula.difficulty); return <span style={{ fontSize:10, padding:'2px 8px', borderRadius:10, background:dm.bg, color:dm.color }}>{dm.label}</span>; })()}
                </div>
                <div style={{ ...S.mono, fontSize:18, color:'#fbbf24', letterSpacing:1.5 }}>{formula.formula}</div>
                <div style={{ fontSize:11, color:'#64748b', marginTop:6 }}>{formula.description}</div>
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginBottom:14 }}>
                {formula.formula.split(' ').map((m,i) => { const done=i<moves.length; const w=wrongs.has(i); const c=i===hlStep&&practicing; return <span key={i} style={{ ...S.mono, display:'inline-flex', alignItems:'center', justifyContent:'center', width:40, height:40, fontSize:13, fontWeight:700, borderRadius:8, transition:'all 0.2s', background:c?'#06b6d4':done&&!w?'rgba(74,222,128,0.7)':w?'rgba(248,113,113,0.7)':'rgba(255,255,255,0.06)', color:c||done?'#fff':'#94a3b8', boxShadow:c?'0 0 12px rgba(6,182,212,0.4)':'none', transform:c?'scale(1.1)':'scale(1)' }}>{m}</span>; })}
              </div>
              <div style={{ width:'100%', height:6, background:'rgba(255,255,255,0.06)', borderRadius:3, marginBottom:16, overflow:'hidden' }}><div style={{ height:'100%', background:'linear-gradient(90deg,#06b6d4,#4ade80)', borderRadius:3, transition:'width 0.3s', width:`${progress}%` }} /></div>
            </>) : <div style={{ textAlign:'center', padding:'40px 0', color:'#475569' }}><div style={{ fontSize:36, marginBottom:8 }}>👆</div><p style={{ fontSize:13 }}>选择公式开始</p></div>}
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={startPractice} disabled={!formula||practicing} style={{ flex:1, padding:12, fontSize:14, fontWeight:600, borderRadius:12, border:'none', cursor:(!formula||practicing)?'not-allowed':'pointer', opacity:(!formula||practicing)?0.4:1, background:'linear-gradient(135deg,#06b6d4,#3b82f6)', color:'#fff' }}>{practicing?'练习中...':'▶ 开始'}</button>
              <button onClick={resetPractice} style={{ padding:'12px 20px', fontSize:14, fontWeight:600, borderRadius:12, border:'1px solid rgba(255,255,255,0.08)', background:'rgba(255,255,255,0.04)', color:'#94a3b8', cursor:'pointer' }}>↺</button>
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
            {[{l:'正确',v:stats.correct,c:'#22d3ee'},{l:'错误',v:stats.wrong,c:'#f87171'},{l:'用时',v:`${time}s`,c:'#fbbf24'},{l:'连击',v:stats.streak,c:'#4ade80'}].map(({l,v,c}) => <div key={l} style={{ ...S.glass, padding:12, textAlign:'center' }}><div style={{ fontSize:22, fontWeight:700, color:c }}>{v}</div><div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>{l}</div></div>)}
          </div>

          <div style={{ ...S.glass, overflow:'hidden', flex:1, minHeight:0 }}>
            <div style={{ padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}><h3 style={{ fontSize:13, fontWeight:600, color:'#94a3b8', margin:0 }}>📋 日志</h3></div>
            <div style={{ padding:'8px 12px', maxHeight:160, overflowY:'auto' }}>
              {logs.map(l => <div key={l.id} style={{ ...S.mono, fontSize:11, padding:'2px 0', color:l.type==='success'?'#4ade80':l.type==='error'?'#f87171':l.type==='warning'?'#fbbf24':'#64748b' }}><span style={{ color:'#334155' }}>[{l.time}]</span> {l.message}</div>)}
            </div>
          </div>
        </div>
      </main>

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}*{box-sizing:border-box}body{margin:0}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:2px}button:hover{filter:brightness(1.2)}button:active{transform:scale(.97)}`}</style>
    </div>
  );
}
