'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import aesjs from 'aes-js';

// ── Types ──
interface Formula { id: string; name: string; formula: string; description: string; difficulty?: 'beginner' | 'intermediate' | 'advanced'; }
interface Stats { correct: number; wrong: number; streak: number; bestStreak: number; }
interface PracticeSession { id: number; formula: string; time: number; moves: number; correct: number; date: string; }
interface LogEntry { id: number; time: string; message: string; type: 'info' | 'success' | 'error' | 'warning'; }
interface RecentMove { move: string; type: 'matched' | 'valid' | 'wrong'; }

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

// ── Scramble Generator (WCA-style) ──
function generateScramble(length: number = 20): string {
  const moves = ["U", "D", "R", "L", "F", "B"];
  const modifiers = ["", "'", "2"];
  const scramble: string[] = [];
  let lastFace = "";
  let secondLastFace = "";
  
  for (let i = 0; i < length; i++) {
    let face: string;
    do {
      face = moves[Math.floor(Math.random() * moves.length)];
    } while (face === lastFace || (face === secondLastFace && isOpposite(face, lastFace)));
    
    const mod = modifiers[Math.floor(Math.random() * modifiers.length)];
    scramble.push(face + mod);
    secondLastFace = lastFace;
    lastFace = face;
  }
  return scramble.join(" ");
}

function isOpposite(a: string, b: string): boolean {
  const pairs: Record<string, string> = { U: "D", D: "U", R: "L", L: "R", F: "B", B: "F" };
  return pairs[a] === b;
}


// ── Export/Import Data ──
function exportData(history: PracticeSession[], solves: number[]): string {
  return JSON.stringify({ history, solves, exportDate: new Date().toISOString() }, null, 2);
}

function importData(json: string): { history: PracticeSession[]; solves: number[] } | null {
  try {
    const data = JSON.parse(json);
    return { history: data.history || [], solves: data.solves || [] };
  } catch { return null; }
}

