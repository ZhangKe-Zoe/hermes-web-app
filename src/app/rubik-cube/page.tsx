'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// 公式库类型定义
interface Formula {
  id: string;
  name: string;
  formula: string;
  description: string;
}

// 公式库数据
const formulaLibrary: Record<string, Formula[]> = {
  OLL: [
    { id: 'OLL-1', name: '点 → 十字', formula: "F R U R' U' F'", description: '顶层十字情况' },
    { id: 'OLL-2', name: '点 → 十字', formula: "F U R U' R' F'", description: '另一种十字情况' },
    { id: 'OLL-3', name: '十字 → 全黄', formula: "R U R' U R U2 R'", description: '鱼形情况' },
    { id: 'OLL-4', name: '十字 → 全黄', formula: "R U2 R' U' R U' R'", description: '另一种鱼形' },
    { id: 'OLL-21', name: '十字 + 两侧', formula: "R U2 R' U' R U R' U' R U' R'", description: '21号OLL' },
    { id: 'OLL-22', name: '十字 + 两侧', formula: "R U2 R2 U' R2 U' R2 U2 R", description: '22号OLL' },
    { id: 'OLL-23', name: '十字 + 对角', formula: "R2 D R' U2 R D' R' U2 R'", description: '23号OLL' },
    { id: 'OLL-24', name: '十字 + 对角', formula: "r U R' U' r' F R F'", description: '24号OLL' },
    { id: 'OLL-25', name: '十字 + 一字', formula: "F' r U R' U' r' F R", description: '25号OLL' },
    { id: 'OLL-26', name: '十字 + 一字', formula: "R U2 R' U' R U' R'", description: '反鱼形' },
    { id: 'OLL-27', name: '全黄', formula: "R U R' U R U2 R'", description: '正鱼形' },
    { id: 'OLL-57', name: '全黄', formula: "R U R' U' M' U R U' r'", description: '57号OLL' },
  ],
  PLL: [
    { id: 'PLL-Ua', name: 'Ua排列', formula: "R U R' U R' U' R2 U' R' U R' U R", description: '顺时针三棱换' },
    { id: 'PLL-Ub', name: 'Ub排列', formula: "R' U R' U' R2 U' R' U R U R2", description: '逆时针三棱换' },
    { id: 'PLL-H', name: 'H排列', formula: "M2 U M2 U2 M2 U M2", description: '对棱换' },
    { id: 'PLL-Z', name: 'Z排列', formula: "M2 U M2 U M' U2 M2 U2 M'", description: '邻棱换' },
    { id: 'PLL-Aa', name: 'Aa排列', formula: "R' F R' B2 R F' R' B2 R2", description: '三角换顺时针' },
    { id: 'PLL-Ab', name: 'Ab排列', formula: "R2 B2 R F R' B2 R F' R", description: '三角换逆时针' },
    { id: 'PLL-T', name: 'T排列', formula: "R U R' U' R' F R2 U' R' U' R U R' F'", description: 'T排列' },
    { id: 'PLL-Y', name: 'Y排列', formula: "F R U' R' U' R U R' F' R U R' U' R' F R F'", description: 'Y排列' },
  ],
  F2L: [
    { id: 'F2L-1', name: '基础情况1', formula: "U R U' R'", description: '角块在底层，棱在顶层' },
    { id: 'F2L-2', name: '基础情况2', formula: "U' F' U F", description: '角块在底层，棱在顶层' },
    { id: 'F2L-3', name: '基础情况3', formula: "R U' R'", description: '角块棱块都在底层' },
    { id: 'F2L-4', name: '基础情况4', formula: "F' U F", description: '角块棱块都在底层' },
    { id: 'F2L-5', name: '角块朝上', formula: "R U2 R' U' R U R'", description: '角块白色朝上' },
    { id: 'F2L-6', name: '角块朝上', formula: "F' U2 F U F' U' F", description: '角块白色朝上' },
    { id: 'F2L-7', name: '棱块已就位', formula: "R U R' U' R U R'", description: '棱块已到位，角块需调整' },
    { id: 'F2L-8', name: '棱块已就位', formula: "F' U' F U F' U' F", description: '棱块已到位，角块需调整' },
  ],
};

// 统计数据类型
interface Stats {
  correct: number;
  wrong: number;
  streak: number;
  bestStreak: number;
}

