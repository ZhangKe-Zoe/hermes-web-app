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

interface Stats {
  correct: number;
  wrong: number;
  streak: number;
  bestStreak: number;
}

interface LogEntry {
  id: number;
  time: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

// ── Inline Style Helpers ──
const S = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #030712 0%, #0f172a 50%, #030712 100%)',
    color: '#e2e8f0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif',
  } as React.CSSProperties,
  glass: {
    background: 'rgba(255,255,255,0.03)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '16px',
  } as React.CSSProperties,
  card: {
    background: 'rgba(0,0,0,0.2)',
    borderRadius: '12px',
    border: '1px solid rgba(255,255,255,0.04)',
  } as React.CSSProperties,
  btn: (active?: boolean) => ({
    padding: '6px 14px',
    fontSize: '13px',
    fontWeight: 600 as const,
    borderRadius: '8px',
    border: 'none',
    cursor: 'pointer' as const,
    transition: 'all 0.15s',
    background: active ? '#06b6d4' : 'rgba(255,255,255,0.06)',
    color: active ? '#fff' : '#94a3b8',
  }),
  btnSm: {
    padding: '4px 10px',
    fontSize: '11px',
    fontWeight: 500,
    borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.04)',
    color: '#94a3b8',
    cursor: 'pointer',
    transition: 'all 0.15s',
  } as React.CSSProperties,
  mono: {
    fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", Menlo, Consolas, monospace',
  } as React.CSSProperties,
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

// ── Colors ──
const FACE_COLORS: Record<string, string> = {
  U: '#ffffff', D: '#ffd500', F: '#c41e3a',
  B: '#ff5800', L: '#0051ba', R: '#009e60',
  inner: '#1a1a2e',
};

// ── QY Cube Bluetooth Protocol ──
// QY smart cube uses UUID 0000fff0-0000-1000-8000-00805f9b34fb
// Characteristic 0000fff5-... for state, 0000fff7-... for move notifications
const QY_SERVICE_UUID = '0000fff0-0000-1000-8000-00805f9b34fb';
const QY_STATE_CHAR = '0000fff5-0000-1000-8000-00805f9b34fb';
const QY_MOVE_CHAR = '0000fff7-0000-1000-8000-00805f9b34fb';

// Decode move byte from QY cube
function decodeQYMove(dataView: DataView): string | null {
  // QY cube move data format:
  // Byte 0-1: move count
  // Byte 2: face + direction
  //   Bits 7-5: face (0=U, 1=R, 2=F, 3=D, 4=L, 5=B)
  //   Bits 4-0: direction (0x00 = CW 90°, 0x01 = CW 180°, 0x02 = CCW 90°)
  if (dataView.byteLength < 3) return null;

  const moveByte = dataView.getUint8(2);
  const faceIdx = (moveByte >> 5) & 0x07;
  const dir = moveByte & 0x1f;

  const faces = ['U', 'R', 'F', 'D', 'L', 'B'];
  const face = faces[faceIdx];
  if (!face) return null;

  if (dir === 0x00) return face;       // CW 90°
  if (dir === 0x01) return face + '2'; // CW 180°
  if (dir === 0x02) return face + "'"; // CCW 90°
  if (dir === 0x03) return face + "'"; // CCW 180° (same as CW 180°)
  return face; // default
}