const formulaLibrary: Record<string, Formula[]> = {
  OLL: [
    // Dot cases (1-2)
    { id: 'OLL-1', name: 'All Edges Flipped', formula: "R U2 R2 F R F' U2 R' F R F'", description: 'OLL 1', difficulty: 'advanced' },
    { id: 'OLL-2', name: 'Dot + Adjacent', formula: "F R U R' U' F' f R U R' U' f'", description: 'OLL 2', difficulty: 'advanced' },
    // L-shape cases (3-6)
    { id: 'OLL-3', name: 'L-Shape 1', formula: "f R U R' U' f' U' F R U R' U' F'", description: 'OLL 3', difficulty: 'advanced' },
    { id: 'OLL-4', name: 'L-Shape 2', formula: "f R U R' U' f' U F R U R' U' F'", description: 'OLL 4', difficulty: 'advanced' },
    { id: 'OLL-5', name: 'L-Shape 3', formula: "r' U2 R U R' U r", description: 'OLL 5 (Square)', difficulty: 'advanced' },
    { id: 'OLL-6', name: 'L-Shape 4', formula: "r U2 R' U' R U' r'", description: 'OLL 6 (Square)', difficulty: 'advanced' },
    // Line cases (7-8)
    { id: 'OLL-7', name: 'Line + Corners', formula: "r U R' U R U2 r'", description: 'OLL 7', difficulty: 'advanced' },
    { id: 'OLL-8', name: 'Line + Corners 2', formula: "r' U' R U' R' U2 r", description: 'OLL 8', difficulty: 'advanced' },
    // Cross cases (9-16)
    { id: 'OLL-9', name: 'Knight Move 1', formula: "R U R' U' R' F R2 U R' U' F'", description: 'OLL 9', difficulty: 'advanced' },
    { id: 'OLL-10', name: 'Knight Move 2', formula: "R U R' U R' F R F' R U2 R'", description: 'OLL 10', difficulty: 'advanced' },
    { id: 'OLL-11', name: 'Knight Move 3', formula: "r U R' U R U2 r2 U' R U' R' U2 r", description: 'OLL 11', difficulty: 'advanced' },
    { id: 'OLL-12', name: 'Knight Move 4', formula: "F R U R' U' F' U F R U R' U' F'", description: 'OLL 12', difficulty: 'advanced' },
    { id: 'OLL-13', name: 'Antisune 1', formula: "r U' r' U' r U r' F' U F", description: 'OLL 13', difficulty: 'advanced' },
    { id: 'OLL-14', name: 'Antisune 2', formula: "R' F R U R' F' R F U' F'", description: 'OLL 14', difficulty: 'advanced' },
    { id: 'OLL-15', name: 'Antisune 3', formula: "r' U' r R' U' R U r' U r", description: 'OLL 15', difficulty: 'advanced' },
    { id: 'OLL-16', name: 'Antisune 4', formula: "r U r' R U R' U' r U' r'", description: 'OLL 16', difficulty: 'advanced' },
    // All Corners Oriented (17-20)
    { id: 'OLL-17', name: 'Chameleon 1', formula: "R U R' U R' F R F' U2 R' F R F'", description: 'OLL 17', difficulty: 'advanced' },
    { id: 'OLL-18', name: 'Chameleon 2', formula: "r U R' U R U2 r2 U' R U' R' U2 r", description: 'OLL 18', difficulty: 'advanced' },
    { id: 'OLL-19', name: 'Chameleon 3', formula: "R U2 R2 F R F' U2 M' U R U' r'", description: 'OLL 19', difficulty: 'advanced' },
    { id: 'OLL-20', name: 'Chameleon 4', formula: "M U R U R' U' M' R' F R F'", description: 'OLL 20', difficulty: 'advanced' },
    // Dot + Cross (21-27)
    { id: 'OLL-21', name: 'H-Pattern', formula: "R U2 R' U' R U R' U' R U' R'", description: 'OLL 21', difficulty: 'advanced' },
    { id: 'OLL-22', name: 'Pi-Pattern', formula: "R U2 R2 U' R2 U' R2 U2 R", description: 'OLL 22', difficulty: 'advanced' },
    { id: 'OLL-23', name: 'Headlights', formula: "R2 D R' U2 R D' R' U2 R'", description: 'OLL 23', difficulty: 'advanced' },
    { id: 'OLL-24', name: 'Chameleon', formula: "r U R' U' r' F R F'", description: 'OLL 24', difficulty: 'advanced' },
    { id: 'OLL-25', name: 'Bowtie', formula: "F' r U R' U' r' F R", description: 'OLL 25', difficulty: 'advanced' },
    { id: 'OLL-26', name: 'Antisune', formula: "R U2 R' U' R U' R'", description: 'OLL 26', difficulty: 'beginner' },
    { id: 'OLL-27', name: 'Sune', formula: "R U R' U R U2 R'", description: 'OLL 27', difficulty: 'beginner' },
    // Fish shapes (28-35)
    { id: 'OLL-28', name: 'Fish 1', formula: "r U R' U' r' R U R U' R'", description: 'OLL 28', difficulty: 'advanced' },
    { id: 'OLL-29', name: 'Fish 2', formula: "R U R' U' R U' R' F' U' F R U R'", description: 'OLL 29', difficulty: 'advanced' },
    { id: 'OLL-30', name: 'Fish 3', formula: "F R' F R2 U' R' U' R U R' F2", description: 'OLL 30', difficulty: 'advanced' },
    { id: 'OLL-31', name: 'Fish 4', formula: "R' U' F U R U' R' F' R", description: 'OLL 31', difficulty: 'advanced' },
    { id: 'OLL-32', name: 'Fish 5', formula: "S R U R' U' R' F R f'", description: 'OLL 32', difficulty: 'advanced' },
    { id: 'OLL-33', name: 'Fish 6', formula: "R U R' U' R' F R F'", description: 'OLL 33', difficulty: 'intermediate' },
    { id: 'OLL-34', name: 'Fish 7', formula: "R U R2 U' R' F R U R U' F'", description: 'OLL 34', difficulty: 'advanced' },
    { id: 'OLL-35', name: 'Fish 8', formula: "R U2 R2 F R F' R U2 R'", description: 'OLL 35', difficulty: 'advanced' },
    // Small L-shapes (36-43)
    { id: 'OLL-36', name: 'L-Shape A', formula: "L' U' L U' L' U L U L F' L' F", description: 'OLL 36', difficulty: 'advanced' },
    { id: 'OLL-37', name: 'L-Shape B', formula: "F R U' R' U' R U R' F'", description: 'OLL 37', difficulty: 'advanced' },
    { id: 'OLL-38', name: 'L-Shape C', formula: "R U R' U R U' R' U' R' F R F'", description: 'OLL 38', difficulty: 'advanced' },
    { id: 'OLL-39', name: 'L-Shape D', formula: "L F' L' U' L U F U' L'", description: 'OLL 39', difficulty: 'advanced' },
    { id: 'OLL-40', name: 'L-Shape E', formula: "R' F R U R' U' F' U R", description: 'OLL 40', difficulty: 'advanced' },
    { id: 'OLL-41', name: 'L-Shape F', formula: "R U R' U R U2 R' F R U R' U' F'", description: 'OLL 41', difficulty: 'advanced' },
    { id: 'OLL-42', name: 'L-Shape G', formula: "R' U' R U' R' U2 R F R U R' U' F'", description: 'OLL 42', difficulty: 'advanced' },
    { id: 'OLL-43', name: 'L-Shape H', formula: "F' U' L' U L F", description: 'OLL 43', difficulty: 'advanced' },
    // Lightning bolts (44-47)
    { id: 'OLL-44', name: 'Lightning 1', formula: "F U R U' R' F'", description: 'OLL 44', difficulty: 'beginner' },
    { id: 'OLL-45', name: 'Lightning 2', formula: "F R U R' U' F'", description: 'OLL 45', difficulty: 'beginner' },
    { id: 'OLL-46', name: 'Lightning 3', formula: "R' U' R' F R F' U R", description: 'OLL 46', difficulty: 'advanced' },
    { id: 'OLL-47', name: 'Lightning 4', formula: "R' U' R' F R F' R' F R F' U R", description: 'OLL 47', difficulty: 'advanced' },
    // T-shapes (48-51)
    { id: 'OLL-48', name: 'T-Shape 1', formula: "F R U R' U' F'", description: 'OLL 48', difficulty: 'beginner' },
    { id: 'OLL-49', name: 'T-Shape 2', formula: "R B' R2 F R2 B R2 F' R", description: 'OLL 49', difficulty: 'advanced' },
    { id: 'OLL-50', name: 'T-Shape 3', formula: "r' U r U r' U' r U r' U' M' U r", description: 'OLL 50', difficulty: 'advanced' },
    { id: 'OLL-51', name: 'T-Shape 4', formula: "F U R U' R' U R U' R' F'", description: 'OLL 51', difficulty: 'advanced' },
    // C-shapes (52-55)
    { id: 'OLL-52', name: 'C-Shape 1', formula: "R U R' U' M' U R U' r'", description: 'OLL 52', difficulty: 'advanced' },
    { id: 'OLL-53', name: 'C-Shape 2', formula: "r' U' R U' R' U R U' R' U2 r", description: 'OLL 53', difficulty: 'advanced' },
    { id: 'OLL-54', name: 'C-Shape 3', formula: "r U R' U R U' R' U R U2 r'", description: 'OLL 54', difficulty: 'advanced' },
    { id: 'OLL-55', name: 'C-Shape 4', formula: "R U2 R2 U' R U' R' U2 F R F'", description: 'OLL 55', difficulty: 'advanced' },
    // W-shapes (56-57)
    { id: 'OLL-56', name: 'W-Shape 1', formula: "r U r' U R U' R' U R U' R' r U' r'", description: 'OLL 56', difficulty: 'advanced' },
    { id: 'OLL-57', name: 'W-Shape 2', formula: "R U R' U' M' U R U' r'", description: 'OLL 57', difficulty: 'advanced' },
  ],
  PLL: [
    // Edge Cycles
    { id: 'PLL-Ua', name: 'Ua Permutation', formula: "M2 U M U2 M' U M2", description: '3-edge cycle (CCW)', difficulty: 'intermediate' },
    { id: 'PLL-Ub', name: 'Ub Permutation', formula: "M2 U' M U2 M' U' M2", description: '3-edge cycle (CW)', difficulty: 'intermediate' },
    { id: 'PLL-H', name: 'H Permutation', formula: "M2 U M2 U2 M2 U M2", description: 'Opposite edge swap', difficulty: 'beginner' },
    { id: 'PLL-Z', name: 'Z Permutation', formula: "M' U M2 U M2 U M' U2 M2", description: 'Adjacent edge swap', difficulty: 'intermediate' },
    // Corner Cycles
    { id: 'PLL-Aa', name: 'Aa Permutation', formula: "x R' U R' D2 R U' R' D2 R2 x'", description: '3-corner cycle (CCW)', difficulty: 'intermediate' },
    { id: 'PLL-Ab', name: 'Ab Permutation', formula: "x R2 D2 R U R' D2 R U' R x'", description: '3-corner cycle (CW)', difficulty: 'intermediate' },
    { id: 'PLL-E', name: 'E Permutation', formula: "x' R U' R' D R U R' D' R U R' D R U' R' D' x", description: '2-corner swap (diagonal)', difficulty: 'advanced' },
    // Double Swaps
    { id: 'PLL-T', name: 'T Permutation', formula: "R U R' U' R' F R2 U' R' U' R U R' F'", description: 'Adjacent corner+edge swap', difficulty: 'intermediate' },
    { id: 'PLL-F', name: 'F Permutation', formula: "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R", description: 'Adjacent corner+edge swap', difficulty: 'advanced' },
    { id: 'PLL-V', name: 'V Permutation', formula: "R' U R' U' y R' F' R2 U' R' U R' F R F", description: 'Diagonal corner+edge swap', difficulty: 'advanced' },
    { id: 'PLL-Y', name: 'Y Permutation', formula: "F R U' R' U' R U R' F' R U R' U' R' F R F'", description: 'Diagonal corner+edge swap', difficulty: 'advanced' },
    { id: 'PLL-Ja', name: 'Ja Permutation', formula: "x R2 F R F' R U2 r' U r U2 x'", description: 'Adjacent corner+edge swap', difficulty: 'advanced' },
    { id: 'PLL-Jb', name: 'Jb Permutation', formula: "R U R' F' R U R' U' R' F R2 U' R'", description: 'Adjacent corner+edge swap', difficulty: 'intermediate' },
    { id: 'PLL-Ra', name: 'Ra Permutation', formula: "R U' R' U' R U R D R' U' R D' R' U2 R'", description: 'Adjacent corner+edge swap', difficulty: 'advanced' },
    { id: 'PLL-Rb', name: 'Rb Permutation', formula: "R' U2 R U2 R' F R U R' U' R' F' R2", description: 'Adjacent corner+edge swap', difficulty: 'advanced' },
    // G Permutations
    { id: 'PLL-Ga', name: 'Ga Permutation', formula: "R2 U R' U R' U' R U' R2 U' D R' U R D'", description: '4-corner+edge cycle', difficulty: 'advanced' },
    { id: 'PLL-Gb', name: 'Gb Permutation', formula: "R' U' R U D' R2 U R' U R U' R U' R2 D", description: '4-corner+edge cycle', difficulty: 'advanced' },
    { id: 'PLL-Gc', name: 'Gc Permutation', formula: "R2 U' R U' R U R' U R2 U D' R U' R' D", description: '4-corner+edge cycle', difficulty: 'advanced' },
    { id: 'PLL-Gd', name: 'Gd Permutation', formula: "R U R' U' D R2 U' R U' R' U R' U R2 D'", description: '4-corner+edge cycle', difficulty: 'advanced' },
    // N Permutations
    { id: 'PLL-Na', name: 'Na Permutation', formula: "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'", description: 'Double adjacent swap', difficulty: 'advanced' },
    { id: 'PLL-Nb', name: 'Nb Permutation', formula: "R' U R U' R' F' U' F R U R' F R' F' R U' R", description: 'Double adjacent swap', difficulty: 'advanced' },
  ],
  F2L: [
    // Basic cases - corner white on bottom
    { id: 'F2L-1', name: 'Basic Insert', formula: "U R U' R'", description: 'Corner in slot, edge on top', difficulty: 'beginner' },
    { id: 'F2L-2', name: 'Basic Insert 2', formula: "U' F' U F", description: 'Corner in slot, edge on top (mirror)', difficulty: 'beginner' },
    { id: 'F2L-3', name: 'Already Paired', formula: "R U' R'", description: 'Pair already formed', difficulty: 'beginner' },
    { id: 'F2L-4', name: 'Already Paired 2', formula: "F' U F", description: 'Pair already formed (mirror)', difficulty: 'beginner' },
    // Corner white on top
    { id: 'F2L-5', name: 'White Up 1', formula: "R U2 R' U' R U R'", description: 'Corner white facing up', difficulty: 'intermediate' },
    { id: 'F2L-6', name: 'White Up 2', formula: "F' U2 F U F' U' F", description: 'Corner white facing up (mirror)', difficulty: 'intermediate' },
    { id: 'F2L-7', name: 'White Up 3', formula: "U R U2 R' U R U' R'", description: 'Corner white facing up, edge adjacent', difficulty: 'intermediate' },
    { id: 'F2L-8', name: 'White Up 4', formula: "U' F' U2 F U' F' U F", description: 'Corner white facing up, edge adjacent (mirror)', difficulty: 'intermediate' },
    // Corner in slot, edge on top
    { id: 'F2L-9', name: 'Edge Top 1', formula: "U' R U R' U2 R U' R'", description: 'Corner in slot wrong, edge on top', difficulty: 'intermediate' },
    { id: 'F2L-10', name: 'Edge Top 2', formula: "U F' U' F U2 F' U F", description: 'Corner in slot wrong, edge on top (mirror)', difficulty: 'intermediate' },
    { id: 'F2L-11', name: 'Edge Top 3', formula: "U' R U2 R' U2 R U' R'", description: 'Edge and corner on top, different slots', difficulty: 'intermediate' },
    { id: 'F2L-12', name: 'Edge Top 4', formula: "U F' U2 F U2 F' U F", description: 'Edge and corner on top (mirror)', difficulty: 'intermediate' },
    // Corner white on side
    { id: 'F2L-13', name: 'White Side 1', formula: "R U' R' U R U' R'", description: 'Corner white facing right', difficulty: 'intermediate' },
    { id: 'F2L-14', name: 'White Side 2', formula: "F' U F U' F' U F", description: 'Corner white facing left', difficulty: 'intermediate' },
    { id: 'F2L-15', name: 'White Side 3', formula: "R U R' U' R U R'", description: 'Corner white facing front', difficulty: 'intermediate' },
    { id: 'F2L-16', name: 'White Side 4', formula: "F' U' F U F' U' F", description: 'Corner white facing back', difficulty: 'intermediate' },
    // Advanced cases
    { id: 'F2L-17', name: 'Stuck 1', formula: "R U2 R' U' R U2 R' U' R U R'", description: 'Edge flipped in slot', difficulty: 'advanced' },
    { id: 'F2L-18', name: 'Stuck 2', formula: "F' U2 F U F' U2 F U F' U' F", description: 'Edge flipped in slot (mirror)', difficulty: 'advanced' },
    { id: 'F2L-19', name: 'Stuck 3', formula: "U R U' R' U' F' U F", description: 'Both in slot, wrong orientation', difficulty: 'advanced' },
    { id: 'F2L-20', name: 'Stuck 4', formula: "U' F' U F U R U' R'", description: 'Both in slot, wrong orientation (mirror)', difficulty: 'advanced' },
    { id: 'F2L-21', name: 'Pair Separated 1', formula: "R U' R' U2 F' U' F", description: 'Pair separated across slot', difficulty: 'advanced' },
    { id: 'F2L-22', name: 'Pair Separated 2', formula: "F' U F U2 R U R'", description: 'Pair separated across slot (mirror)', difficulty: 'advanced' },
    { id: 'F2L-23', name: 'Edge in Slot 1', formula: "R U R' U' R U R' U' R U R'", description: 'Edge in wrong slot', difficulty: 'advanced' },
    { id: 'F2L-24', name: 'Edge in Slot 2', formula: "F' U' F U F' U' F U F' U' F", description: 'Edge in wrong slot (mirror)', difficulty: 'advanced' },
    { id: 'F2L-25', name: 'Corner Top Edge Slot', formula: "R U' R' U R U' R' U2 R U' R'", description: 'Corner on top, edge in slot', difficulty: 'advanced' },
    { id: 'F2L-26', name: 'Corner Top Edge Slot 2', formula: "F' U F U' F' U F U2 F' U F", description: 'Corner on top, edge in slot (mirror)', difficulty: 'advanced' },
    { id: 'F2L-27', name: 'Both Wrong 1', formula: "R U' R' U R U2 R' U R U' R'", description: 'Both pieces wrong position', difficulty: 'advanced' },
    { id: 'F2L-28', name: 'Both Wrong 2', formula: "F' U F U' F' U2 F U' F' U F", description: 'Both pieces wrong position (mirror)', difficulty: 'advanced' },
    { id: 'F2L-29', name: 'Triple Sexy', formula: "R U R' U' R U R' U' R U R'", description: 'Triple sexy move insert', difficulty: 'advanced' },
    { id: 'F2L-30', name: 'Triple Anti-Sexy', formula: "F' U' F U F' U' F U F' U' F", description: 'Triple anti-sexy insert', difficulty: 'advanced' },
    { id: 'F2L-31', name: 'Advanced 1', formula: "R U' R' U F' U' F", description: 'Quick insert variant', difficulty: 'advanced' },
    { id: 'F2L-32', name: 'Advanced 2', formula: "F' U F U' R U R'", description: 'Quick insert variant (mirror)', difficulty: 'advanced' },
    { id: 'F2L-33', name: 'Advanced 3', formula: "U' R U R' U R U R'", description: 'Setup then insert', difficulty: 'advanced' },
    { id: 'F2L-34', name: 'Advanced 4', formula: "U F' U' F U' F' U' F", description: 'Setup then insert (mirror)', difficulty: 'advanced' },
    { id: 'F2L-35', name: 'Advanced 5', formula: "R U' R' U R U' R' U2 R U' R'", description: 'Extended insert', difficulty: 'advanced' },
    { id: 'F2L-36', name: 'Advanced 6', formula: "F' U F U' F' U F U2 F' U F", description: 'Extended insert (mirror)', difficulty: 'advanced' },
    { id: 'F2L-37', name: 'Edge Case 1', formula: "R U R' U2 R U' R' U R U R'", description: 'Edge special case', difficulty: 'advanced' },
    { id: 'F2L-38', name: 'Edge Case 2', formula: "F' U' F U2 F' U F U' F' U' F", description: 'Edge special case (mirror)', difficulty: 'advanced' },
    { id: 'F2L-39', name: 'Corner Case 1', formula: "R U' R' U F' U2 F U' F' U2 F", description: 'Corner special case', difficulty: 'advanced' },
    { id: 'F2L-40', name: 'Corner Case 2', formula: "F' U F U' R U2 R' U R U2 R'", description: 'Corner special case (mirror)', difficulty: 'advanced' },
    { id: 'F2L-41', name: 'Last Resort', formula: "R U R' U' R U R' U' R U R' U' R U R'", description: 'When nothing else works', difficulty: 'advanced' },
  ],
};// ── 3D Cube Component (responsive, colors from real cube) ──
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
    <div style={{ perspective: `${size * 5}px`, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
          const tz = z * (cubieSize + gap);

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

// ── Helper: color hex → Chinese name ──
function colorName(hex: string): string {
  const map: Record<string, string> = {
    '#FFFFFF': '白', '#FFD500': '黄', '#B71234': '红',
    '#FF6600': '橙', '#009B48': '绿', '#0046AD': '蓝',
  };
  return map[hex] || '?';
}

// ── Smart Solve Stage Analyzer ──
// Face order: U(0-8), R(9-17), F(18-26), D(27-35), L(36-44), B(45-53)
// Face layout: 0 1 2 / 3 4 5 / 6 7 8
interface SolveStageResult {
  stage: string;
  stageIcon: string;
  description: string;
  suggestedFormula: string;
  formulaName: string;
  explanation: string;
}

function analyzeSolveStage(facelets: string[]): SolveStageResult {
  const U = facelets.slice(0, 9);
  const R = facelets.slice(9, 18);
  const F = facelets.slice(18, 27);
  const D = facelets.slice(27, 36);
  const L = facelets.slice(36, 45);
  const B = facelets.slice(45, 54);

  const isFaceSolid = (face: string[]) => face.every(c => c === face[4]);

  // Check if fully solved
  if ([U, R, F, D, L, B].every(isFaceSolid)) {
    return { stage: '已还原', stageIcon: '🎉', description: '魔方已完全还原！', suggestedFormula: '', formulaName: '', explanation: '恭喜！所有面已还原完成' };
  }

  // Reference colors
  const dColor = D[4]; // bottom center
  const uColor = U[4]; // top center (last layer)

  // ── Check bottom cross ──
  // D edges: D[1](back), D[3](left), D[5](right), D[7](front)
  // Adjacent side: B[7], L[7], R[7], F[7]
  const dEdgesOk = D[1] === dColor && D[3] === dColor && D[5] === dColor && D[7] === dColor;
  const sideEdgesOk = F[7] === F[4] && R[7] === R[4] && B[7] === B[4] && L[7] === L[4];
  const bottomCrossComplete = dEdgesOk && sideEdgesOk;

  if (!bottomCrossComplete) {
    return {
      stage: '底层十字', stageIcon: '➕',
      description: `将${colorName(dColor)}色十字拼在底层`,
      suggestedFormula: "F2 U' L R' F2 L' R U' F2", formulaName: '底层十字引导', explanation: '将白色棱块逐一对齐到底面十字位置，先找到白色棱块转到顶层再对齐'
    };
  }

  // ── Check F2L ──
  // D face all dColor + bottom two rows (indices 3-8) of F, R, B, L match their centers
  const f2lSidesOk =
    F[3] === F[4] && F[5] === F[4] && F[6] === F[4] && F[7] === F[4] && F[8] === F[4] &&
    R[3] === R[4] && R[5] === R[4] && R[6] === R[4] && R[7] === R[4] && R[8] === R[4] &&
    B[3] === B[4] && B[5] === B[4] && B[6] === B[4] && B[7] === B[4] && B[8] === B[4] &&
    L[3] === L[4] && L[5] === L[4] && L[6] === L[4] && L[7] === L[4] && L[8] === L[4];
  const f2lComplete = isFaceSolid(D) && f2lSidesOk;

  if (!f2lComplete) {
    return {
      stage: 'F2L', stageIcon: '🧩',
      description: '完成前两层角棱配对',
      suggestedFormula: "U R U' R'", formulaName: 'F2L基础公式',
      explanation: '在顶层找到角棱配对，用U R U\' R\'插入对应槽位。转动魔方观察顶层角块和棱块的位置关系'
    };
  }

  // ── Check OLL ──
  const ollComplete = isFaceSolid(U);

  if (!ollComplete) {
    // Count facelets on U that match uColor
    const uMatch = U.filter(c => c === uColor).length;

    // Edges of U: indices 1, 3, 5, 7
    const uEdgesMatch = [1, 3, 5, 7].filter(i => U[i] === uColor);
    // Corners of U: indices 0, 2, 6, 8
    const uCornersMatch = [0, 2, 6, 8].filter(i => U[i] === uColor);

    if (uMatch <= 1) {
      // Dot case (only center or center + 0 edges)
      return {
        stage: 'OLL', stageIcon: '🟡',
        description: '顶面点状 (dot)',
        suggestedFormula: "F R U R' U' F'", formulaName: 'OLL 点→十字',
        explanation: '顶面只有中心黄色，先用公式做出十字'
      };
    }

    if (uEdgesMatch.length === 2 && uCornersMatch.length === 0) {
      // Check if L-shape or line
      const edgePair = uEdgesMatch.join(',');
      const isLine = (edgePair === '1,7') || (edgePair === '3,5');
      if (isLine) {
        return {
          stage: 'OLL', stageIcon: '🟡',
          description: '顶面横线 (line)',
          suggestedFormula: "F R U R' U' F'", formulaName: 'OLL 线→十字',
          explanation: '两条棱朝上形成直线，转90°后套用十字公式'
        };
      } else {
        return {
          stage: 'OLL', stageIcon: '🟡',
          description: '顶面L形 (L-shape)',
          suggestedFormula: "F U R U' R' F'", formulaName: 'OLL L→十字',
          explanation: '两条棱朝上形成L形，调整方向后做出十字'
        };
      }
    }

    if (uEdgesMatch.length === 4 && uCornersMatch.length === 0) {
      // Cross formed, no corners
      return {
        stage: 'OLL', stageIcon: '🟡',
        description: '顶面十字 (cross)',
        suggestedFormula: "R U R' U R U2 R'", formulaName: 'OLL 鱼形公式',
        explanation: '十字已完成，用鱼形公式翻转角块至全黄'
      };
    }

    if (uEdgesMatch.length === 4 && uCornersMatch.length >= 1) {
      // Cross + some corners → fish or partial
      // Check for fish pattern: exactly 1 corner matching, positioned diagonally
      if (uCornersMatch.length === 1) {
        const c = uCornersMatch[0];
        // Fish: the matching corner and the U[4] form a pattern
        // Determine which fish by checking orientation
        const fishCorner = c;
        // For simplicity, check if it's the "right" fish or "left" fish
        if (fishCorner === 0 || fishCorner === 8) {
          return {
            stage: 'OLL', stageIcon: '🟡',
            description: '顶面正鱼形',
            suggestedFormula: "R U R' U R U2 R'", formulaName: 'OLL 正鱼形',
            explanation: '顶层鱼形，用R U R\' U R U2 R\'将黄色面补全'
          };
        } else {
          return {
            stage: 'OLL', stageIcon: '🟡',
            description: '顶面反鱼形',
            suggestedFormula: "R U2 R' U' R U' R'", formulaName: 'OLL 反鱼形',
            explanation: '顶层反鱼形，用R U2 R\' U\' R U\' R\'将黄色面补全'
          };
        }
      }
      if (uCornersMatch.length === 2) {
        return {
          stage: 'OLL', stageIcon: '🟡',
          description: '顶面十字+部分角块',
          suggestedFormula: "R U2 R' U' R U R' U' R U' R'", formulaName: 'OLL 21号',
          explanation: '十字完成但角块未全黄，使用OLL-21翻转'
        };
      }
      // 3 corners matching → almost done
      return {
        stage: 'OLL', stageIcon: '🟡',
        description: '顶面即将完成',
        suggestedFormula: "R U R' U R U2 R'", formulaName: 'OLL 鱼形公式',
        explanation: '只差一个角块，使用鱼形公式完成OLL'
      };
    }

    // Fallback: some edges match but pattern not recognized
    if (uEdgesMatch.length >= 2) {
      return {
        stage: 'OLL', stageIcon: '🟡',
        description: '顶面部分朝上',
        suggestedFormula: "F R U R' U' F'", formulaName: 'OLL 十字公式',
        explanation: '先将棱块全部翻转朝上，形成十字'
      };
    }

    return {
      stage: 'OLL', stageIcon: '🟡',
      description: '顶面方向未完成',
      suggestedFormula: "F R U R' U' F'", formulaName: 'OLL 十字公式',
      explanation: '顶面颜色未统一，先做十字再翻角'
    };
  }

  // ── Check PLL ──
  // U face is all uColor, check if side faces are solved
  if ([U, R, F, D, L, B].every(isFaceSolid)) {
    return { stage: '已还原', stageIcon: '🎉', description: '魔方已完全还原！', suggestedFormula: '', formulaName: '', explanation: '恭喜！所有面已还原完成' };
  }

  // PLL: U face all same color, check edge and corner positions
  // U edge adjacencies:
  // U[7]-F[1]: front edge → F[1] should equal F[4]
  // U[5]-R[1]: right edge → R[1] should equal R[4]
  // U[1]-B[1]: back edge → B[1] should equal B[4]
  // U[3]-L[1]: left edge → L[1] should equal L[4]
  const edgeCorrect = [
    F[1] === F[4], // front
    R[1] === R[4], // right
    B[1] === B[4], // back
    L[1] === L[4], // left
  ];
  const correctEdgeCount = edgeCorrect.filter(Boolean).length;

  // U corner adjacencies (simplified check):
  // UFR: U[8]-F[2]-R[0] → F[2]===F[4] && R[0]===R[4]
  // UFL: U[6]-F[0]-L[2] → F[0]===F[4] && L[2]===L[4]
  // UBR: U[2]-B[2]-R[2] → B[2]===B[4] && R[2]===R[4]
  // UBL: U[0]-B[0]-L[0] → B[0]===B[4] && L[0]===L[4]
  const cornerCorrect = [
    F[2] === F[4] && R[0] === R[4], // UFR
    F[0] === F[4] && L[2] === L[4], // UFL
    B[2] === B[4] && R[2] === R[4], // UBR
    B[0] === B[4] && L[0] === L[4], // UBL
  ];
  const correctCornerCount = cornerCorrect.filter(Boolean).length;

  if (correctEdgeCount === 4 && correctCornerCount < 4) {
    return {
      stage: 'PLL', stageIcon: '🔄',
      description: '棱块已归位，角块需交换',
      suggestedFormula: "R U R' U' R' F R2 U' R' U' R U R' F'", formulaName: 'PLL T排列',
      explanation: '四条棱位置正确，用T排列交换相邻角块'
    };
  }

  if (correctEdgeCount === 0 && correctCornerCount === 4) {
    return {
      stage: 'PLL', stageIcon: '🔄',
      description: '角块已归位，棱块需对换',
      suggestedFormula: "M2 U M2 U2 M2 U M2", formulaName: 'PLL H排列',
      explanation: '角块正确但棱块互换，使用H排列'
    };
  }

  if (correctEdgeCount === 1 && correctCornerCount === 4) {
    // One edge correct, three need cycling → Ua or Ub
    return {
      stage: 'PLL', stageIcon: '🔄',
      description: '三棱换 (Ua/Ub)',
      suggestedFormula: "R U R' U R' U' R2 U' R' U R' U R", formulaName: 'PLL Ua排列',
      explanation: '三条棱需要循环换位，用Ua排列顺时针旋转'
    };
  }

  if (correctEdgeCount === 0 && correctCornerCount === 0) {
    return {
      stage: 'PLL', stageIcon: '🔄',
      description: '顶层排列混乱',
      suggestedFormula: "R U R' U' R' F R2 U' R' U' R U R' F'", formulaName: 'PLL T排列',
      explanation: '先用T排列归位角块，再处理棱块'
    };
  }

  // Generic PLL
  return {
    stage: 'PLL', stageIcon: '🔄',
    description: `顶层排列 (${correctEdgeCount}棱✓ ${correctCornerCount}角✓)`,
    suggestedFormula: "R U R' U R' U' R2 U' R' U R' U R", formulaName: 'PLL Ua排列',
    explanation: '尝试用三棱换公式调整顶层排列'
  };
}

// ── Formula Detail Card (shared between mobile & desktop) ──
function FormulaDetail({ formula, practicing, moves, wrongs, hlStep, progress, time, recentMoves, onStart, onReset }: {
  formula: Formula; practicing: boolean; moves: string[]; wrongs: Set<number>; hlStep: number;
  progress: number; time: number; recentMoves: RecentMove[]; onStart: () => void; onReset: () => void;
}) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 16, padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: '#1e293b' }}>{formula.id}: {formula.name}</h3>
          <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>{formula.description}</p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {!practicing ? <button onClick={onStart} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer', background: '#06b6d4', color: '#fff' }}>▶ 开始</button> : <button onClick={onReset} style={{ padding: '8px 18px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: '#94a3b8' }}>⏹ 重置</button>}
        </div>
      </div>

      {/* ── Recent Moves Strip ── */}
      {recentMoves.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>最近操作</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {recentMoves.map((rm, i) => (
              <span key={i} style={{
                fontFamily: '"SF Mono", Menlo, monospace', fontSize: 14, fontWeight: 600,
                padding: '4px 10px', borderRadius: 6,
                background: rm.type === 'matched' ? 'rgba(74,222,128,0.2)' : rm.type === 'wrong' ? 'rgba(248,113,113,0.2)' : 'rgba(34,211,238,0.15)',
                color: rm.type === 'matched' ? '#4ade80' : rm.type === 'wrong' ? '#f87171' : '#22d3ee',
                border: `1px solid ${rm.type === 'matched' ? 'rgba(74,222,128,0.3)' : rm.type === 'wrong' ? 'rgba(248,113,113,0.3)' : 'rgba(34,211,238,0.2)'}`,
                opacity: i === 0 ? 1 : Math.max(0.4, 1 - i * 0.12),
              }}>{rm.move}</span>
            ))}
          </div>
        </div>
      )}

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

