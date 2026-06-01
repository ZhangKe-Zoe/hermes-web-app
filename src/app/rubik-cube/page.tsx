'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// ── Types ──
interface Formula {
  id: string;
  name: string;
  formula: string;
  description: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
}

interface Stats { correct: number; wrong: number; streak: number; bestStreak: number; }
interface LogEntry { id: number; time: string; message: string; type: 'info' | 'success' | 'error' | 'warning'; }

// ── Qiyi Smart Cube Protocol ──
// Source: https://codeberg.org/Flying-Toast/qiyi_smartcube_protocol
const QIYI_SERVICE = '0000fff0-0000-1000-8000-00805f9b34fb';
const QIYI_CHAR_RW = '0000fff6-0000-1000-8000-00805f9b34fb'; // Main: WRITE + NOTIFY

// AES-128-ECB key (fixed)
const AES_KEY = [0x57, 0xb1, 0xf9, 0xab, 0xcd, 0x5a, 0xe8, 0xa7, 0x9c, 0xb9, 0x8c, 0xe7, 0x57, 0x8c, 0x51, 0x08];

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

// Pad to 16-byte blocks
function padTo16(data: Uint8Array): Uint8Array {
  const padLen = (16 - (data.length % 16)) % 16;
  if (padLen === 0) return data;
  const padded = new Uint8Array(data.length + padLen);
  padded.set(data);
  return padded;
}

// AES-128-ECB encrypt (pure JS, no Web Crypto needed)
// S-Box
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

// Rcon for key expansion
const RCON = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];

function aesKeyExpansion(key: number[]): number[] {
  const w = new Array(176);
  for (let i = 0; i < 16; i++) w[i] = key[i];
  for (let i = 16; i < 176; i += 4) {
    let temp = [w[i-4], w[i-3], w[i-2], w[i-1]];
    if (i % 16 === 0) {
      temp = [SBOX[temp[1]] ^ RCON[i/16-1], SBOX[temp[2]], SBOX[temp[3]], SBOX[temp[0]]];
    }
    for (let j = 0; j < 4; j++) w[i+j] = w[i-16+j] ^ temp[j];
  }
  return w;
}

function aesEncryptBlock(block: number[], expandedKey: number[]): number[] {
  const state = [...block];
  const nr = 10;

  // AddRoundKey
  for (let i = 0; i < 16; i++) state[i] ^= expandedKey[i];

  for (let round = 1; round < nr; round++) {
    // SubBytes
    for (let i = 0; i < 16; i++) state[i] = SBOX[state[i]];
    // ShiftRows
    const t = [state[1], state[5], state[9], state[13]];
    state[1] = state[5]; state[5] = state[9]; state[9] = state[13]; state[13] = t[0];
    const t2 = [state[2], state[6], state[10], state[14]];
    state[2] = state[10]; state[10] = t2[0]; state[6] = state[14]; state[14] = t2[1];
    const t3 = [state[3], state[7], state[11], state[15]];
    state[3] = state[15]; state[15] = state[11]; state[11] = state[7]; state[7] = t3[0];
    // MixColumns
    for (let c = 0; c < 4; c++) {
      const i = c * 4;
      const a = [state[i], state[i+1], state[i+2], state[i+3]];
      state[i]   = gfMul(a[0],2) ^ gfMul(a[1],3) ^ a[2] ^ a[3];
      state[i+1] = a[0] ^ gfMul(a[1],2) ^ gfMul(a[2],3) ^ a[3];
      state[i+2] = a[0] ^ a[1] ^ gfMul(a[2],2) ^ gfMul(a[3],3);
      state[i+3] = gfMul(a[0],3) ^ a[1] ^ a[2] ^ gfMul(a[3],2);
    }
    // AddRoundKey
    for (let i = 0; i < 16; i++) state[i] ^= expandedKey[round*16+i];
  }

  // Final round (no MixColumns)
  for (let i = 0; i < 16; i++) state[i] = SBOX[state[i]];
  const t = [state[1], state[5], state[9], state[13]];
  state[1] = state[5]; state[5] = state[9]; state[9] = state[13]; state[13] = t[0];
  const t2 = [state[2], state[6], state[10], state[14]];
  state[2] = state[10]; state[10] = t2[0]; state[6] = state[14]; state[14] = t2[1];
  const t3 = [state[3], state[7], state[11], state[15]];
  state[3] = state[15]; state[15] = state[11]; state[11] = state[7]; state[7] = t3[0];
  for (let i = 0; i < 16; i++) state[i] ^= expandedKey[nr*16+i];

  return state;
}

function gfMul(a: number, b: number): number {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xFF;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return p;
}

function aesEcbEncrypt(data: Uint8Array, key: number[]): Uint8Array {
  const expandedKey = aesKeyExpansion(key);
  const padded = padTo16(data);
  const result = new Uint8Array(padded.length);
  for (let i = 0; i < padded.length; i += 16) {
    const block = Array.from(padded.slice(i, i + 16));
    const enc = aesEncryptBlock(block, expandedKey);
    result.set(enc, i);
  }
  return result;
}