// ── 3D Cube Component ──
function Cube3D({ rotationX, rotationY }: { rotationX: number; rotationY: number }) {
  const cubies = useMemo(() => {
    const result: { x: number; y: number; z: number; faces: Record<string, string> }[] = [];
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          const faces: Record<string, string> = {};
          if (y === 1) faces.top = FACE_COLORS.U;
          if (y === -1) faces.bottom = FACE_COLORS.D;
          if (z === 1) faces.front = FACE_COLORS.F;
          if (z === -1) faces.back = FACE_COLORS.B;
          if (x === 1) faces.right = FACE_COLORS.R;
          if (x === -1) faces.left = FACE_COLORS.L;
          result.push({ x, y, z, faces });
        }
      }
    }
    return result;
  }, []);

  return (
    <div style={{ perspective: '600px', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        width: '120px', height: '120px', position: 'relative',
        transformStyle: 'preserve-3d',
        transform: `rotateX(${rotationX}deg) rotateY(${rotationY}deg)`,
        transition: 'transform 0.1s ease-out',
      }}>
        {cubies.map(({ x, y, z, faces }, i) => (
          <div key={i} style={{
            position: 'absolute', width: '36px', height: '36px',
            transformStyle: 'preserve-3d',
            transform: `translate3d(${x * 38 + 42}px, ${-y * 38 + 42}px, ${z * 38}px)`,
          }}>
            {([
              ['top', 'rotateX(90deg) translateZ(18px)'],
              ['bottom', 'rotateX(-90deg) translateZ(18px)'],
              ['front', 'translateZ(18px)'],
              ['back', 'rotateY(180deg) translateZ(18px)'],
              ['right', 'rotateY(90deg) translateZ(18px)'],
              ['left', 'rotateY(-90deg) translateZ(18px)'],
            ] as [string, string][]).map(([face, tf]) => (
              <div key={face} style={{
                position: 'absolute', width: '36px', height: '36px',
                transform: tf,
                background: faces[face] || FACE_COLORS.inner,
                border: '1.5px solid #0a0a1a',
                borderRadius: '3px',
                boxSizing: 'border-box',
              }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Difficulty Meta ──
function diffMeta(d?: string) {
  switch (d) {
    case 'beginner': return { label: '初级', color: '#4ade80', bg: 'rgba(74,222,128,0.15)' };
    case 'intermediate': return { label: '中级', color: '#facc15', bg: 'rgba(250,204,21,0.15)' };
    case 'advanced': return { label: '高级', color: '#f87171', bg: 'rgba(248,113,113,0.15)' };
    default: return { label: '全部', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' };
  }
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

  const startTimeRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logIdRef = useRef(0);
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const moveCharRef = useRef<any>(null);

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    logIdRef.current++;
    setLogs(prev => [{ id: logIdRef.current, time: new Date().toLocaleTimeString(), message, type }, ...prev].slice(0, 50));
  }, []);

  const formulas = useMemo(() => {
    const list = formulaLibrary[currentCategory] || [];
    return difficulty === 'all' ? list : list.filter(f => f.difficulty === difficulty);
  }, [currentCategory, difficulty]);

  // Handle cube move (from Bluetooth or manual)
  const handleCubeMove = useCallback((move: string) => {
    setLastMove(move);
    addLog(`魔方: ${move}`, 'info');

    // Auto-check against practice formula
    if (currentFormula && isPracticing) {
      const expectedMoves = currentFormula.formula.split(' ');
      const idx = userMoves.length;
      if (idx < expectedMoves.length) {
        const expected = expectedMoves[idx].replace(/\s+/g, '').toUpperCase();
        const actual = move.replace(/\s+/g, '').toUpperCase();
        if (actual === expected) {
          setStats(prev => {
            const ns = prev.streak + 1;
            return { correct: prev.correct + 1, wrong: prev.wrong, streak: ns, bestStreak: Math.max(prev.bestStreak, ns) };
          });
          addLog(`✅ 步骤${idx + 1}: ${move}`, 'success');
          setHighlightedStep(idx + 1);
        } else {
          setStats(prev => ({ ...prev, wrong: prev.wrong + 1, streak: 0 }));
          setWrongMoves(prev => new Set(prev).add(idx));
          addLog(`❌ 步骤${idx + 1}: 期望 ${expectedMoves[idx]}，实际 ${move}`, 'error');
        }
        setUserMoves(prev => [...prev, move]);
        if (idx + 1 === expectedMoves.length && actual === expected) {
          const t = ((Date.now() - (startTimeRef.current || Date.now())) / 1000).toFixed(1);
          addLog(`🎉 完美完成！用时 ${t} 秒`, 'success');
          setIsPracticing(false);
          if (timerRef.current) clearInterval(timerRef.current);
        }
      }
    }
  }, [currentFormula, isPracticing, userMoves, addLog]);

  // Select formula
  const selectFormula = useCallback((id: string) => {
    const f = formulas.find(x => x.id === id);
    if (f) {
      setCurrentFormula(f);
      setUserMoves([]);
      setWrongMoves(new Set());
      setHighlightedStep(-1);
      addLog(`已选择: ${f.id} ${f.name}`, 'info');
    }
  }, [formulas, addLog]);

  // Start practice
  const startPractice = useCallback(() => {
    if (!currentFormula) { addLog('请先选择一个公式', 'error'); return; }
    setIsPracticing(true);
    setUserMoves([]);
    setWrongMoves(new Set());
    setHighlightedStep(0);
    setStats({ correct: 0, wrong: 0, streak: 0, bestStreak: 0 });
    setElapsedTime(0);
    startTimeRef.current = Date.now();
    addLog(`开始练习: ${currentFormula.id}`, 'success');
    timerRef.current = setInterval(() => {
      if (startTimeRef.current) setElapsedTime(parseFloat(((Date.now() - startTimeRef.current) / 1000).toFixed(1)));
    }, 100);
  }, [currentFormula, addLog]);

  // Reset
  const resetPractice = useCallback(() => {
    setIsPracticing(false);
    setUserMoves([]);
    setWrongMoves(new Set());
    setHighlightedStep(-1);
    setStats({ correct: 0, wrong: 0, streak: 0, bestStreak: 0 });
    setElapsedTime(0);
    startTimeRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    addLog('练习已重置', 'info');
  }, [addLog]);

  // Bluetooth connect with real data parsing
  const connectCube = useCallback(async () => {
    if (isConnecting) return;
    setIsConnecting(true);

    // Browser detection
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
    const hasBluetooth = typeof navigator !== 'undefined' && 'bluetooth' in navigator;

    if (!hasBluetooth) {
      if (isSafari) {
        addLog('⚠️ Safari 不支持 Web Bluetooth，请使用 Chrome/Edge 浏览器', 'error');
      } else {
        addLog('⚠️ 当前浏览器不支持 Web Bluetooth，请使用 Chrome 56+', 'error');
      }
      setIsConnecting(false);
      return;
    }

    addLog('搜索智能魔方...', 'info');
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bt = (navigator as unknown as { bluetooth: { requestDevice: (opts: Record<string, unknown>) => Promise<any> } }).bluetooth;
      const device = await bt.requestDevice({
        filters: [
          { namePrefix: 'QY' },
          { namePrefix: 'Qiyi' },
          { namePrefix: 'Giiker' },
          { namePrefix: 'Mi Smart' },
        ],
        optionalServices: [QY_SERVICE_UUID],
      });

      addLog(`找到设备: ${device.name || 'Unknown'}`, 'success');

      // Connect GATT
      const server = await device.gatt!.connect();
      addLog('GATT 连接成功', 'info');

      // Get service
      const service = await server.getPrimaryService(QY_SERVICE_UUID);
      addLog('获取服务成功', 'info');

      // ── Probe ALL characteristics on this service ──
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chars: any[] = await service.getCharacteristics();
      addLog(`发现 ${chars.length} 个特征值`, 'info');

      // Log each characteristic for debugging
      let subscribed = false;
      for (const char of chars) {
        const uuid = char.uuid;
        const props = char.properties;
        const propList = [
          props.read ? 'READ' : '',
          props.write ? 'WRITE' : '',
          props.notify ? 'NOTIFY' : '',
          props.indicate ? 'INDICATE' : '',
        ].filter(Boolean).join('+');
        addLog(`  ${uuid.slice(4, 8)}: ${propList || 'none'}`, 'info');

        // Try to subscribe to any characteristic that supports notifications
        if (props.notify && !subscribed) {
          try {
            char.addEventListener('characteristicvaluechanged', ((event: Event) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const target = event.target as any;
              if (!target.value) return;
              const data = target.value;

              // Log raw bytes for debugging (first few times)
              const bytes = Array.from(new Uint8Array(data.buffer)).map(b => b.toString(16).padStart(2, '0')).join(' ');
              addLog(`📦 [${uuid.slice(4,8)}] ${bytes}`, 'info');

              // Try to decode as a move
              const move = decodeQYMove(data);
              if (move) {
                handleCubeMove(move);
              }
            }) as EventListener);

            await char.startNotifications();
            subscribed = true;
            moveCharRef.current = char;
            addLog(`✅ 已订阅 ${uuid.slice(4, 8)} 通知`, 'success');
          } catch (e) {
            addLog(`  订阅 ${uuid.slice(4, 8)} 失败: ${e}`, 'warning');
          }
        }
      }

      if (!subscribed) {
        addLog('⚠️ 未找到可订阅的通知特征值', 'warning');
      }

      // ── Send activation commands to start move reporting ──
      // QY/Qiyi cubes need a write command to start sending moves
      for (const char of chars) {
        const uuid = char.uuid;
        const props = char.properties;
        if (props.write || props.writeWithoutResponse) {
          // Try common activation commands
          const cmds = [
            new Uint8Array([0xA5]),                          // Simple start
            new Uint8Array([0xA5, 0x01]),                    // Start moves
            new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),  // Giiker-style
            new Uint8Array([0xCC, 0x01]),                    // Qiyi start
          ];
          for (const cmd of cmds) {
            try {
              const cmdBytes = Array.from(cmd).map(b => b.toString(16).padStart(2, '0')).join(' ');
              addLog(`📤 写入 ${uuid.slice(4,8)}: ${cmdBytes}`, 'info');
              await char.writeValue(cmd);
              await new Promise(r => setTimeout(r, 200));
            } catch (e) {
              // Some commands may fail, that's ok
              addLog(`  写入失败: ${e}`, 'warning');
            }
          }
          // Only try first writable characteristic
          break;
        }
      }

      // Also try reading fff7 (state) to trigger data flow
      for (const char of chars) {
        if (char.uuid.includes('fff7') && char.properties.read) {
          try {
            const val = await char.readValue();
            const bytes = Array.from(new Uint8Array(val.buffer)).map(b => b.toString(16).padStart(2, '0')).join(' ');
            addLog(`📖 fff7 状态: ${bytes}`, 'info');
          } catch (e) {
            addLog(`读取 fff7 失败: ${e}`, 'warning');
          }
        }
      }

      setIsConnected(true);
      setConnectionStatus(`已连接: ${device.name || 'QY Cube'}`);
      addLog('✅ 魔方连接成功！转动魔方试试', 'success');

      // Handle disconnect
      device.addEventListener('gattserverdisconnected', () => {
        setIsConnected(false);
        setConnectionStatus('已断开');
        moveCharRef.current = null;
        addLog('魔方已断开连接', 'warning');
      });

    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '未知错误';
      if (msg.includes('cancelled') || msg.includes('User cancelled')) {
        addLog('用户取消了配对', 'info');
      } else {
        addLog(`连接失败: ${msg}`, 'error');
      }
    } finally {
      setIsConnecting(false);
    }
  }, [isConnecting, addLog, handleCubeMove]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (moveCharRef.current) {
        moveCharRef.current.stopNotifications().catch(() => {});
      }
    };
  }, []);

  // Mouse drag for 3D
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    setCubeRotY(prev => prev + (e.clientX - lastMouse.current.x) * 0.5);
    setCubeRotX(prev => prev - (e.clientY - lastMouse.current.y) * 0.5);
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);
  const handleMouseUp = useCallback(() => { isDragging.current = false; }, []);

  const progress = currentFormula ? (userMoves.length / currentFormula.formula.split(' ').length) * 100 : 0;

  // Manual move buttons
  const allMoves = ["U", "U'", "U2", "D", "D'", "D2", "R", "R'", "R2", "L", "L'", "L2", "F", "F'", "F2", "B", "B'", "B2"];

  return (
    <div style={S.page}>
      {/* Safari Warning */}
      {(() => {
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
        const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
        const hasBT = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
        if (isSafari && !hasBT) {
          return (
            <div style={{ background: 'rgba(245,158,11,0.1)', borderBottom: '1px solid rgba(245,158,11,0.2)', padding: '10px 16px', textAlign: 'center', fontSize: '13px', color: '#fbbf24' }}>
              ⚠️ <strong>Safari 不支持蓝牙连接</strong> — 请使用 <strong>Chrome</strong> 或 <strong>Edge</strong> 浏览器。你仍可使用手动模式练习公式。
            </div>
          );
        }
        return null;
      })()}

      {/* Header */}
      <header style={{ padding: '20px 24px 12px' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: '26px', fontWeight: 700, margin: 0, background: 'linear-gradient(135deg, #22d3ee, #3b82f6, #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              🎲 魔方速拧公式训练
            </h1>
            <p style={{ fontSize: '12px', color: '#64748b', margin: '4px 0 0' }}>CFOP · OLL · PLL · F2L 交互式学习系统</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {lastMove && (
              <div style={{ ...S.mono, fontSize: '20px', fontWeight: 700, color: '#22d3ee', padding: '4px 12px', background: 'rgba(34,211,238,0.1)', borderRadius: '8px', border: '1px solid rgba(34,211,238,0.2)' }}>
                {lastMove}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '20px', fontSize: '12px', background: isConnected ? 'rgba(74,222,128,0.1)' : 'rgba(255,255,255,0.04)', border: `1px solid ${isConnected ? 'rgba(74,222,128,0.3)' : 'rgba(255,255,255,0.08)'}`, color: isConnected ? '#4ade80' : '#64748b' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isConnected ? '#4ade80' : '#475569', animation: isConnected ? 'pulse 2s infinite' : 'none' }} />
              {connectionStatus}
            </div>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 24px 24px', display: 'grid', gridTemplateColumns: '280px 1fr 360px', gap: '16px' }}>

        {/* ── Left: Formula Library ── */}
        <div style={{ ...S.glass, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 600, margin: 0 }}>📚 公式库</h2>
          </div>
          <div style={{ display: 'flex', gap: '4px', padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            {Object.keys(formulaLibrary).map(cat => (
              <button key={cat} onClick={() => { setCurrentCategory(cat); setCurrentFormula(null); setUserMoves([]); }} style={S.btn(currentCategory === cat)}>{cat}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '4px', padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            {['all', 'beginner', 'intermediate', 'advanced'].map(d => (
              <button key={d} onClick={() => setDifficulty(d)} style={{ ...S.btnSm, background: difficulty === d ? 'rgba(255,255,255,0.1)' : 'transparent', color: difficulty === d ? '#e2e8f0' : '#64748b' }}>
                {d === 'all' ? '全部' : diffMeta(d).label}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '6px 8px' }}>
            {formulas.map(f => {
              const dm = diffMeta(f.difficulty);
              return (
                <div key={f.id} onClick={() => selectFormula(f.id)} style={{
                  padding: '10px 12px', marginBottom: '2px', borderRadius: '10px', cursor: 'pointer', transition: 'all 0.15s',
                  background: currentFormula?.id === f.id ? 'rgba(6,182,212,0.1)' : 'transparent',
                  border: currentFormula?.id === f.id ? '1px solid rgba(6,182,212,0.3)' : '1px solid transparent',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#22d3ee' }}>{f.id}</span>
                    {f.difficulty && <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: dm.bg, color: dm.color }}>{dm.label}</span>}
                  </div>
                  <div style={{ ...S.mono, fontSize: '13px', color: '#fbbf24', lineHeight: 1.6 }}>{f.formula}</div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{f.name} · {f.description}</div>
                </div>
              );
            })}
            {formulas.length === 0 && <div style={{ textAlign: 'center', color: '#475569', padding: '32px 0', fontSize: '13px' }}>该难度暂无公式</div>}
          </div>
        </div>

        {/* ── Center: 3D + Manual Input ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* 3D Cube */}
          <div style={S.glass}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '13px', color: '#94a3b8' }}>3D 魔方预览</span>
              <div style={{ display: 'flex', gap: '4px' }}>
                {['U', 'D', 'R', 'L', 'F', 'B'].map(face => (
                  <button key={face} onClick={() => {
                    const m: Record<string, [number, number]> = { U: [0, 90], D: [0, -90], R: [90, 0], L: [-90, 0], F: [0, 0], B: [180, 0] };
                    const [dx, dy] = m[face];
                    setCubeRotX(p => p + dx * 0.3);
                    setCubeRotY(p => p + dy * 0.3);
                  }} style={{ ...S.btnSm, width: '28px', height: '28px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', ...S.mono }}>{face}</button>
                ))}
              </div>
            </div>
            <div style={{ height: '300px', cursor: 'grab', userSelect: 'none' }} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
              <Cube3D rotationX={cubeRotX} rotationY={cubeRotY} />
            </div>
            <div style={{ padding: '0 16px 8px', textAlign: 'center' }}>
              <p style={{ fontSize: '11px', color: '#334155', margin: 0 }}>拖拽旋转 · 点击面按钮快速切换视角</p>
            </div>
          </div>

          {/* Manual Input */}
          <div style={{ ...S.glass, padding: '16px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', margin: '0 0 8px' }}>🎮 手动录入旋转</h3>
            <p style={{ fontSize: '11px', color: '#475569', margin: '0 0 12px' }}>
              {isConnected ? '蓝牙已连接，转动魔方自动录入。也可手动点击：' : '未连接魔方，手动点击按钮录入操作：'}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px' }}>
              {allMoves.map(move => (
                <button key={move} onClick={() => handleCubeMove(move)} disabled={!isPracticing && !isConnected}
                  style={{ ...S.mono, padding: '10px 0', fontSize: '13px', fontWeight: 600, borderRadius: '8px', border: 'none', cursor: (!isPracticing && !isConnected) ? 'not-allowed' : 'pointer', opacity: (!isPracticing && !isConnected) ? 0.3 : 1, background: 'rgba(255,255,255,0.06)', color: '#e2e8f0', transition: 'all 0.1s' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(6,182,212,0.2)'; (e.currentTarget as HTMLButtonElement).style.color = '#22d3ee'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; (e.currentTarget as HTMLButtonElement).style.color = '#e2e8f0'; }}
                >{move}</button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right: Practice ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Connect Button */}
          <div style={{ ...S.glass, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: isConnected ? '#4ade80' : isConnecting ? '#fbbf24' : '#475569', animation: (isConnected || isConnecting) ? 'pulse 2s infinite' : 'none' }} />
              <span style={{ fontSize: '13px', color: '#94a3b8' }}>{connectionStatus}</span>
            </div>
            <button onClick={connectCube} disabled={isConnecting} style={{ padding: '8px 20px', fontSize: '13px', fontWeight: 600, borderRadius: '10px', border: 'none', cursor: isConnecting ? 'wait' : 'pointer', background: isConnecting ? 'rgba(107,114,128,0.3)' : 'linear-gradient(135deg, #06b6d4, #3b82f6)', color: '#fff', transition: 'all 0.15s' }}>
              {isConnecting ? '搜索中...' : isConnected ? '已连接' : '🔗 连接魔方'}
            </button>
          </div>

          {/* Current Formula */}
          <div style={{ ...S.glass, padding: '20px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 16px' }}>🎯 练习模式</h2>
            {currentFormula ? (
              <>
                <div style={{ ...S.card, padding: '14px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#22d3ee' }}>{currentFormula.id}: {currentFormula.name}</span>
                    {currentFormula.difficulty && (() => { const dm = diffMeta(currentFormula.difficulty); return <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '10px', background: dm.bg, color: dm.color }}>{dm.label}</span>; })()}
                  </div>
                  <div style={{ ...S.mono, fontSize: '18px', color: '#fbbf24', letterSpacing: '1.5px', lineHeight: 1.8 }}>{currentFormula.formula}</div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '6px' }}>{currentFormula.description}</div>
                </div>

                {/* Steps */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '14px' }}>
                  {currentFormula.formula.split(' ').map((move, i) => {
                    const isDone = i < userMoves.length;
                    const isWrong = wrongMoves.has(i);
                    const isCurrent = i === highlightedStep && isPracticing;
                    return (
                      <span key={i} style={{ ...S.mono, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', fontSize: '13px', fontWeight: 700, borderRadius: '8px', transition: 'all 0.2s', background: isCurrent ? '#06b6d4' : isDone && !isWrong ? 'rgba(74,222,128,0.7)' : isWrong ? 'rgba(248,113,113,0.7)' : 'rgba(255,255,255,0.06)', color: isCurrent ? '#fff' : isDone ? '#fff' : '#94a3b8', boxShadow: isCurrent ? '0 0 12px rgba(6,182,212,0.4)' : 'none', transform: isCurrent ? 'scale(1.1)' : 'scale(1)' }}>
                        {move}
                      </span>
                    );
                  })}
                </div>

                {/* Progress */}
                <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', marginBottom: '16px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: 'linear-gradient(90deg, #06b6d4, #4ade80)', borderRadius: '3px', transition: 'width 0.3s', width: `${progress}%` }} />
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#475569' }}>
                <div style={{ fontSize: '36px', marginBottom: '8px' }}>👆</div>
                <p style={{ fontSize: '13px', margin: 0 }}>在左侧选择一个公式开始练习</p>
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={startPractice} disabled={!currentFormula || isPracticing} style={{ flex: 1, padding: '12px', fontSize: '14px', fontWeight: 600, borderRadius: '12px', border: 'none', cursor: (!currentFormula || isPracticing) ? 'not-allowed' : 'pointer', opacity: (!currentFormula || isPracticing) ? 0.4 : 1, background: 'linear-gradient(135deg, #06b6d4, #3b82f6)', color: '#fff', transition: 'all 0.15s' }}>
                {isPracticing ? '练习中...' : '▶ 开始练习'}
              </button>
              <button onClick={resetPractice} style={{ padding: '12px 20px', fontSize: '14px', fontWeight: 600, borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: '#94a3b8', cursor: 'pointer', transition: 'all 0.15s' }}>
                ↺ 重置
              </button>
            </div>
          </div>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
            {[
              { label: '正确', value: stats.correct, color: '#22d3ee' },
              { label: '错误', value: stats.wrong, color: '#f87171' },
              { label: '用时', value: `${elapsedTime}s`, color: '#fbbf24' },
              { label: '连击', value: stats.streak, color: '#4ade80' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ ...S.glass, padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '22px', fontWeight: 700, color }}>{value}</div>
                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Logs */}
          <div style={{ ...S.glass, overflow: 'hidden', flex: 1, minHeight: 0 }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#94a3b8', margin: 0 }}>📋 操作日志</h3>
            </div>
            <div style={{ padding: '8px 12px', maxHeight: '160px', overflowY: 'auto' }}>
              {logs.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#334155', padding: '16px 0', fontSize: '12px' }}>暂无日志</div>
              ) : (
                logs.map(log => (
                  <div key={log.id} style={{ ...S.mono, fontSize: '11px', padding: '2px 0', color: log.type === 'success' ? '#4ade80' : log.type === 'error' ? '#f87171' : log.type === 'warning' ? '#fbbf24' : '#64748b' }}>
                    <span style={{ color: '#334155' }}>[{log.time}]</span> {log.message}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Animations */}
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        * { box-sizing: border-box; }
        body { margin: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
        button:hover { filter: brightness(1.2); }
        button:active { transform: scale(0.97); }
      `}</style>
    </div>
  );
}