// ── Smart Guidance Panel ──
function SmartGuidance({ facelets, onAutoStart }: { facelets: string[] | null; onAutoStart?: (formulaStr: string, formulaName: string) => void }) {
  if (!facelets || facelets.length < 54) return null;
  const result = analyzeSolveStage(facelets);
  const stageColors: Record<string, string> = {
    '底层十字': '#22d3ee', 'F2L': '#3b82f6', 'OLL': '#facc15', 'PLL': '#a855f7', '已还原': '#4ade80',
  };
  const stageColor = stageColors[result.stage] || '#94a3b8';

  return (
    <div style={{
      background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.08)',
      borderRadius: 16, padding: 16,
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>🧠 智能引导</span>
        <span style={{
          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6,
          background: `${stageColor}20`, color: stageColor,
          border: `1px solid ${stageColor}40`,
        }}>{result.stageIcon} {result.stage}</span>
      </div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>{result.description}</div>
      {result.suggestedFormula && (
        <div style={{
          background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.08)',
          borderRadius: 10, padding: 12,
        }}>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{result.formulaName}</div>
          <div style={{
            fontFamily: '"SF Mono", Menlo, monospace', fontSize: 15, fontWeight: 700,
            color: '#22d3ee', marginBottom: 6, letterSpacing: 1,
          }}>{result.suggestedFormula}</div>
          <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>{result.explanation}</div>
          {onAutoStart && (
            <button onClick={() => onAutoStart(result.suggestedFormula, result.formulaName)} style={{ padding: "8px 16px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "none", cursor: "pointer", background: stageColor, color: "#000", width: "100%" }}>▶ 训练: {result.formulaName}</button>
          )}
        </div>
      )}
      {!result.suggestedFormula && result.explanation && (
        <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>{result.explanation}</div>
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
  const [recentMoves, setRecentMoves] = useState<RecentMove[]>([]);
  const [scramble, setScramble] = useState("");
  const [history, setHistory] = useState<PracticeSession[]>(() => {
    if (typeof window !== "undefined") {
      try { return JSON.parse(localStorage.getItem("practice_history") || "[]"); } catch { return []; }
    }
    return [];
  });
  const [showHistory, setShowHistory] = useState(false);
  const [timerMode, setTimerMode] = useState(false);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerTime, setTimerTime] = useState(0);
  const [timerReady, setTimerReady] = useState(false);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const [solves, setSolves] = useState<number[]>(() => {
    if (typeof window !== "undefined") {
      try { return JSON.parse(localStorage.getItem("timer_solves") || "[]"); } catch { return []; }
    }
    return [];
  });
  const [cubeStage, setCubeStage] = useState("");
  const autoAdvanceRef = useRef(false);
  const cubeFaceletsRef = useRef<string[]|null>(null);
  const handleMoveRef = useRef<(move: string) => void>(() => {});
  const [showSettings, setShowSettings] = useState(false);
  const [showNotation, setShowNotation] = useState(false);
  const [macInput, setMacInput] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("cube_mac") || "CC:A3:00:00:CC:3E";
    return "CC:A3:00:00:CC:3E";
  });

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

    let moveType: RecentMove['type'] = 'valid';

    if (formula && practicing) {
      const expected = formula.formula.split(' ');
      const idx = moves.length;
      if (idx < expected.length) {
        const exp = expected[idx].replace(/\s+/g, '').toUpperCase();
        const act = move.replace(/\s+/g, '').toUpperCase();
        if (act === exp) {
          moveType = 'matched';
          setStats(p => { const ns = p.streak + 1; return { correct: p.correct + 1, wrong: p.wrong, streak: ns, bestStreak: Math.max(p.bestStreak, ns) }; });
          addLog(`✅ ${idx + 1}: ${move}`, 'success'); setHlStep(idx + 1);
        } else {
          moveType = 'wrong';
          setStats(p => ({ ...p, wrong: p.wrong + 1, streak: 0 }));
          setWrongs(p => new Set(p).add(idx));
          addLog(`❌ 期望${expected[idx]}，实际${move}`, 'error');
        }
        setMoves(p => [...p, move]);
        if (idx + 1 === expected.length && act === exp) {
          const t = ((Date.now() - (startRef.current || Date.now())) / 1000).toFixed(1);
          addLog("✅ 完成！" + t + "s", "success"); setPracticing(false);
          if (timerRef.current) clearInterval(timerRef.current);
          if (autoAdvanceRef.current && cubeFaceletsRef.current) {
            setTimeout(() => {
              const stage = analyzeSolveStage(cubeFaceletsRef.current!);
              if (stage.stage === "已还原") {
                addLog("🎉 魔方已还原！", "success");
                autoAdvanceRef.current = false;
              } else if (stage.suggestedFormula) {
                addLog("🧠 下一步: " + stage.formulaName, "info");
                const nextF: Formula = { id: stage.formulaName, name: stage.description, formula: stage.suggestedFormula, description: stage.explanation, difficulty: "beginner" as const };
                setFormula(nextF);
                setMoves([]); setWrongs(new Set()); setHlStep(0);
                setStats({ correct:0, wrong:0, streak:0, bestStreak:0 }); setTime(0);
                startRef.current = Date.now();
                setPracticing(true);
                if (timerRef.current) clearInterval(timerRef.current);
                timerRef.current = setInterval(() => { if (startRef.current) setTime(parseFloat(((Date.now()-startRef.current)/1000).toFixed(1))); }, 100);
              }
            }, 1500);
          }
        }
      }
    }

    // Track recent moves (max 10, newest first)
    setRecentMoves(p => [{ move, type: moveType }, ...p].slice(0, 10));
  }, [formula, practicing, moves, addLog]);

  // Keep ref in sync with latest handleMove
  useEffect(() => { handleMoveRef.current = handleMove; });

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

      const macParts = macInput.replace(/[^0-9a-fA-F]/g, "").match(/.{2}/g) || ["CC","A3","00","00","CC","3E"];
      const MAC_BYTES = macParts.map((h: string) => parseInt(h, 16));
      addLog(`MAC: ${MAC_BYTES.map((b: number) => b.toString(16).padStart(2,"0").toUpperCase()).join(":")}`, "info");

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
          const pf = parseCubeState(stateBytes); setCubeFacelets(pf); cubeFaceletsRef.current = pf; const sr = analyzeSolveStage(pf); setCubeStage(sr.stage + " " + sr.stageIcon);
          const ack = buildAck(msg);
          charRef.current?.writeValueWithoutResponse(ack).catch(() => {});
        } else if (opcode === 0x03) {
          // State Change
          const moveByte = msg[34];
          const move = MOVE_TABLE[moveByte];
          if (move) handleMoveRef.current(move);
          const batt = msg[35];
          if (batt !== undefined) setBattery(batt);
          const stateBytes = Array.from(msg.slice(7, 34));
          const pf = parseCubeState(stateBytes); setCubeFacelets(pf); cubeFaceletsRef.current = pf; const sr = analyzeSolveStage(pf); setCubeStage(sr.stage + " " + sr.stageIcon);
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
  }, [addLog, macInput]);

  const selectFormula = useCallback((id: string) => {
    const f = formulas.find(x => x.id === id);
    if (f) { setFormula(f); setMoves([]); setWrongs(new Set()); setHlStep(-1); }
  }, [formulas]);

  const handleAutoStart = useCallback((formulaStr: string, formulaName: string) => {
    const f: Formula = { id: formulaName, name: formulaName, formula: formulaStr, description: "", difficulty: "beginner" as const };
    setFormula(f);
    setMoves([]); setWrongs(new Set()); setHlStep(0);
    setStats({ correct:0, wrong:0, streak:0, bestStreak:0 }); setTime(0);
    startRef.current = Date.now();
    setPracticing(true);
    autoAdvanceRef.current = true;
    addLog("🚀 训练: " + formulaName, "success");
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => { if (startRef.current) setTime(parseFloat(((Date.now()-startRef.current)/1000).toFixed(1))); }, 100);
  }, [addLog]);

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

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); if (timerIntervalRef.current) clearInterval(timerIntervalRef.current); }, []);

  // Timer keyboard handler
  useEffect(() => {
    if (!timerMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (!timerRunning && !timerReady) {
          setTimerReady(true);
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (timerReady && !timerRunning) {
          setTimerRunning(true);
          setTimerReady(false);
          setTimerTime(0);
          const start = Date.now();
          timerIntervalRef.current = setInterval(() => {
            setTimerTime(Date.now() - start);
          }, 10);
        } else if (timerRunning) {
          setTimerRunning(false);
          if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
          const finalTime = timerTime;
          setSolves(prev => {
            const next = [finalTime, ...prev].slice(0, 200);
            try { localStorage.setItem("timer_solves", JSON.stringify(next)); } catch {}
            return next;
          });
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
  }, [timerMode, timerRunning, timerReady, timerTime]);
  useEffect(() => { if (typeof window !== 'undefined' && /^((?!chrome|android).)*safari/i.test(navigator.userAgent) && !('bluetooth' in navigator)) setShowSafari(true); }, []);

  const progress = formula ? (moves.length / formula.formula.split(' ').length) * 100 : 0;

  // Last 5 recent moves for display
  const recentMovesDisplay = recentMoves.slice(0, 5);

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
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f0f4f8, #e2e8f0, #f0f4f8)', color: '#1e293b', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif' }}>
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
        <div style={{ background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 16, margin: '0 16px', padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
          <div style={{ width: '100%', height: 400, overflow: "hidden", position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div ref={cubeRef} style={{ width: 200, height: 200, touchAction: 'none' }}>
              <Cube3D rx={rx} ry={ry} facelets={cubeFacelets || undefined} size={180} />
            </div>
          </div>
          <div style={{ marginTop: 12, fontSize: 11, color: '#475569' }}>拖拽旋转魔方</div>
          <div style={{ display: 'flex', gap: 8, width: '100%', marginTop: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setTimerMode(p => !p)} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: timerMode ? 'rgba(6,182,212,0.15)' : 'rgba(255,255,255,0.9)', color: timerMode ? '#0891b2' : '#475569', cursor: 'pointer' }}>{'\u23F1'} {'\u8ba1\u65f6'}</button>
                  <button onClick={connect} disabled={connecting || connected} style={{ flex: 1, padding: '10px 0', fontSize: 14, fontWeight: 600, borderRadius: 10, border: 'none', cursor: connecting ? 'wait' : 'pointer', background: connected ? 'rgba(74,222,128,0.15)' : '#06b6d4', color: connected ? '#4ade80' : '#fff', opacity: connecting ? 0.5 : 1 }}>
              {connecting ? '连接中...' : connected ? '✅ 已连接' : '🔗 连接魔方'}
            </button>
                  <button onClick={() => setShowSettings(p => !p)} style={{ padding: '8px 12px', fontSize: 13, borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: showSettings ? 'rgba(6,182,212,0.15)' : 'rgba(255,255,255,0.04)', color: showSettings ? '#22d3ee' : '#94a3b8', cursor: 'pointer' }}>⚙️</button>
                </div>
            <button onClick={() => setShowLog(p => !p)} style={{ padding: '10px 14px', fontSize: 13, borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: 'rgba(255,255,255,0.04)', color: '#94a3b8', cursor: 'pointer' }}>📋</button>
          </div>
          {showSettings && (
            <div style={{ width: '100%', background: 'rgba(0,0,0,0.06)', borderRadius: 10, padding: 12, marginTop: 8 }}>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>MAC</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input type="text" value={macInput} onChange={(e) => setMacInput(e.target.value.toUpperCase())} placeholder="CC:A3:00:00:CC:3E" style={{ flex: 1, padding: '8px 10px', fontSize: 12, fontFamily: 'monospace', background: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 6, color: '#e2e8f0', outline: 'none' }} />
                <button onClick={() => { localStorage.setItem('cube_mac', macInput); addLog('MAC saved', 'success'); }} style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none', cursor: 'pointer', background: '#06b6d4', color: '#fff' }}>保存</button>
              </div>
            </div>
          )}
                    {showLog && (
            <div style={{ width: '100%', maxHeight: 200, overflow: 'auto', background: 'rgba(0,0,0,0.06)', borderRadius: 10, padding: 10, marginTop: 8 }}>
              {logs.map(l => <div key={l.id} style={{ fontSize: 10, padding: '2px 0', display: 'flex', gap: 6, color: l.type === 'error' ? '#f87171' : l.type === 'success' ? '#4ade80' : '#94a3b8' }}><span style={{ fontFamily: 'monospace', color: '#475569', flexShrink: 0 }}>{l.time}</span><span>{l.message}</span></div>)}
            </div>
          )}
        </div>

        {/* Smart Guidance - Mobile */}
        <div style={{ padding: '12px 16px 0' }}>
          <SmartGuidance facelets={cubeFacelets} onAutoStart={handleAutoStart} />
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, padding: '12px 16px' }}>
          {[{ l: '正确', v: stats.correct, c: '#4ade80' }, { l: '错误', v: stats.wrong, c: '#f87171' }, { l: '连续', v: stats.streak, c: '#22d3ee' }, { l: '最佳', v: stats.bestStreak, c: '#facc15' }].map(s => (
            <div key={s.l} style={{ background: 'rgba(0,0,0,0.04)', borderRadius: 10, border: '1px solid rgba(0,0,0,0.06)', padding: '8px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.c }}>{s.v}</div>
              <div style={{ fontSize: 10, color: '#64748b' }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* Category tabs */}
        <div style={{ display: 'flex', gap: 4, padding: '0 16px 8px', alignItems: 'center' }}>
          {Object.keys(formulaLibrary).map(c => <button key={c} onClick={() => { setCat(c); setFormula(null); setMoves([]); }} style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer', background: cat === c ? '#06b6d4' : 'rgba(255,255,255,0.06)', color: cat === c ? '#fff' : '#94a3b8' }}>{c}</button>)}
          <button onClick={() => setShowNotation(p => !p)} style={{ padding: '6px 10px', fontSize: 11, borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', background: showNotation ? 'rgba(6,182,212,0.15)' : 'transparent', color: showNotation ? '#22d3ee' : '#64748b', cursor: 'pointer', marginLeft: 'auto' }}>❓ 符号</button>
        </div>
        {showNotation && (
          <div style={{ padding: '10px 16px', margin: '0 16px 8px', background: 'rgba(6,182,212,0.05)', borderRadius: 10, border: '1px solid rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#475569' }}>公式符号说明</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 11 }}>
              <div><b>R</b> = 右面顺时针</div>
              <div><b>R{"'"}</b> = 右面逆时针</div>
              <div><b>L</b> = 左面顺时针</div>
              <div><b>L{"'"}</b> = 左面逆时针</div>
              <div><b>U</b> = 上面顺时针</div>
              <div><b>U{"'"}</b> = 上面逆时针</div>
              <div><b>D</b> = 下面顺时针</div>
              <div><b>D{"'"}</b> = 下面逆时针</div>
              <div><b>F</b> = 前面顺时针</div>
              <div><b>F{"'"}</b> = 前面逆时针</div>
              <div><b>B</b> = 后面顺时针</div>
              <div><b>B{"'"}</b> = 后面逆时针</div>
              <div><b>M</b> = 中层</div>
              <div><b>R2</b> = 转180°</div>
            </div>
          </div>
        )}

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
            <FormulaDetail formula={formula} practicing={practicing} moves={moves} wrongs={wrongs} hlStep={hlStep} progress={progress} time={time} recentMoves={recentMovesDisplay} onStart={startPractice} onReset={resetPractice} />
          </div>
        )}
      </div>

      {/* ═══════ DESKTOP LAYOUT (≥ 768px) ═══════ */}
      <div className="desktop-layout">
        <main style={{ maxWidth: 1400, margin: '0 auto', padding: '0 24px 24px', display: 'grid', gridTemplateColumns: '260px 1fr 320px', gap: 16 }}>
          {/* Left - Formula Library */}
          <div style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(20px)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: 16, borderBottom: '1px solid rgba(0,0,0,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>📚 公式库</h2>
              <button onClick={() => setShowNotation(p => !p)} style={{ padding: '4px 8px', fontSize: 12, borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', background: showNotation ? 'rgba(6,182,212,0.15)' : 'transparent', color: showNotation ? '#22d3ee' : '#64748b', cursor: 'pointer' }}>❓ 符号</button>
            </div>
            {showNotation && (
              <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(0,0,0,0.08)', background: 'rgba(6,182,212,0.05)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#475569' }}>魔方公式符号说明</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11 }}>
                  <div><b>R</b> = 右面顺时针</div>
                  <div><b>R{"'"}</b> = 右面逆时针</div>
                  <div><b>L</b> = 左面顺时针</div>
                  <div><b>L{"'"}</b> = 左面逆时针</div>
                  <div><b>U</b> = 上面顺时针</div>
                  <div><b>U{"'"}</b> = 上面逆时针</div>
                  <div><b>D</b> = 下面顺时针</div>
                  <div><b>D{"'"}</b> = 下面逆时针</div>
                  <div><b>F</b> = 前面顺时针</div>
                  <div><b>F{"'"}</b> = 前面逆时针</div>
                  <div><b>B</b> = 后面顺时针</div>
                  <div><b>B{"'"}</b> = 后面逆时针</div>
                  <div><b>M</b> = 中层（左→右）</div>
                  <div><b>M{"'"}</b> = 中层（右→左）</div>
                  <div><b>R2</b> = 右面转180°</div>
                  <div><b>U2</b> = 上面转180°</div>
                  <div><b>r</b> = 右层+中层</div>
                  <div><b>x</b> = 整体沿R转</div>
                </div>
                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 8 }}>顺时针 = 从该面看向魔方的顺时针方向</div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 4, padding: '10px 12px', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
              {Object.keys(formulaLibrary).map(c => <button key={c} onClick={() => { setCat(c); setFormula(null); setMoves([]); }} style={{ padding: '6px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer', background: cat === c ? '#06b6d4' : 'rgba(255,255,255,0.06)', color: cat === c ? '#fff' : '#94a3b8' }}>{c}</button>)}
            </div>
            <div style={{ display: 'flex', gap: 4, padding: '8px 12px', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
              {['all', 'beginner', 'intermediate', 'advanced'].map(d => <button key={d} onClick={() => setDiff(d)} style={{ padding: '4px 10px', fontSize: 11, fontWeight: 500, borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', background: diff === d ? 'rgba(255,255,255,0.08)' : 'transparent', color: diff === d ? '#e2e8f0' : '#64748b', cursor: 'pointer' }}>{d === 'all' ? '全部' : diffMeta(d).label}</button>)}
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
            <div style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(20px)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 16, padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0, height: 400, overflow: "hidden" }}>
              <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                <div ref={cubeRef} style={{ width: 240, height: 240, touchAction: 'none' }}>
                  <Cube3D rx={rx} ry={ry} facelets={cubeFacelets || undefined} size={220} />
                </div>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: '#475569' }}>拖拽旋转魔方</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={connect} disabled={connecting || connected} style={{ padding: '8px 24px', fontSize: 14, fontWeight: 600, borderRadius: 10, border: 'none', cursor: connecting ? 'wait' : 'pointer', background: connected ? 'rgba(74,222,128,0.15)' : '#06b6d4', color: connected ? '#4ade80' : '#fff', opacity: connecting ? 0.5 : 1 }}>
                  {connecting ? '连接中...' : connected ? '✅ 已连接' : '🔗 连接魔方'}
                </button>
              </div>
              <button onClick={() => setScramble(generateScramble())} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: 'rgba(255,255,255,0.9)', color: '#475569', cursor: 'pointer' }}>{'\u{1F504}'} {'\u6253\u4e71'}</button>
            </div>

            {showSettings && (
              <div style={{ background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 16, padding: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>⚙️ 魔方配置</div>
                <div>
                  <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 4 }}>MAC 地址</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="text" value={macInput} onChange={(e) => setMacInput(e.target.value.toUpperCase())} placeholder="CC:A3:00:00:CC:3E" style={{ flex: 1, padding: '8px 12px', fontSize: 13, fontFamily: 'monospace', background: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 8, color: '#e2e8f0', outline: 'none' }} />
                    <button onClick={() => { localStorage.setItem('cube_mac', macInput); addLog(`MAC saved: ${macInput}`, 'success'); }} style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: 'none', cursor: 'pointer', background: '#06b6d4', color: '#fff' }}>保存</button>
                  </div>
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>XX:XX:XX:XX:XX:XX</div>
                </div>
              </div>
            )}

                        {/* Timer Mode Display */}
            {timerMode && (
              <div style={{ background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 16, padding: 24, textAlign: 'center' }}>
                <div style={{ fontSize: 48, fontWeight: 700, fontFamily: '"SF Mono", Menlo, monospace', color: timerRunning ? '#059669' : timerReady ? '#d97706' : '#1e293b', marginBottom: 16, letterSpacing: 2 }}>
                  {timerReady ? 'READY' : (timerTime / 1000).toFixed(2)}
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 12 }}>
                  {timerReady ? "\u677e\u5f00\u7a7a\u683c\u5f00\u59cb" : timerRunning ? "\u6309\u7a7a\u683c\u505c\u6b62" : "\u6309\u4f4f\u7a7a\u683c\u51c6\u5907"}
                </div>
                {solves.length > 0 && (
                  <div style={{ marginTop: 16, textAlign: 'left' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: '#475569' }}>{'\u6700\u8fd1\u89e3\u9501'} ({solves.length})</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
                      {solves.slice(0, 10).map((s, i) => (
                        <div key={i} style={{ fontSize: 11, padding: '4px 6px', background: 'rgba(0,0,0,0.03)', borderRadius: 4, textAlign: 'center', fontFamily: 'monospace' }}>{(s/1000).toFixed(2)}</div>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
                      AO5: {solves.length >= 5 ? (solves.slice(0,5).reduce((a,b)=>a+b,0)/5/1000).toFixed(2) : '-'} | 
                      AO12: {solves.length >= 12 ? (solves.slice(0,12).reduce((a,b)=>a+b,0)/12/1000).toFixed(2) : '-'}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Scramble Display */}
            {scramble && (
              <div style={{ background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 16, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{'\u{1F500}'} {'\u6253\u4e71\u516c\u5f0f'}</span>
                  <button onClick={() => setScramble(generateScramble())} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: '1px solid rgba(0,0,0,0.1)', background: 'rgba(255,255,255,0.9)', color: '#475569', cursor: 'pointer' }}>{'\u{1F504}'} {'\u6362\u4e00\u4e2a'}</button>
                </div>
                <div style={{ fontFamily: '"SF Mono", Menlo, monospace', fontSize: 13, color: '#1e293b', lineHeight: 1.8, wordBreak: 'break-all' }}>{scramble}</div>
              </div>
            )}

            {/* Smart Guidance - Desktop */}
            <SmartGuidance facelets={cubeFacelets} onAutoStart={handleAutoStart} />

            {formula && <FormulaDetail formula={formula} practicing={practicing} moves={moves} wrongs={wrongs} hlStep={hlStep} progress={progress} time={time} recentMoves={recentMovesDisplay} onStart={startPractice} onReset={resetPractice} />}
            {/* History Toggle */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowHistory(p => !p)} style={{ flex: 1, padding: '8px 16px', fontSize: 12, fontWeight: 600, borderRadius: 10, border: '1px solid rgba(0,0,0,0.1)', background: showHistory ? 'rgba(6,182,212,0.15)' : 'rgba(255,255,255,0.9)', color: showHistory ? '#0891b2' : '#475569', cursor: 'pointer' }}>{'\U0001F4CA'} {'\u5386\u53f2\u8bb0\u5f55'}</button>
            </div>

            {showHistory && (
              <div style={{ background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 16, padding: 16, maxHeight: 300, overflow: 'auto' }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{'\U0001F4CA'} {'\u7ec3\u4e60\u8bb0\u5f55'}</div>
                {history.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: 20 }}>{'\u6682\u65e0\u8bb0\u5f55'}</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {history.slice(0, 20).map((s) => (
                      <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'rgba(0,0,0,0.03)', borderRadius: 8, fontSize: 12 }}>
                        <div>
                          <div style={{ fontWeight: 600, color: '#1e293b' }}>{s.formula}</div>
                          <div style={{ fontSize: 10, color: '#94a3b8' }}>{s.date}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 700, color: '#0891b2' }}>{s.time}s</div>
                          <div style={{ fontSize: 10, color: '#94a3b8' }}>{s.correct}/{s.moves} {'\u6b65'}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>

            {/* Export/Import */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => {
                const data = exportData(history, solves);
                const blob = new Blob([data], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = 'rubik-cube-data.json'; a.click();
                URL.revokeObjectURL(url);
                addLog("\u{1F4E5} \u6570\u636e\u5df2\u5bfc\u51fa", "success");
              }} style={{ flex: 1, padding: '8px 12px', fontSize: 11, fontWeight: 600, borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', background: 'rgba(255,255,255,0.9)', color: '#475569', cursor: 'pointer' }}>{'\u{1F4E4}'} {'\u5bfc\u51fa'}</button>
              <label style={{ flex: 1, padding: '8px 12px', fontSize: 11, fontWeight: 600, borderRadius: 8, border: '1px solid rgba(0,0,0,0.1)', background: 'rgba(255,255,255,0.9)', color: '#475569', cursor: 'pointer', textAlign: 'center', display: 'block' }}>
                {'\u{1F4E5}'} {'\u5bfc\u5165'}
                <input type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    const result = importData(ev.target?.result as string);
                    if (result) {
                      setHistory(result.history);
                      setSolves(result.solves);
                      try { localStorage.setItem("practice_history", JSON.stringify(result.history)); } catch {}
                      try { localStorage.setItem("timer_solves", JSON.stringify(result.solves)); } catch {}
                      addLog("\u{1F4E5} \u6570\u636e\u5df2\u5bfc\u5165", "success");
                    } else {
                      addLog("\u274C \u6587\u4ef6\u683c\u5f0f\u9519\u8bef", "error");
                    }
                  };
                  reader.readAsText(file);
                }} />
              </label>
            </div>

          {/* Right - Stats + Log */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(20px)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 16, padding: 16 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px' }}>📊 统计</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[{ l: '正确', v: stats.correct, c: '#4ade80' }, { l: '错误', v: stats.wrong, c: '#f87171' }, { l: '连续', v: stats.streak, c: '#22d3ee' }, { l: '最佳', v: stats.bestStreak, c: '#facc15' }].map(s => (
                  <div key={s.l} style={{ background: 'rgba(0,0,0,0.04)', borderRadius: 10, border: '1px solid rgba(0,0,0,0.06)', padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: s.c }}>{s.v}</div>
                    <div style={{ fontSize: 10, color: '#64748b' }}>{s.l}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(20px)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 16, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(0,0,0,0.08)' }}><h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>📋 日志</h2></div>
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