function aesEcbDecrypt(data: Uint8Array, key: number[]): Uint8Array {
  // For decryption we need inverse S-Box and inverse operations
  // For now, since we mainly need to parse cube→app messages,
  // we'll implement a simplified version
  const expandedKey = aesKeyExpansion(key);
  const invSbox = new Array(256);
  for (let i = 0; i < 256; i++) invSbox[SBOX[i]] = i;

  const result = new Uint8Array(data.length);
  for (let offset = 0; offset < data.length; offset += 16) {
    const block = Array.from(data.slice(offset, offset + 16));
    const state = [...block];

    // AddRoundKey (round 10)
    for (let i = 0; i < 16; i++) state[i] ^= expandedKey[10*16+i];

    for (let round = 9; round >= 1; round--) {
      // InvShiftRows
      const t = [state[13], state[9], state[5], state[1]];
      state[1] = t[0]; state[5] = t[1]; state[9] = t[2]; state[13] = t[3];
      const t2 = [state[2], state[6], state[10], state[14]];
      state[2] = state[10]; state[10] = t2[0]; state[6] = state[14]; state[14] = t2[1];
      const t3 = [state[3], state[7], state[11], state[15]];
      state[3] = state[7]; state[7] = state[11]; state[11] = state[15]; state[15] = t3[0];
      // InvSubBytes
      for (let i = 0; i < 16; i++) state[i] = invSbox[state[i]];
      // AddRoundKey
      for (let i = 0; i < 16; i++) state[i] ^= expandedKey[round*16+i];
      // InvMixColumns
      for (let c = 0; c < 4; c++) {
        const i = c * 4;
        const a = [state[i], state[i+1], state[i+2], state[i+3]];
        state[i]   = gfMul(a[0],14) ^ gfMul(a[1],11) ^ gfMul(a[2],13) ^ gfMul(a[3],9);
        state[i+1] = gfMul(a[0],9) ^ gfMul(a[1],14) ^ gfMul(a[2],11) ^ gfMul(a[3],13);
        state[i+2] = gfMul(a[0],13) ^ gfMul(a[1],9) ^ gfMul(a[2],14) ^ gfMul(a[3],11);
        state[i+3] = gfMul(a[0],11) ^ gfMul(a[1],13) ^ gfMul(a[2],9) ^ gfMul(a[3],14);
      }
    }

    // InvShiftRows (round 0)
    const t = [state[13], state[9], state[5], state[1]];
    state[1] = t[0]; state[5] = t[1]; state[9] = t[2]; state[13] = t[3];
    const t2 = [state[2], state[6], state[10], state[14]];
    state[2] = state[10]; state[10] = t2[0]; state[6] = state[14]; state[14] = t2[1];
    const t3 = [state[3], state[7], state[11], state[15]];
    state[3] = state[7]; state[7] = state[11]; state[11] = state[15]; state[15] = t3[0];
    for (let i = 0; i < 16; i++) state[i] = invSbox[state[i]];
    // Final AddRoundKey (round 0)
    for (let i = 0; i < 16; i++) state[i] ^= expandedKey[i];

    result.set(state, offset);
  }
  return result;
}

// Build protocol message: [0xFE] [len] [payload] [crc16_le], then pad+encrypt
function buildMessage(payload: number[]): Uint8Array {
  const len = payload.length + 4; // FE + len + payload + 2 CRC bytes
  const msg = new Uint8Array(len);
  msg[0] = 0xFE;
  msg[1] = len;
  for (let i = 0; i < payload.length; i++) msg[i + 2] = payload[i];
  const crc = crc16(msg.slice(0, len - 2));
  msg[len - 2] = crc & 0xFF;
  msg[len - 1] = (crc >> 8) & 0xFF;
  return aesEcbEncrypt(msg, AES_KEY);
}

// Parse received encrypted message
function parseMessage(encrypted: Uint8Array): { opcode: number; data: Uint8Array } | null {
  try {
    const decrypted = aesEcbDecrypt(encrypted, AES_KEY);
    // Find 0xFE start byte
    let start = 0;
    while (start < decrypted.length && decrypted[start] !== 0xFE) start++;
    if (start >= decrypted.length) return null;

    const msgLen = decrypted[start + 1];
    if (msgLen < 4 || start + msgLen > decrypted.length) return null;

    const msg = decrypted.slice(start, start + msgLen);
    // Verify CRC
    const expectedCrc = msg[msgLen - 2] | (msg[msgLen - 1] << 8);
    const actualCrc = crc16(msg.slice(0, msgLen - 2));
    if (expectedCrc !== actualCrc) {
      // CRC mismatch but try to parse anyway
    }

    const opcode = msg[2];
    const data = msg.slice(2); // opcode + rest
    return { opcode, data };
  } catch {
    return null;
  }
}

// Move lookup table
const MOVE_TABLE: Record<number, string> = {
  0x01: "L'", 0x02: 'L', 0x03: "R'", 0x04: 'R',
  0x05: "D'", 0x06: 'D', 0x07: "U'", 0x08: 'U',
  0x09: "F'", 0x0A: 'F', 0x0B: "B'", 0x0C: 'B',
};

// Color mapping for cube state
const COLOR_MAP: Record<number, string> = {
  0: '#FF5800', // Orange
  1: '#C41E3A', // Red
  2: '#FFD500', // Yellow
  3: '#FFFFFF', // White
  4: '#009E60', // Green
  5: '#0051BA', // Blue
};

