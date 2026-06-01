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
const FACE_COLORS = {
  U: '#ffffff', D: '#ffd500', F: '#c41e3a',
  B: '#ff5800', L: '#0051ba', R: '#009e60',
} as const;

// ── 3D Cube Component ──
function Cube3D({ rotationX, rotationY }: { rotationX: number; rotationY: number }) {
  const cubies = useMemo(() => {
    const result: { x: number; y: number; z: number; colors: Record<string, string> }[] = [];
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          const colors: Record<string, string> = {};
          if (y === 1) colors.top = FACE_COLORS.U;
          if (y === -1) colors.bottom = FACE_COLORS.D;
          if (z === 1) colors.front = FACE_COLORS.F;
          if (z === -1) colors.back = FACE_COLORS.B;
          if (x === 1) colors.right = FACE_COLORS.R;
          if (x === -1) colors.left = FACE_COLORS.L;
          result.push({ x, y, z, colors });
        }
      }
    }
    return result;
  }, []);

  return (
    <div className="cube-scene" style={{ perspective: '600px', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        className="cube-container"
        style={{
          width: '120px',
          height: '120px',
          position: 'relative',
          transformStyle: 'preserve-3d',
          transform: `rotateX(${rotationX}deg) rotateY(${rotationY}deg)`,
          transition: 'transform 0.1s ease-out',
        }}
      >
        {cubies.map(({ x, y, z, colors }, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              width: '36px',
              height: '36px',
              transformStyle: 'preserve-3d',
              transform: `translate3d(${x * 38 + 42}px, ${-y * 38 + 42}px, ${z * 38}px)`,
            }}
          >
            {/* Each face of the cubie */}
            {Object.entries({
              top: { transform: 'rotateX(90deg) translateZ(18px)', color: colors.top },
              bottom: { transform: 'rotateX(-90deg) translateZ(18px)', color: colors.bottom },
              front: { transform: 'translateZ(18px)', color: colors.front },
              back: { transform: 'rotateY(180deg) translateZ(18px)', color: colors.back },
              right: { transform: 'rotateY(90deg) translateZ(18px)', color: colors.right },
              left: { transform: 'rotateY(-90deg) translateZ(18px)', color: colors.left },
            }).map(([face, { transform, color }]) => (
              <div
                key={face}
                style={{
                  position: 'absolute',
                  width: '36px',
                  height: '36px',
                  transform,
                  background: color || '#1a1a2e',
                  border: '1.5px solid #0a0a1a',
                  borderRadius: '3px',
                  boxSizing: 'border-box',
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Safari Detection ──
function detectBrowser() {
  if (typeof window === 'undefined') return { isSafari: false, supportsBluetooth: false };
  const ua = navigator.userAgent;
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
  const supportsBluetooth = 'bluetooth' in navigator;
  return { isSafari, supportsBluetooth };
}

// ── Main Component ──
export default function RubikCubeTrainer() {
  // State
  const [currentCategory, setCurrentCategory] = useState<string>('OLL');
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
  const [cubeRotationX, setCubeRotationX] = useState(-25);
  const [cubeRotationY, setCubeRotationY] = useState(35);
  const [browserInfo, setBrowserInfo] = useState({ isSafari: false, supportsBluetooth: false });
  const [difficulty, setDifficulty] = useState<string>('all');
  const [highlightedStep, setHighlightedStep] = useState(-1);

  const startTimeRef = useRef<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const logIdRef = useRef(0);
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  // Detect browser
  useEffect(() => {
    setBrowserInfo(detectBrowser());
  }, []);

  // Add log
  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    logIdRef.current++;
    setLogs(prev => [{ id: logIdRef.current, time: new Date().toLocaleTimeString(), message, type }, ...prev].slice(0, 50));
  }, []);

  // Filter formulas
  const formulas = useMemo(() => {
    const list = formulaLibrary[currentCategory] || [];
    if (difficulty === 'all') return list;
    return list.filter(f => f.difficulty === difficulty);
  }, [currentCategory, difficulty]);

  // Select formula
  const selectFormula = useCallback((id: string) => {
    const formula = formulas.find(f => f.id === id);
    if (formula) {
      setCurrentFormula(formula);
      setUserMoves([]);
      setWrongMoves(new Set());
      setHighlightedStep(-1);
      addLog(`已选择: ${formula.id} ${formula.name}`, 'info');
    }
  }, [formulas, addLog]);

  // Start practice
  const startPractice = useCallback(() => {
    if (!currentFormula) {
      addLog('请先选择一个公式', 'error');
      return;
    }
    setIsPracticing(true);
    setUserMoves([]);
    setWrongMoves(new Set());
    setHighlightedStep(0);
    setStats({ correct: 0, wrong: 0, streak: 0, bestStreak: 0 });
    setElapsedTime(0);
    startTimeRef.current = Date.now();
    addLog(`开始练习: ${currentFormula.id}`, 'success');
    timerRef.current = setInterval(() => {
      if (startTimeRef.current) {
        setElapsedTime(parseFloat(((Date.now() - startTimeRef.current) / 1000).toFixed(1)));
      }
    }, 100);
  }, [currentFormula, addLog]);

  // Check move
  const checkUserMove = useCallback((move: string) => {
    if (!currentFormula || !isPracticing) return;
    const expectedMoves = currentFormula.formula.split(' ');
    const idx = userMoves.length;
    if (idx >= expectedMoves.length) return;

    const expected = expectedMoves[idx].replace(/\s+/g, '').toUpperCase();
    const actual = move.replace(/\s+/g, '').toUpperCase();
    const isCorrect = actual === expected;

    if (isCorrect) {
      setStats(prev => {
        const newStreak = prev.streak + 1;
        return { correct: prev.correct + 1, wrong: prev.wrong, streak: newStreak, bestStreak: Math.max(prev.bestStreak, newStreak) };
      });
      addLog(`✅ 步骤${idx + 1}: ${move}`, 'success');
      setHighlightedStep(idx + 1);
    } else {
      setStats(prev => ({ ...prev, wrong: prev.wrong + 1, streak: 0 }));
      setWrongMoves(prev => new Set(prev).add(idx));
      addLog(`❌ 步骤${idx + 1}: 期望 ${expectedMoves[idx]}，实际 ${move}`, 'error');
    }

    setUserMoves(prev => [...prev, move]);

    if (idx + 1 === expectedMoves.length && isCorrect) {
      const time = ((Date.now() - (startTimeRef.current || Date.now())) / 1000).toFixed(1);
      addLog(`🎉 完美完成！用时 ${time} 秒`, 'success');
      setIsPracticing(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [currentFormula, isPracticing, userMoves, addLog]);

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

  // Connect cube
  const connectCube = useCallback(async () => {
    if (isConnecting) return;
    setIsConnecting(true);
    addLog('正在搜索奇艺智能魔方...', 'info');

    if (!browserInfo.supportsBluetooth) {
      if (browserInfo.isSafari) {
        addLog('Safari 不支持 Web Bluetooth，请使用 Chrome/Edge 浏览器', 'error');
      } else {
        addLog('当前浏览器不支持 Web Bluetooth，请使用 Chrome 56+', 'error');
      }
      setIsConnecting(false);
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bluetooth = (navigator as unknown as { bluetooth: { requestDevice: (options: Record<string, unknown>) => Promise<{ name: string }> } }).bluetooth;
      const device = await bluetooth.requestDevice({
        filters: [
          { namePrefix: 'QY' },
          { namePrefix: 'Qiyi' },
          { namePrefix: 'Giiker' },
          { namePrefix: 'Mi Smart' },
        ],
        optionalServices: ['0000fff0-0000-1000-8000-00805f9b34fb'],
      });
      addLog(`找到设备: ${device.name}`, 'success');
      setIsConnected(true);
      setConnectionStatus(`已连接: ${device.name}`);
      addLog('✅ 魔方连接成功！', 'success');

      // TODO: Set up GATT characteristic notifications for real-time cube state
      // const server = await device.gatt.connect();
      // const service = await server.getPrimaryService('0000fff0-0000-1000-8000-00805f9b34fb');
      // const characteristic = await service.getCharacteristic('0000fff6-0000-1000-8000-00805f9b34fb');
      // characteristic.addEventListener('characteristicvaluechanged', handleCubeData);
      // await characteristic.startNotifications();
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
  }, [isConnecting, addLog, browserInfo]);

  // Cleanup
  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // Progress
  const progress = currentFormula ? (userMoves.length / currentFormula.formula.split(' ').length) * 100 : 0;

  // Mouse drag for 3D rotation
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    setCubeRotationY(prev => prev + dx * 0.5);
    setCubeRotationX(prev => prev - dy * 0.5);
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseUp = useCallback(() => { isDragging.current = false; }, []);

  // Difficulty label & color
  const diffMeta = (d?: string) => {
    switch (d) {
      case 'beginner': return { label: '初级', cls: 'bg-green-500/20 text-green-400 border-green-500/30' };
      case 'intermediate': return { label: '中级', cls: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' };
      case 'advanced': return { label: '高级', cls: 'bg-red-500/20 text-red-400 border-red-500/30' };
      default: return { label: '全部', cls: '' };
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 text-white">
      {/* Safari Warning Banner */}
      {browserInfo.isSafari && !browserInfo.supportsBluetooth && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-3 text-center">
          <p className="text-amber-300 text-sm">
            ⚠️ <strong>Safari 不支持蓝牙连接</strong> — 请使用 <strong>Chrome</strong> 或 <strong>Edge</strong> 浏览器连接智能魔方。
            你仍然可以使用手动模式练习公式。
          </p>
        </div>
      )}

      {/* Header */}
      <header className="py-6 px-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
              🎲 魔方速拧公式训练
            </h1>
            <p className="text-gray-500 text-sm mt-1">CFOP · OLL · PLL · F2L 交互式学习系统</p>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs ${isConnected ? 'bg-green-500/10 text-green-400 border border-green-500/30' : 'bg-white/5 text-gray-400 border border-white/10'}`}>
              <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`} />
              {connectionStatus}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 pb-8 grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* ── Left: Formula Library ── */}
        <div className="lg:col-span-3 bg-white/[0.03] backdrop-blur-xl rounded-2xl border border-white/[0.06] overflow-hidden">
          <div className="p-5 border-b border-white/[0.06]">
            <h2 className="text-lg font-semibold flex items-center gap-2">📚 公式库</h2>
          </div>

          {/* Category Tabs */}
          <div className="flex gap-1 p-3 border-b border-white/[0.06]">
            {Object.keys(formulaLibrary).map(cat => (
              <button
                key={cat}
                onClick={() => { setCurrentCategory(cat); setCurrentFormula(null); setUserMoves([]); }}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                  currentCategory === cat ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20' : 'text-gray-400 hover:text-white hover:bg-white/[0.06]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Difficulty Filter */}
          <div className="flex gap-1 px-3 py-2 border-b border-white/[0.06]">
            {['all', 'beginner', 'intermediate', 'advanced'].map(d => {
              const meta = diffMeta(d === 'all' ? undefined : d);
              return (
                <button
                  key={d}
                  onClick={() => setDifficulty(d)}
                  className={`px-2.5 py-1 text-xs rounded-md transition-all ${
                    difficulty === d ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {d === 'all' ? '全部' : meta.label}
                </button>
              );
            })}
          </div>

          {/* Formula List */}
          <div className="p-2 space-y-1 max-h-[calc(100vh-320px)] overflow-y-auto">
            {formulas.map(f => {
              const meta = diffMeta(f.difficulty);
              return (
                <div
                  key={f.id}
                  onClick={() => selectFormula(f.id)}
                  className={`p-3 rounded-xl cursor-pointer transition-all border ${
                    currentFormula?.id === f.id
                      ? 'bg-cyan-500/10 border-cyan-500/30 shadow-lg shadow-cyan-500/5'
                      : 'border-transparent hover:bg-white/[0.04] hover:border-white/[0.06]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-cyan-400">{f.id}</span>
                    {f.difficulty && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${meta.cls}`}>
                        {meta.label}
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-sm text-amber-300 leading-relaxed">{f.formula}</div>
                  <div className="text-xs text-gray-500 mt-1">{f.name} · {f.description}</div>
                </div>
              );
            })}
            {formulas.length === 0 && (
              <div className="text-center text-gray-500 py-8 text-sm">该难度暂无公式</div>
            )}
          </div>
        </div>

        {/* ── Center: 3D Visualization ── */}
        <div className="lg:col-span-5 space-y-5">
          {/* 3D Cube */}
          <div className="bg-white/[0.03] backdrop-blur-xl rounded-2xl border border-white/[0.06] overflow-hidden">
            <div className="p-4 border-b border-white/[0.06] flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-300">3D 魔方预览</h2>
              <div className="flex gap-1">
                {['U', 'D', 'R', 'L', 'F', 'B'].map(face => (
                  <button
                    key={face}
                    onClick={() => {
                      // Animate rotation on click
                      const angles: Record<string, [number, number]> = {
                        U: [0, 90], D: [0, -90], R: [90, 0], L: [-90, 0], F: [0, 0], B: [180, 0],
                      };
                      const [dx, dy] = angles[face];
                      setCubeRotationX(prev => prev + dx * 0.3);
                      setCubeRotationY(prev => prev + dy * 0.3);
                    }}
                    className="w-7 h-7 text-xs font-mono bg-white/[0.06] hover:bg-cyan-500/20 hover:text-cyan-400 rounded-md transition-all"
                  >
                    {face}
                  </button>
                ))}
              </div>
            </div>
            <div
              className="h-[320px] select-none cursor-grab active:cursor-grabbing"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <Cube3D rotationX={cubeRotationX} rotationY={cubeRotationY} />
            </div>
            <div className="px-4 pb-3 text-center">
              <p className="text-[11px] text-gray-600">拖拽旋转 · 点击面按钮快速切换视角</p>
            </div>
          </div>

          {/* Quick Practice Panel */}
          <div className="bg-white/[0.03] backdrop-blur-xl rounded-2xl border border-white/[0.06] p-5">
            <h3 className="text-sm font-medium text-gray-300 mb-3">🎮 手动录入旋转</h3>
            <p className="text-xs text-gray-500 mb-3">
              {browserInfo.isSafari
                ? 'Safari 不支持蓝牙，请手动点击按钮录入每一步操作'
                : '未连接魔方时，可手动点击按钮录入操作'}
            </p>
            <div className="grid grid-cols-6 gap-2">
              {["U", "U'", "U2", "D", "D'", "D2", "R", "R'", "R2", "L", "L'", "L2", "F", "F'", "F2", "B", "B'", "B2"].map(move => (
                <button
                  key={move}
                  onClick={() => checkUserMove(move)}
                  disabled={!isPracticing}
                  className="py-2.5 text-sm font-mono bg-white/[0.06] hover:bg-cyan-500/20 hover:text-cyan-400 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition-all active:scale-95"
                >
                  {move}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right: Practice Panel ── */}
        <div className="lg:col-span-4 space-y-5">
          {/* Connection */}
          <div className="bg-white/[0.03] backdrop-blur-xl rounded-2xl border border-white/[0.06] p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : isConnecting ? 'bg-amber-400 animate-pulse' : 'bg-gray-600'}`} />
                <span className="text-sm text-gray-300">{connectionStatus}</span>
              </div>
              <button
                onClick={connectCube}
                disabled={isConnecting || (browserInfo.isSafari && !browserInfo.supportsBluetooth)}
                className="px-4 py-2 text-sm font-medium bg-gradient-to-r from-cyan-500 to-blue-500 rounded-lg hover:shadow-lg hover:shadow-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isConnecting ? '搜索中...' : isConnected ? '已连接' : '🔗 连接魔方'}
              </button>
            </div>
          </div>

          {/* Current Formula & Steps */}
          <div className="bg-white/[0.03] backdrop-blur-xl rounded-2xl border border-white/[0.06] p-5">
            <h2 className="text-lg font-semibold mb-4">🎯 练习模式</h2>

            {currentFormula ? (
              <>
                <div className="mb-4 p-4 bg-black/20 rounded-xl border border-white/[0.04]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-cyan-400">{currentFormula.id}: {currentFormula.name}</span>
                    {currentFormula.difficulty && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${diffMeta(currentFormula.difficulty).cls}`}>
                        {diffMeta(currentFormula.difficulty).label}
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-xl text-amber-300 tracking-wider">{currentFormula.formula}</div>
                  <div className="text-xs text-gray-500 mt-2">{currentFormula.description}</div>
                </div>

                {/* Step indicators */}
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {currentFormula.formula.split(' ').map((move, i) => {
                    const isDone = i < userMoves.length;
                    const isWrong = wrongMoves.has(i);
                    const isCurrent = i === highlightedStep && isPracticing;
                    return (
                      <span
                        key={i}
                        className={`inline-flex items-center justify-center w-10 h-10 text-sm font-mono font-bold rounded-lg transition-all duration-200 ${
                          isCurrent
                            ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/30 scale-110'
                            : isDone && !isWrong
                            ? 'bg-green-500/80 text-white'
                            : isWrong
                            ? 'bg-red-500/80 text-white'
                            : 'bg-white/[0.06] text-gray-400'
                        }`}
                      >
                        {move}
                      </span>
                    );
                  })}
                </div>

                {/* Progress bar */}
                <div className="w-full h-1.5 bg-white/[0.06] rounded-full mb-4 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-green-400 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <div className="text-4xl mb-2">👆</div>
                <p className="text-sm">在左侧选择一个公式开始练习</p>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={startPractice}
                disabled={!currentFormula || isPracticing}
                className="flex-1 py-3 text-sm font-semibold bg-gradient-to-r from-cyan-500 to-blue-500 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-cyan-500/20 transition-all active:scale-[0.98]"
              >
                {isPracticing ? '练习中...' : '▶ 开始练习'}
              </button>
              <button
                onClick={resetPractice}
                className="px-6 py-3 text-sm font-semibold bg-white/[0.06] hover:bg-white/[0.1] rounded-xl transition-all active:scale-[0.98]"
              >
                ↺ 重置
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: '正确', value: stats.correct, color: 'text-cyan-400' },
              { label: '错误', value: stats.wrong, color: 'text-red-400' },
              { label: '用时', value: `${elapsedTime}s`, color: 'text-amber-400' },
              { label: '连击', value: stats.streak, color: 'text-green-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white/[0.03] backdrop-blur-xl rounded-xl border border-white/[0.06] p-3 text-center">
                <div className={`text-2xl font-bold ${color}`}>{value}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>

          {/* Logs */}
          <div className="bg-white/[0.03] backdrop-blur-xl rounded-2xl border border-white/[0.06] overflow-hidden">
            <div className="p-4 border-b border-white/[0.06]">
              <h3 className="text-sm font-medium text-gray-300">📋 操作日志</h3>
            </div>
            <div className="p-3 max-h-[180px] overflow-y-auto font-mono text-xs space-y-0.5">
              {logs.length === 0 ? (
                <div className="text-gray-600 text-center py-4">暂无日志</div>
              ) : (
                logs.map(log => (
                  <div
                    key={log.id}
                    className={`py-0.5 ${
                      log.type === 'success' ? 'text-green-400' : log.type === 'error' ? 'text-red-400' : log.type === 'warning' ? 'text-amber-400' : 'text-gray-400'
                    }`}
                  >
                    <span className="text-gray-600">[{log.time}]</span> {log.message}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