// 日志条目类型
interface LogEntry {
  time: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

export default function RubikCubeTrainer() {
  // 状态管理
  const [currentCategory, setCurrentCategory] = useState<string>('OLL');
  const [currentFormula, setCurrentFormula] = useState<Formula | null>(null);
  const [isPracticing, setIsPracticing] = useState(false);
  const [userMoves, setUserMoves] = useState<string[]>([]);
  const [stats, setStats] = useState<Stats>({ correct: 0, wrong: 0, streak: 0, bestStreak: 0 });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('未连接');
  const [currentRotation] = useState('等待魔方数据...');

  const startTimeRef = useRef<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 添加日志
  const addLog = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [{ time, message, type }, ...prev].slice(0, 50));
  }, []);

  // 选择公式
  const selectFormula = useCallback((id: string) => {
    const formulas = formulaLibrary[currentCategory];
    const formula = formulas.find(f => f.id === id);
    if (formula) {
      setCurrentFormula(formula);
      addLog(`已选择公式: ${formula.id}`, 'info');
    }
  }, [currentCategory, addLog]);

  // 开始练习
  const startPractice = useCallback(() => {
    if (!currentFormula) {
      addLog('请先选择一个公式', 'error');
      return;
    }

    setIsPracticing(true);
    setUserMoves([]);
    startTimeRef.current = Date.now();
    setStats({ correct: 0, wrong: 0, streak: 0, bestStreak: 0 });
    setElapsedTime(0);

    addLog(`开始练习: ${currentFormula.id}`, 'success');

    // 启动计时器
    timerRef.current = setInterval(() => {
      if (startTimeRef.current) {
        setElapsedTime(((Date.now() - startTimeRef.current) / 1000).toFixed(1) as unknown as number);
      }
    }, 100);
  }, [currentFormula, addLog]);

  // 检查用户操作
  const checkUserMove = useCallback((_move: string) => {
    if (!currentFormula || !isPracticing) return;

    const expectedMoves = currentFormula.formula.split(' ');
    const currentIndex = userMoves.length;

    if (currentIndex >= expectedMoves.length) {
      addLog('公式已完成！', 'success');
      setIsPracticing(false);
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    const expected = expectedMoves[currentIndex];
    const isCorrect = _move.replace(/\s+/g, '').toUpperCase() === expected.replace(/\s+/g, '').toUpperCase();

    if (isCorrect) {
      setStats(prev => {
        const newStreak = prev.streak + 1;
        return {
          correct: prev.correct + 1,
          wrong: prev.wrong,
          streak: newStreak,
          bestStreak: Math.max(prev.bestStreak, newStreak),
        };
      });
      addLog(`✅ 步骤${currentIndex + 1}: ${_move} 正确`, 'success');
    } else {
      setStats(prev => ({
        correct: prev.correct,
        wrong: prev.wrong + 1,
        streak: 0,
        bestStreak: prev.bestStreak,
      }));
      addLog(`❌ 步骤${currentIndex + 1}: 期望 ${expected}，实际 ${_move}`, 'error');
    }

    setUserMoves(prev => [...prev, _move]);

    // 检查是否完成
    if (currentIndex + 1 === expectedMoves.length && isCorrect) {
      const time = ((Date.now() - (startTimeRef.current || Date.now())) / 1000).toFixed(1);
      addLog(`🎉 完美完成！用时 ${time} 秒`, 'success');
      setIsPracticing(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [currentFormula, isPracticing, userMoves, addLog]);

  // 重置练习
  const resetPractice = useCallback(() => {
    setIsPracticing(false);
    setUserMoves([]);
    setStats({ correct: 0, wrong: 0, streak: 0, bestStreak: 0 });
    setElapsedTime(0);
    startTimeRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    addLog('练习已重置', 'info');
  }, [addLog]);

  // 连接魔方（模拟）
  const connectCube = useCallback(async () => {
    addLog('正在搜索奇艺智能魔方...', 'info');

    // 检查是否支持 Web Bluetooth
    if (typeof navigator !== 'undefined' && 'bluetooth' in navigator) {
      try {
        const device = await (navigator as unknown as { bluetooth: { requestDevice: (options: unknown) => Promise<{ name: string }> } }).bluetooth.requestDevice({
          filters: [
            { namePrefix: 'QY' },
            { namePrefix: 'Qiyi' },
            { namePrefix: 'Giiker' },
          ],
          optionalServices: ['0000fff0-0000-1000-8000-00805f9b34fb'],
        });

        addLog(`找到设备: ${device.name}`, 'success');
        setIsConnected(true);
        setConnectionStatus(`已连接: ${device.name}`);
        addLog('✅ 魔方连接成功！', 'success');
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : '未知错误';
        addLog(`连接失败: ${errorMessage}`, 'error');
      }
    } else {
      addLog('当前浏览器不支持 Web Bluetooth，请使用 Chrome', 'error');
    }
  }, [addLog]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // 计算进度
  const progress = currentFormula
    ? (userMoves.length / currentFormula.formula.split(' ').length) * 100
    : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900 text-white">
      {/* 标题 */}
      <header className="text-center py-6">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
          🎲 魔方速拧公式交互式学习系统
        </h1>
      </header>

      <div className="container mx-auto px-4 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧面板：公式库 */}
        <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4">📚 公式库</h2>

          {/* 分类标签 */}
          <div className="flex gap-2 mb-4">
            {Object.keys(formulaLibrary).map(category => (
              <button
                key={category}
                onClick={() => {
                  setCurrentCategory(category);
                  setCurrentFormula(null);
                }}
                className={`px-4 py-2 rounded-full transition-all ${
                  currentCategory === category
                    ? 'bg-cyan-500 text-black'
                    : 'bg-white/10 hover:bg-white/20'
                }`}
              >
                {category}
              </button>
            ))}
          </div>

          {/* 公式列表 */}
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {formulaLibrary[currentCategory].map(formula => (
              <div
                key={formula.id}
                onClick={() => selectFormula(formula.id)}
                className={`p-4 rounded-lg cursor-pointer transition-all border ${
                  currentFormula?.id === formula.id
                    ? 'bg-cyan-500/20 border-cyan-500'
                    : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-cyan-400'
                }`}
              >
                <div className="font-semibold text-cyan-400">
                  {formula.id}: {formula.name}
                </div>
                <div className="font-mono text-lg text-yellow-400 mt-1">
                  {formula.formula}
                </div>
                <div className="text-sm opacity-70 mt-1">{formula.description}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 中间面板：3D可视化 */}
        <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6">
          {/* 状态栏 */}
          <div className="flex justify-between items-center bg-black/30 rounded-lg p-3 mb-4">
            <div className="flex items-center">
              <span
                className={`w-3 h-3 rounded-full mr-2 ${
                  isConnected ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
              <span>{connectionStatus}</span>
            </div>
            <button
              onClick={connectCube}
              className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-lg hover:shadow-lg transition-all"
            >
              连接魔方
            </button>
          </div>

          {/* 3D魔方占位 */}
          <div className="w-full h-[400px] bg-black/20 rounded-lg flex items-center justify-center mb-4">
            <div className="text-center">
              <div className="text-6xl mb-4">🎲</div>
              <p className="text-gray-400">3D魔方可视化区域</p>
              <p className="text-sm text-gray-500">连接魔方后将显示实时状态</p>
            </div>
          </div>

          {/* 当前旋转显示 */}
          <div className="bg-black/30 rounded-lg p-4 text-center">
            <div className="text-2xl font-mono text-yellow-400">{currentRotation}</div>
          </div>
        </div>

        {/* 右侧面板：练习控制 */}
        <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-4">🎯 练习模式</h2>

          {/* 当前公式 */}
          <div className="mb-4">
            {currentFormula ? (
              <>
                <h3 className="text-lg font-semibold">
                  {currentFormula.id}: {currentFormula.name}
                </h3>
                <p className="font-mono text-xl text-yellow-400 my-2">
                  {currentFormula.formula}
                </p>
                <p className="text-sm opacity-80">{currentFormula.description}</p>
              </>
            ) : (
              <p className="text-gray-400">选择一个公式开始练习</p>
            )}
          </div>

          {/* 步骤指示器 */}
          {currentFormula && (
            <div className="flex flex-wrap gap-2 mb-4">
              {currentFormula.formula.split(' ').map((move, index) => {
                const isCompleted = index < userMoves.length;
                const isCurrent = index === userMoves.length && isPracticing;
                const isWrong = isCompleted && false; // 需要更复杂的逻辑来跟踪错误

                return (
                  <span
                    key={index}
                    className={`inline-block w-10 h-10 leading-10 text-center rounded font-bold transition-all ${
                      isCurrent
                        ? 'bg-cyan-500 text-black scale-110'
                        : isCompleted
                        ? 'bg-green-500'
                        : isWrong
                        ? 'bg-red-500'
                        : 'bg-white/10'
                    }`}
                  >
                    {move}
                  </span>
                );
              })}
            </div>
          )}

          {/* 进度条 */}
          <div className="w-full h-2 bg-white/10 rounded-full mb-4 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-green-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-3 mb-4">
            <button
              onClick={startPractice}
              disabled={!currentFormula || isPracticing}
              className="flex-1 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg transition-all"
            >
              开始练习
            </button>
            <button
              onClick={resetPractice}
              className="flex-1 py-3 bg-gradient-to-r from-red-500 to-pink-500 rounded-lg hover:shadow-lg transition-all"
            >
              重置
            </button>
          </div>

          {/* 统计数据 */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-black/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-cyan-400">{stats.correct}</div>
              <div className="text-xs opacity-70">正确步骤</div>
            </div>
            <div className="bg-black/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-red-400">{stats.wrong}</div>
              <div className="text-xs opacity-70">错误步骤</div>
            </div>
            <div className="bg-black/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-yellow-400">{elapsedTime}s</div>
              <div className="text-xs opacity-70">用时</div>
            </div>
            <div className="bg-black/20 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-green-400">{stats.streak}</div>
              <div className="text-xs opacity-70">连击</div>
            </div>
          </div>

          {/* 操作日志 */}
          <h3 className="font-semibold mb-2">📋 操作日志</h3>
          <div className="bg-black/30 rounded-lg p-3 max-h-[150px] overflow-y-auto font-mono text-xs">
            {logs.length === 0 ? (
              <div className="text-gray-500">暂无日志</div>
            ) : (
              logs.map((log, index) => (
                <div
                  key={index}
                  className={`py-1 ${
                    log.type === 'info'
                      ? 'text-cyan-400'
                      : log.type === 'success'
                      ? 'text-green-400'
                      : 'text-red-400'
                  }`}
                >
                  [{log.time}] {log.message}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