// ── Formula Library ──
const formulaLibrary: Record<string, Formula[]> = {
  OLL: [
    { id: 'OLL-1', name: '点 → 十字', formula: "F R U R' U' F'", description: '顶层十字情况', difficulty: 'beginner' },
    { id: 'OLL-2', name: '点 → 十字', formula: "F U R U' R' F'", description: '另一种十字情况', difficulty: 'beginner' },
    { id: 'OLL-3', name: '十字 → 全黄', formula: "R U R' U R U2 R'", description: '鱼形情况', difficulty: 'intermediate' },
    { id: 'OLL-4', name: '十字 → 全黄', formula: "R U2 R' U' R U' R'", description: '另一种鱼形', difficulty: 'intermediate' },
    { id: 'OLL-21', name: '十字 + 两侧', formula: "R U2 R' U' R U R' U' R U' R'", description: '21号OLL', difficulty: 'advanced' },
    { id: 'OLL-22', name: '十字 + 两侧', formula: "R U2 R2 U' R2 U' R2 U2 R", description: '22号OLL', difficulty: 'advanced' },
    { id: 'OLL-23', name: '十字 + 对角', formula: "R2 D R' U2 R D' R' U2 R'", description: '23号OLL', difficulty: 'advanced' },
    { id: 'OLL-24', name: '十字 + 对角', formula: "r U R' U' r' F R F'", description: '24号OLL', difficulty: 'intermediate' },
    { id: 'OLL-25', name: '十字 + 一字', formula: "F' r U R' U' r' F R", description: '25号OLL', difficulty: 'intermediate' },
    { id: 'OLL-26', name: '十字 + 一字', formula: "R U2 R' U' R U' R'", description: '反鱼形', difficulty: 'beginner' },
    { id: 'OLL-27', name: '全黄', formula: "R U R' U R U2 R'", description: '正鱼形', difficulty: 'beginner' },
    { id: 'OLL-57', name: '全黄', formula: "R U R' U' M' U R U' r'", description: '57号OLL', difficulty: 'advanced' },
  ],
  PLL: [
    { id: 'PLL-Ua', name: 'Ua排列', formula: "R U R' U R' U' R2 U' R' U R' U R", description: '顺时针三棱换', difficulty: 'intermediate' },
    { id: 'PLL-Ub', name: 'Ub排列', formula: "R' U R' U' R2 U' R' U R U R2", description: '逆时针三棱换', difficulty: 'intermediate' },
    { id: 'PLL-H', name: 'H排列', formula: "M2 U M2 U2 M2 U M2", description: '对棱换', difficulty: 'beginner' },
    { id: 'PLL-Z', name: 'Z排列', formula: "M2 U M2 U M' U2 M2 U2 M'", description: '邻棱换', difficulty: 'intermediate' },
    { id: 'PLL-Aa', name: 'Aa排列', formula: "R' F R' B2 R F' R' B2 R2", description: '三角换顺时针', difficulty: 'advanced' },
    { id: 'PLL-Ab', name: 'Ab排列', formula: "R2 B2 R F R' B2 R F' R", description: '三角换逆时针', difficulty: 'advanced' },
    { id: 'PLL-T', name: 'T排列', formula: "R U R' U' R' F R2 U' R' U' R U R' F'", description: 'T排列', difficulty: 'intermediate' },
    { id: 'PLL-Y', name: 'Y排列', formula: "F R U' R' U' R U R' F' R U R' U' R' F R F'", description: 'Y排列', difficulty: 'advanced' },
  ],
  F2L: [
    { id: 'F2L-1', name: '基础情况1', formula: "U R U' R'", description: '角块在底层，棱在顶层', difficulty: 'beginner' },
    { id: 'F2L-2', name: '基础情况2', formula: "U' F' U F", description: '角块在底层，棱在顶层', difficulty: 'beginner' },
    { id: 'F2L-3', name: '基础情况3', formula: "R U' R'", description: '角块棱块都在底层', difficulty: 'beginner' },
    { id: 'F2L-4', name: '基础情况4', formula: "F' U F", description: '角块棱块都在底层', difficulty: 'beginner' },
    { id: 'F2L-5', name: '角块朝上', formula: "R U2 R' U' R U R'", description: '角块白色朝上', difficulty: 'intermediate' },
    { id: 'F2L-6', name: '角块朝上', formula: "F' U2 F U F' U' F", description: '角块白色朝上', difficulty: 'intermediate' },
    { id: 'F2L-7', name: '棱块已就位', formula: "R U R' U' R U R'", description: '棱块已到位，角块需调整', difficulty: 'intermediate' },
    { id: 'F2L-8', name: '棱块已就位', formula: "F' U' F U F' U' F", description: '棱块已到位，角块需调整', difficulty: 'intermediate' },
  ],
};

// ── Styles ──
const S = {
  page: { minHeight: '100vh', background: 'linear-gradient(135deg, #030712 0%, #0f172a 50%, #030712 100%)', color: '#e2e8f0', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif' } as React.CSSProperties,
  glass: { background: 'rgba(255,255,255,0.03)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '16px' } as React.CSSProperties,
  card: { background: 'rgba(0,0,0,0.2)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.04)' } as React.CSSProperties,
  btn: (active?: boolean) => ({ padding: '6px 14px', fontSize: '13px', fontWeight: 600 as const, borderRadius: '8px', border: 'none', cursor: 'pointer' as const, transition: 'all 0.15s', background: active ? '#06b6d4' : 'rgba(255,255,255,0.06)', color: active ? '#fff' : '#94a3b8' } as React.CSSProperties),
  btnSm: { padding: '4px 10px', fontSize: '11px', fontWeight: 500, borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#94a3b8', cursor: 'pointer', transition: 'all 0.15s' } as React.CSSProperties,
  mono: { fontFamily: '"SF Mono", "Fira Code", Menlo, Consolas, monospace' } as React.CSSProperties,
};

function diffMeta(d?: string) {
  switch (d) {
    case 'beginner': return { label: '初级', color: '#4ade80', bg: 'rgba(74,222,128,0.15)' };
    case 'intermediate': return { label: '中级', color: '#facc15', bg: 'rgba(250,204,21,0.15)' };
    case 'advanced': return { label: '高级', color: '#f87171', bg: 'rgba(248,113,113,0.15)' };
    default: return { label: '全部', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' };
  }
}

// ── 3D Cube ──
function Cube3D({ rotationX, rotationY }: { rotationX: number; rotationY: number }) {
  const cubies = useMemo(() => {
    const r: { x: number; y: number; z: number; faces: Record<string, string> }[] = [];
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      const faces: Record<string, string> = {};
      if (y === 1) faces.top = '#ffffff';
      if (y === -1) faces.bottom = '#ffd500';
      if (z === 1) faces.front = '#c41e3a';
      if (z === -1) faces.back = '#ff5800';
      if (x === 1) faces.right = '#009e60';
      if (x === -1) faces.left = '#0051ba';
      r.push({ x, y, z, faces });
    }
    return r;
  }, []);

  return (
    <div style={{ perspective: '600px', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '120px', height: '120px', position: 'relative', transformStyle: 'preserve-3d', transform: `rotateX(${rotationX}deg) rotateY(${rotationY}deg)`, transition: 'transform 0.1s ease-out' }}>
        {cubies.map(({ x, y, z, faces }, i) => (
          <div key={i} style={{ position: 'absolute', width: '36px', height: '36px', transformStyle: 'preserve-3d', transform: `translate3d(${x*38+42}px, ${-y*38+42}px, ${z*38}px)` }}>
            {([['top','rotateX(90deg) translateZ(18px)'],['bottom','rotateX(-90deg) translateZ(18px)'],['front','translateZ(18px)'],['back','rotateY(180deg) translateZ(18px)'],['right','rotateY(90deg) translateZ(18px)'],['left','rotateY(-90deg) translateZ(18px)']] as [string,string][]).map(([f,tf]) => (
              <div key={f} style={{ position: 'absolute', width: '36px', height: '36px', transform: tf, background: faces[f] || '#1a1a2e', border: '1.5px solid #0a0a1a', borderRadius: '3px', boxSizing: 'border-box' }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ──
export default function RubikCubeTrainer() {
  const [currentCategory, setCurrentCategory] = useState('OLL');
  const [currentFormula, setCurrentFormula] = useState<Formula | null>(null);
  const [isPracticing, setIsPracticing] = useState(false);
  const [userMoves, setUserMoves] = useState<string[]>([]);
  const [wrongMoves, setWrongMoves] = useState<Set<number>>(new Set());
  const [stats, setStats] = useState<Stats>({ correct: 0, wrong: 0, streak: 0, bestStreak: 0 });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('未连接');
  const [isConnecting, setIsConnecting] = useState(false);
  const [cubeRotX, setCubeRotX] = useState(-25);
  const [cubeRotY, setCubeRotY] = useState(35);
  const [difficulty, setDifficulty] = useState('all');
  const [highlightedStep, setHighlightedStep] = useState(-1);
  const [lastMove, setLastMove] = useState<string | null>(null);
  const [battery, setBattery] = useState<number | null>(null);
  const [showSafariWarning, setShowSafariWarning] = useState(false);

  const startTimeRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logIdRef = useRef(0);
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const connectingRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const charRef = useRef<any>(null);
  const cubeStateRef = useRef<number[]>([]);

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    logIdRef.current++;
    setLogs(prev => [{ id: logIdRef.current, time: new Date().toLocaleTimeString(), message, type }, ...prev].slice(0, 80));
  }, []);

  const formulas = useMemo(() => {
    const list = formulaLibrary[currentCategory] || [];
    return difficulty === 'all' ? list : list.filter(f => f.difficulty === difficulty);
  }, [currentCategory, difficulty]);

  // Handle cube move
  const handleCubeMove = useCallback((move: string) => {
    setLastMove(move);
    addLog(`🎲 ${move}`, 'success');

    if (currentFormula && isPracticing) {
      const expectedMoves = currentFormula.formula.split(' ');
      const idx = userMoves.length;
      if (idx < expectedMoves.length) {
        const expected = expectedMoves[idx].replace(/\s+/g, '').toUpperCase();
        const actual = move.replace(/\s+/g, '').toUpperCase();
        if (actual === expected) {
          setStats(prev => { const ns = prev.streak + 1; return { correct: prev.correct + 1, wrong: prev.wrong, streak: ns, bestStreak: Math.max(prev.bestStreak, ns) }; });
          addLog(`✅ 步骤${idx+1}: ${move}`, 'success');
          setHighlightedStep(idx + 1);
        } else {
          setStats(prev => ({ ...prev, wrong: prev.wrong + 1, streak: 0 }));
          setWrongMoves(prev => new Set(prev).add(idx));
          addLog(`❌ 期望 ${expectedMoves[idx]}，实际 ${move}`, 'error');
        }
        setUserMoves(prev => [...prev, move]);
        if (idx+1 === expectedMoves.length && actual === expected) {
          const t = ((Date.now() - (startTimeRef.current||Date.now()))/1000).toFixed(1);
          addLog(`🎉 完美完成！用时 ${t}s`, 'success');
          setIsPracticing(false);
          if (timerRef.current) clearInterval(timerRef.current);
        }
      }
    }
  }, [currentFormula, isPracticing, userMoves, addLog]);

  // Connect to Qiyi cube using proper protocol
  const connectCube = useCallback(async () => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    setIsConnecting(true);

    const ua = navigator.userAgent;
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
    if (!('bluetooth' in navigator)) {
      addLog(isSafari ? '⚠️ Safari 不支持蓝牙，请用 Chrome/Edge' : '⚠️ 浏览器不支持 Web Bluetooth', 'error');
      connectingRef.current = false; setIsConnecting(false); return;
    }

    addLog('🔍 搜索奇艺智能魔方...', 'info');
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bt = (navigator as unknown as { bluetooth: { requestDevice: (o: Record<string, unknown>) => Promise<any> } }).bluetooth;
      const device = await bt.requestDevice({
        filters: [{ namePrefix: 'QY' }],
        optionalServices: [QIYI_SERVICE],
      });

      addLog(`📱 找到: ${device.name}`, 'success');
      const server = await device.gatt.connect();
      addLog('🔗 GATT 连接成功', 'info');

      const service = await server.getPrimaryService(QIYI_SERVICE);
      const char = await service.getCharacteristic(QIYI_CHAR_RW);
      charRef.current = char;
      addLog('✅ 获取 fff6 特征值 (READ+WRITE+NOTIFY)', 'success');

      // Subscribe to notifications
      char.addEventListener('characteristicvaluechanged', ((event: Event) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const val = (event.target as any).value as DataView;
        if (!val) return;
        const raw = new Uint8Array(val.buffer);
        const parsed = parseMessage(raw);
        if (!parsed) return;

        if (parsed.opcode === 0x02) {
          // Cube Hello - initial state
          if (parsed.data.length >= 34) {
            const stateBytes = Array.from(parsed.data.slice(5, 32));
            cubeStateRef.current = stateBytes.reduce((acc: number[], b) => { acc.push(b & 0x0F, (b >> 4) & 0x0F); return acc; }, []);
            const batt = parsed.data[33];
            setBattery(batt);
            addLog(`🧊 魔方状态已同步 (电量: ${batt}%)`, 'success');

            // Send ACK
            const ackPayload = [0x01, parsed.data[1], parsed.data[2], parsed.data[3], parsed.data[4]];
            const ackMsg = buildMessage(ackPayload);
            char.writeValue(ackMsg).catch(() => {});
            addLog('📤 ACK 已发送', 'info');
          }
        } else if (parsed.opcode === 0x03) {
          // State Change - move detected
          if (parsed.data.length >= 33) {
            const moveByte = parsed.data[32];
            const move = MOVE_TABLE[moveByte];
            if (move) handleCubeMove(move);

            // Update cube state
            const stateBytes = Array.from(parsed.data.slice(5, 32));
            cubeStateRef.current = stateBytes.reduce((acc: number[], b) => { acc.push(b & 0x0F, (b >> 4) & 0x0F); return acc; }, []);
            const batt = parsed.data[33];
            if (batt !== undefined) setBattery(batt);

            // Check if ACK needed
            if (parsed.data.length >= 90 && parsed.data[89] === 1) {
              const ackPayload = [0x01, parsed.data[1], parsed.data[2], parsed.data[3], parsed.data[4]];
              const ackMsg = buildMessage(ackPayload);
              char.writeValue(ackMsg).catch(() => {});
            }
          }
        }
      }) as EventListener);

      await char.startNotifications();
      addLog('🔔 已订阅 fff6 通知', 'success');

      // Send App Hello to initiate handshake
      // Build hello: [0xFE, 0x15, 0x00, 11 zeros, 6 bytes MAC (reversed)]
      // Since we don't know the MAC, send with zeros (cube should still respond)
      const helloPayload = new Array(17).fill(0x00);
      const helloMsg = buildMessage(helloPayload);
      await char.writeValue(helloMsg);
      addLog('📤 App Hello 已发送，等待魔方响应...', 'info');

      setIsConnected(true);
      setConnectionStatus(`已连接: ${device.name}`);
      addLog('✅ 连接完成！转动魔方观察数据', 'success');

      device.addEventListener('gattserverdisconnected', () => {
        setIsConnected(false); setConnectionStatus('已断开'); charRef.current = null; setBattery(null);
        addLog('🔌 魔方已断开', 'warning');
      });

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '未知错误';
      if (msg.includes('cancelled')) addLog('用户取消', 'info');
      else addLog(`❌ ${msg}`, 'error');
    } finally {
      connectingRef.current = false;
      setIsConnecting(false);
    }
  }, [addLog, handleCubeMove]);

  // Select formula
  const selectFormula = useCallback((id: string) => {
    const f = formulas.find(x => x.id === id);
    if (f) { setCurrentFormula(f); setUserMoves([]); setWrongMoves(new Set()); setHighlightedStep(-1); addLog(`选择: ${f.id}`, 'info'); }
  }, [formulas, addLog]);

  const startPractice = useCallback(() => {
    if (!currentFormula) { addLog('请先选择公式', 'error'); return; }
    setIsPracticing(true); setUserMoves([]); setWrongMoves(new Set()); setHighlightedStep(0);
    setStats({ correct: 0, wrong: 0, streak: 0, bestStreak: 0 }); setElapsedTime(0);
    startTimeRef.current = Date.now(); addLog(`开始: ${currentFormula.id}`, 'success');
    timerRef.current = setInterval(() => { if (startTimeRef.current) setElapsedTime(parseFloat(((Date.now()-startTimeRef.current)/1000).toFixed(1))); }, 100);
  }, [currentFormula, addLog]);

  const resetPractice = useCallback(() => {
    setIsPracticing(false); setUserMoves([]); setWrongMoves(new Set()); setHighlightedStep(-1);
    setStats({ correct: 0, wrong: 0, streak: 0, bestStreak: 0 }); setElapsedTime(0);
    startTimeRef.current = null; if (timerRef.current) clearInterval(timerRef.current); addLog('已重置', 'info');
  }, [addLog]);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  // Detect Safari (client-side only)
  useEffect(() => {
    const ua = navigator.userAgent;
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
    if (isSafari && !('bluetooth' in navigator)) setShowSafariWarning(true);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => { isDragging.current = true; lastMouse.current = { x: e.clientX, y: e.clientY }; }, []);
  const handleMouseMove = useCallback((e: React.MouseEvent) => { if (!isDragging.current) return; setCubeRotY(p => p + (e.clientX - lastMouse.current.x)*0.5); setCubeRotX(p => p - (e.clientY - lastMouse.current.y)*0.5); lastMouse.current = { x: e.clientX, y: e.clientY }; }, []);
  const handleMouseUp = useCallback(() => { isDragging.current = false; }, []);

  const progress = currentFormula ? (userMoves.length / currentFormula.formula.split(' ').length) * 100 : 0;
  const allMoves = ["U","U'","U2","D","D'","D2","R","R'","R2","L","L'","L2","F","F'","F2","B","B'","B2"];

  return (
    <div style={S.page}>
      {showSafariWarning && <div style={{ background:'rgba(245,158,11,0.1)', borderBottom:'1px solid rgba(245,158,11,0.2)', padding:'10px 16px', textAlign:'center', fontSize:'13px', color:'#fbbf24' }}>⚠️ Safari 不支持蓝牙，请用 Chrome/Edge</div>}

      <header style={{ padding:'20px 24px 12px' }}>
        <div style={{ maxWidth:'1400px', margin:'0 auto', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <h1 style={{ fontSize:'26px', fontWeight:700, margin:0, background:'linear-gradient(135deg, #22d3ee, #3b82f6, #a855f7)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>🎲 魔方速拧公式训练</h1>
            <p style={{ fontSize:'12px', color:'#64748b', margin:'4px 0 0' }}>CFOP · OLL · PLL · F2L · 奇艺智能魔方 BLE 协议</p>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
            {lastMove && <div style={{ ...S.mono, fontSize:'20px', fontWeight:700, color:'#22d3ee', padding:'4px 12px', background:'rgba(34,211,238,0.1)', borderRadius:'8px', border:'1px solid rgba(34,211,238,0.2)' }}>{lastMove}</div>}
            {battery !== null && <div style={{ fontSize:'12px', color:'#94a3b8', padding:'4px 10px', background:'rgba(255,255,255,0.04)', borderRadius:'12px', border:'1px solid rgba(255,255,255,0.08)' }}>🔋 {battery}%</div>}
            <div style={{ display:'flex', alignItems:'center', gap:'6px', padding:'6px 12px', borderRadius:'20px', fontSize:'12px', background:isConnected?'rgba(74,222,128,0.1)':'rgba(255,255,255,0.04)', border:`1px solid ${isConnected?'rgba(74,222,128,0.3)':'rgba(255,255,255,0.08)'}`, color:isConnected?'#4ade80':'#64748b' }}>
              <span style={{ width:'8px', height:'8px', borderRadius:'50%', background:isConnected?'#4ade80':'#475569', animation:isConnected?'pulse 2s infinite':'none' }} />
              {connectionStatus}
            </div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth:'1400px', margin:'0 auto', padding:'0 24px 24px', display:'grid', gridTemplateColumns:'280px 1fr 360px', gap:'16px' }}>
        {/* Left: Formula Library */}
        <div style={{ ...S.glass, overflow:'hidden', display:'flex', flexDirection:'column' }}>
          <div style={{ padding:'16px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}><h2 style={{ fontSize:'15px', fontWeight:600, margin:0 }}>📚 公式库</h2></div>
          <div style={{ display:'flex', gap:'4px', padding:'10px 12px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
            {Object.keys(formulaLibrary).map(cat => <button key={cat} onClick={() => { setCurrentCategory(cat); setCurrentFormula(null); setUserMoves([]); }} style={S.btn(currentCategory===cat)}>{cat}</button>)}
          </div>
          <div style={{ display:'flex', gap:'4px', padding:'8px 12px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
            {['all','beginner','intermediate','advanced'].map(d => <button key={d} onClick={() => setDifficulty(d)} style={{ ...S.btnSm, background:difficulty===d?'rgba(255,255,255,0.1)':'transparent', color:difficulty===d?'#e2e8f0':'#64748b' }}>{d==='all'?'全部':diffMeta(d).label}</button>)}
          </div>
          <div style={{ flex:1, overflow:'auto', padding:'6px 8px' }}>
            {formulas.map(f => { const dm = diffMeta(f.difficulty); return (
              <div key={f.id} onClick={() => selectFormula(f.id)} style={{ padding:'10px 12px', marginBottom:'2px', borderRadius:'10px', cursor:'pointer', transition:'all 0.15s', background:currentFormula?.id===f.id?'rgba(6,182,212,0.1)':'transparent', border:currentFormula?.id===f.id?'1px solid rgba(6,182,212,0.3)':'1px solid transparent' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'4px' }}>
                  <span style={{ fontSize:'12px', fontWeight:600, color:'#22d3ee' }}>{f.id}</span>
                  {f.difficulty && <span style={{ fontSize:'10px', padding:'2px 6px', borderRadius:'4px', background:dm.bg, color:dm.color }}>{dm.label}</span>}
                </div>
                <div style={{ ...S.mono, fontSize:'13px', color:'#fbbf24', lineHeight:1.6 }}>{f.formula}</div>
                <div style={{ fontSize:'11px', color:'#64748b', marginTop:'2px' }}>{f.name} · {f.description}</div>
              </div>
            ); })}
            {formulas.length===0 && <div style={{ textAlign:'center', color:'#475569', padding:'32px 0', fontSize:'13px' }}>该难度暂无公式</div>}
          </div>
        </div>

        {/* Center: 3D + Manual */}
        <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
          <div style={S.glass}>
            <div style={{ padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize:'13px', color:'#94a3b8' }}>3D 魔方预览</span>
              <div style={{ display:'flex', gap:'4px' }}>
                {['U','D','R','L','F','B'].map(face => <button key={face} onClick={() => { const m:Record<string,[number,number]>={U:[0,90],D:[0,-90],R:[90,0],L:[-90,0],F:[0,0],B:[180,0]}; const [dx,dy]=m[face]; setCubeRotX(p=>p+dx*0.3); setCubeRotY(p=>p+dy*0.3); }} style={{ ...S.btnSm, width:'28px', height:'28px', padding:0, display:'flex', alignItems:'center', justifyContent:'center', ...S.mono }}>{face}</button>)}
              </div>
            </div>
            <div style={{ height:'300px', cursor:'grab', userSelect:'none' }} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
              <Cube3D rotationX={cubeRotX} rotationY={cubeRotY} />
            </div>
            <div style={{ padding:'0 16px 8px', textAlign:'center' }}><p style={{ fontSize:'11px', color:'#334155', margin:0 }}>拖拽旋转 · 点击面按钮切换视角</p></div>
          </div>
          <div style={{ ...S.glass, padding:'16px' }}>
            <h3 style={{ fontSize:'13px', fontWeight:600, color:'#94a3b8', margin:'0 0 8px' }}>🎮 手动录入</h3>
            <p style={{ fontSize:'11px', color:'#475569', margin:'0 0 12px' }}>{isConnected ? '已连接，转动魔方自动录入' : '手动点击按钮录入操作'}</p>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:'6px' }}>
              {allMoves.map(move => <button key={move} onClick={() => handleCubeMove(move)} disabled={!isPracticing && !isConnected} style={{ ...S.mono, padding:'10px 0', fontSize:'13px', fontWeight:600, borderRadius:'8px', border:'none', cursor:(!isPracticing&&!isConnected)?'not-allowed':'pointer', opacity:(!isPracticing&&!isConnected)?0.3:1, background:'rgba(255,255,255,0.06)', color:'#e2e8f0', transition:'all 0.1s' }}>{move}</button>)}
            </div>
          </div>
        </div>

        {/* Right: Practice */}
        <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
          <div style={{ ...S.glass, padding:'14px 16px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
              <span style={{ width:'10px', height:'10px', borderRadius:'50%', background:isConnected?'#4ade80':isConnecting?'#fbbf24':'#475569', animation:(isConnected||isConnecting)?'pulse 2s infinite':'none' }} />
              <span style={{ fontSize:'13px', color:'#94a3b8' }}>{connectionStatus}</span>
            </div>
            <button onClick={connectCube} disabled={isConnecting} style={{ padding:'8px 20px', fontSize:'13px', fontWeight:600, borderRadius:'10px', border:'none', cursor:isConnecting?'wait':'pointer', background:isConnecting?'rgba(107,114,128,0.3)':'linear-gradient(135deg, #06b6d4, #3b82f6)', color:'#fff', transition:'all 0.15s' }}>
              {isConnecting ? '搜索中...' : isConnected ? '已连接' : '🔗 连接魔方'}
            </button>
          </div>

          <div style={{ ...S.glass, padding:'20px' }}>
            <h2 style={{ fontSize:'16px', fontWeight:600, margin:'0 0 16px' }}>🎯 练习模式</h2>
            {currentFormula ? (<>
              <div style={{ ...S.card, padding:'14px', marginBottom:'16px' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'6px' }}>
                  <span style={{ fontSize:'13px', fontWeight:600, color:'#22d3ee' }}>{currentFormula.id}: {currentFormula.name}</span>
                  {currentFormula.difficulty && (() => { const dm = diffMeta(currentFormula.difficulty); return <span style={{ fontSize:'10px', padding:'2px 8px', borderRadius:'10px', background:dm.bg, color:dm.color }}>{dm.label}</span>; })()}
                </div>
                <div style={{ ...S.mono, fontSize:'18px', color:'#fbbf24', letterSpacing:'1.5px', lineHeight:1.8 }}>{currentFormula.formula}</div>
                <div style={{ fontSize:'11px', color:'#64748b', marginTop:'6px' }}>{currentFormula.description}</div>
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:'5px', marginBottom:'14px' }}>
                {currentFormula.formula.split(' ').map((move,i) => { const isDone=i<userMoves.length; const isW=wrongMoves.has(i); const isC=i===highlightedStep&&isPracticing; return (
                  <span key={i} style={{ ...S.mono, display:'inline-flex', alignItems:'center', justifyContent:'center', width:'40px', height:'40px', fontSize:'13px', fontWeight:700, borderRadius:'8px', transition:'all 0.2s', background:isC?'#06b6d4':isDone&&!isW?'rgba(74,222,128,0.7)':isW?'rgba(248,113,113,0.7)':'rgba(255,255,255,0.06)', color:isC||isDone?'#fff':'#94a3b8', boxShadow:isC?'0 0 12px rgba(6,182,212,0.4)':'none', transform:isC?'scale(1.1)':'scale(1)' }}>{move}</span>
                ); })}
              </div>
              <div style={{ width:'100%', height:'6px', background:'rgba(255,255,255,0.06)', borderRadius:'3px', marginBottom:'16px', overflow:'hidden' }}>
                <div style={{ height:'100%', background:'linear-gradient(90deg,#06b6d4,#4ade80)', borderRadius:'3px', transition:'width 0.3s', width:`${progress}%` }} />
              </div>
            </>) : <div style={{ textAlign:'center', padding:'40px 0', color:'#475569' }}><div style={{ fontSize:'36px', marginBottom:'8px' }}>👆</div><p style={{ fontSize:'13px', margin:0 }}>选择公式开始练习</p></div>}
            <div style={{ display:'flex', gap:'10px' }}>
              <button onClick={startPractice} disabled={!currentFormula||isPracticing} style={{ flex:1, padding:'12px', fontSize:'14px', fontWeight:600, borderRadius:'12px', border:'none', cursor:(!currentFormula||isPracticing)?'not-allowed':'pointer', opacity:(!currentFormula||isPracticing)?0.4:1, background:'linear-gradient(135deg,#06b6d4,#3b82f6)', color:'#fff' }}>{isPracticing?'练习中...':'▶ 开始练习'}</button>
              <button onClick={resetPractice} style={{ padding:'12px 20px', fontSize:'14px', fontWeight:600, borderRadius:'12px', border:'1px solid rgba(255,255,255,0.08)', background:'rgba(255,255,255,0.04)', color:'#94a3b8', cursor:'pointer' }}>↺ 重置</button>
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'10px' }}>
            {[{l:'正确',v:stats.correct,c:'#22d3ee'},{l:'错误',v:stats.wrong,c:'#f87171'},{l:'用时',v:`${elapsedTime}s`,c:'#fbbf24'},{l:'连击',v:stats.streak,c:'#4ade80'}].map(({l,v,c}) => (
              <div key={l} style={{ ...S.glass, padding:'12px', textAlign:'center' }}><div style={{ fontSize:'22px', fontWeight:700, color:c }}>{v}</div><div style={{ fontSize:'11px', color:'#64748b', marginTop:'2px' }}>{l}</div></div>
            ))}
          </div>

          <div style={{ ...S.glass, overflow:'hidden', flex:1, minHeight:0 }}>
            <div style={{ padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}><h3 style={{ fontSize:'13px', fontWeight:600, color:'#94a3b8', margin:0 }}>📋 操作日志</h3></div>
            <div style={{ padding:'8px 12px', maxHeight:'160px', overflowY:'auto' }}>
              {logs.length===0 ? <div style={{ textAlign:'center', color:'#334155', padding:'16px 0', fontSize:'12px' }}>暂无日志</div> :
                logs.map(log => <div key={log.id} style={{ ...S.mono, fontSize:'11px', padding:'2px 0', color:log.type==='success'?'#4ade80':log.type==='error'?'#f87171':log.type==='warning'?'#fbbf24':'#64748b' }}><span style={{ color:'#334155' }}>[{log.time}]</span> {log.message}</div>)
              }
            </div>
          </div>
        </div>
      </main>

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}*{box-sizing:border-box}body{margin:0}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:2px}button:hover{filter:brightness(1.2)}button:active{transform:scale(.97)}`}</style>
    </div>
  );
}
