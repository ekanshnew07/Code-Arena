import React, { useCallback, useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import Editor from '@monaco-editor/react';
import {
  Swords,
  Lock,
  Clock,
  Shield,
  ArrowLeft,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  Trophy,
  RotateCcw,
  Zap,
  Play,
  Crosshair,
  ChevronRight,
  Info,
} from 'lucide-react';
import { ArenaScene } from '../../game/scenes/ArenaScene';
import { PvPBattleController } from '../../game/pvp/PvPBattleController';
import {
  DEFAULT_PVP_CONFIG,
  PvPBattleSnapshot,
  PvPInstruction,
  PvPPhase,
  PvPPlayerId,
} from '../../game/pvp/pvpTypes';
import { validatePvPProgram } from '../../game/pvp/pvpValidator';
import { CombatEventEntry, GridPosition } from '../../types/game';

interface PvPModeLayoutProps {
  onReturnToMainMenu: () => void;
}

export const PvPModeLayout: React.FC<PvPModeLayoutProps> = ({
  onReturnToMainMenu,
}) => {
  const config = DEFAULT_PVP_CONFIG;

  const [phase, setPhase] = useState<PvPPhase>('SETUP');
  const [p1Name, setP1Name] = useState<string>('Player 1');
  const [p2Name, setP2Name] = useState<string>('Player 2');

  // Active editor state for current player's planning turn (cleared every round!)
  const [editorCode, setEditorCode] = useState<string>('');
  const [lockError, setLockError] = useState<{
    line: number;
    message: string;
  } | null>(null);
  const [programmingSecondsLeft, setProgrammingSecondsLeft] = useState<number>(
    config.programmingTimeSeconds
  );
  const [roundCountdown, setRoundCountdown] = useState<number>(3);

  const [combatEvents, setCombatEvents] = useState<CombatEventEntry[]>([]);
  const [hoveredCell, setHoveredCell] = useState<GridPosition | null>(null);

  // Privately stored validated programs for current round
  const p1LockedProgramRef = useRef<PvPInstruction[]>([]);
  const p2LockedProgramRef = useRef<PvPInstruction[]>([]);
  const lastValidTurnProgramRef = useRef<PvPInstruction[]>([]);

  // Battle controller and state
  const battleControllerRef = useRef<PvPBattleController | null>(null);
  if (!battleControllerRef.current) {
    battleControllerRef.current = new PvPBattleController(
      {
        onSnapshotChange: (nextSnap) => {
          setBattleSnapshot(nextSnap);
        },
        onCombatEventsChange: (nextEvents) => {
          setCombatEvents(nextEvents);
        },
        onRoundFinished: (finalSnap) => {
          setBattleSnapshot(finalSnap);
          if (!finalSnap.isBattleFinished) {
            setPhase('ROUND_INTERMISSION');
          }
        },
        onBattleFinished: (finalSnap) => {
          setBattleSnapshot(finalSnap);
          setPhase('RESULTS');
        },
      },
      config
    );
  }
  const battleController = battleControllerRef.current;

  const [battleSnapshot, setBattleSnapshot] = useState<PvPBattleSnapshot>(() =>
    battleController.getSnapshot()
  );

  const phaserContainerRef = useRef<HTMLDivElement | null>(null);
  const phaserGameRef = useRef<Phaser.Game | null>(null);
  const combatLogEndRef = useRef<HTMLDivElement | null>(null);

  // Live validation of current editor code (max 5 slots)
  const liveValidation = validatePvPProgram(editorCode, config, false);

  // Whenever the player's editor code is valid (or empty), store as fallback
  useEffect(() => {
    if (phase !== 'P1_PROGRAMMING' && phase !== 'P2_PROGRAMMING') return;
    const check = validatePvPProgram(editorCode, config, true);
    if (check.valid) {
      lastValidTurnProgramRef.current = check.instructions;
    }
  }, [editorCode, phase, config]);

  // Start Player 1 planning turn (fresh program every round)
  const startP1Programming = useCallback(() => {
    p1LockedProgramRef.current = [];
    p2LockedProgramRef.current = [];
    lastValidTurnProgramRef.current = [];
    setEditorCode('');
    setLockError(null);
    setProgrammingSecondsLeft(config.programmingTimeSeconds);
    setPhase('P1_PROGRAMMING');
  }, [config.programmingTimeSeconds]);

  // Start Player 2 planning turn (fresh program every round)
  const startP2Programming = useCallback(() => {
    lastValidTurnProgramRef.current = [];
    setEditorCode('');
    setLockError(null);
    setProgrammingSecondsLeft(config.programmingTimeSeconds);
    setPhase('P2_PROGRAMMING');
  }, [config.programmingTimeSeconds]);

  // Handle starting a fresh match from SETUP
  const handleStartMatch = () => {
    battleController.resetMatch(
      p1Name.trim() || 'Player 1',
      p2Name.trim() || 'Player 2'
    );
    startP1Programming();
  };

  // Advance to next round when intermission finishes
  const handleAdvanceToNextRound = useCallback(() => {
    battleController.advanceToNextRound();
    startP1Programming();
  }, [battleController, startP1Programming]);

  // Manual LOCK PROGRAM button handler
  const handleLockProgram = () => {
    const res = validatePvPProgram(editorCode, config, false);
    if (!res.valid) {
      setLockError(
        res.error ?? {
          line: 1,
          message: 'Please fix syntax or slot limit errors before locking.',
        }
      );
      return;
    }

    if (phase === 'P1_PROGRAMMING') {
      p1LockedProgramRef.current = res.instructions;
      setEditorCode('');
      setLockError(null);
      lastValidTurnProgramRef.current = [];
      setPhase('HANDOVER');
    } else if (phase === 'P2_PROGRAMMING') {
      p2LockedProgramRef.current = res.instructions;
      setEditorCode('');
      setLockError(null);
      lastValidTurnProgramRef.current = [];
      setPhase('ROUND_COUNTDOWN');
    }
  };

  // Auto-lock when 30-second programming timer expires
  const handleProgrammingTimerExpired = useCallback(() => {
    const checkCurrent = validatePvPProgram(editorCode, config, true);
    const resolvedProgram = checkCurrent.valid
      ? checkCurrent.instructions
      : lastValidTurnProgramRef.current;

    if (phase === 'P1_PROGRAMMING') {
      p1LockedProgramRef.current = resolvedProgram;
      setEditorCode('');
      setLockError(null);
      lastValidTurnProgramRef.current = [];
      setPhase('HANDOVER');
    } else if (phase === 'P2_PROGRAMMING') {
      p2LockedProgramRef.current = resolvedProgram;
      setEditorCode('');
      setLockError(null);
      lastValidTurnProgramRef.current = [];
      setPhase('ROUND_COUNTDOWN');
    }
  }, [config, editorCode, phase]);

  // 30-second planning timer countdown
  useEffect(() => {
    if (phase !== 'P1_PROGRAMMING' && phase !== 'P2_PROGRAMMING') return;

    const intervalId = setInterval(() => {
      setProgrammingSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(intervalId);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(intervalId);
  }, [phase]);

  useEffect(() => {
    if (
      (phase === 'P1_PROGRAMMING' || phase === 'P2_PROGRAMMING') &&
      programmingSecondsLeft === 0
    ) {
      handleProgrammingTimerExpired();
    }
  }, [programmingSecondsLeft, phase, handleProgrammingTimerExpired]);

  // 3-second round engagement countdown
  useEffect(() => {
    if (phase !== 'ROUND_COUNTDOWN') return;
    setRoundCountdown(3);
    const timerId = setInterval(() => {
      setRoundCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timerId);
          setPhase('BATTLE');
          battleController.startRoundBattle(
            p1LockedProgramRef.current,
            p2LockedProgramRef.current
          );
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timerId);
  }, [phase, battleController]);

  // 2.5-second intermission before advancing to next round
  useEffect(() => {
    if (phase !== 'ROUND_INTERMISSION') return;
    const timer = setTimeout(() => {
      handleAdvanceToNextRound();
    }, 2500);
    return () => clearTimeout(timer);
  }, [phase, handleAdvanceToNextRound]);

  // Mount shared Phaser battlefield for the entire match (remains visible throughout all rounds)
  useEffect(() => {
    if (phase === 'SETUP') {
      battleController.attachView(null);
      if (phaserGameRef.current) {
        phaserGameRef.current.destroy(true);
        phaserGameRef.current = null;
      }
      return;
    }

    const container = phaserContainerRef.current;
    if (!container) return;

    if (!phaserGameRef.current) {
      const arenaScene = new ArenaScene(
        (pos) => {
          setHoveredCell(pos);
        },
        (readyScene) => {
          readyScene.setMaximizedMode(true);
          battleController.attachView(readyScene);
        },
        (time, delta) => {
          battleController.updateSimulation(time, delta);
        }
      );

      const gameConfig: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        parent: container,
        width: container.clientWidth || 640,
        height: container.clientHeight || 640,
        backgroundColor: '#060911',
        scene: [arenaScene],
        scale: {
          mode: Phaser.Scale.NONE,
        },
        banner: false,
        audio: {
          noAudio: true,
        },
      };

      const game = new Phaser.Game(gameConfig);
      phaserGameRef.current = game;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && phaserGameRef.current) {
          phaserGameRef.current.scale.resize(
            Math.floor(width),
            Math.floor(height)
          );
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [phase === 'SETUP', battleController]);

  useEffect(() => {
    combatLogEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [combatEvents]);

  // Rematch handler: resets everything cleanly to Round 1
  const handleRematch = () => {
    battleController.resetMatch(p1Name, p2Name);
    startP1Programming();
  };

  const handleInsertCommand = (snippet: string) => {
    setEditorCode((prev) => {
      const trimmed = prev.replace(/\s+$/, '');
      return trimmed.length > 0 ? `${trimmed}\n${snippet}\n` : `${snippet}\n`;
    });
    setLockError(null);
  };

  const activePlayerLabel: PvPPlayerId =
    phase === 'P2_PROGRAMMING' ? 'P2' : 'P1';
  const activePlayerName =
    activePlayerLabel === 'P1'
      ? p1Name.trim() || 'Player 1'
      : p2Name.trim() || 'Player 2';

  const p1HpPercent = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (battleSnapshot.p1.health / battleSnapshot.p1.maxHealth) * 100
      )
    )
  );
  const p2HpPercent = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (battleSnapshot.p2.health / battleSnapshot.p2.maxHealth) * 100
      )
    )
  );

  return (
    <div className="h-screen w-screen flex flex-col bg-[#070a10] text-slate-100 overflow-hidden select-none font-sans">
      {/* =====================================================================
          TOP BAR: Match Information & Persistent Battle State
         ===================================================================== */}
      <header className="h-14 px-5 border-b border-slate-800/80 bg-[#0d131f] flex items-center justify-between gap-4 shrink-0">
        {/* Left: Mode Title & Round Badge */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              battleController.stopBattle();
              onReturnToMainMenu();
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/80 text-xs font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
            title="Exit to Main Menu"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Main Menu</span>
          </button>
          <span className="text-slate-700">/</span>
          <div className="flex items-center gap-2">
            <Swords className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="font-semibold text-sm text-white tracking-tight">
              Robot Duel
            </span>
          </div>

          {phase !== 'SETUP' && (
            <div className="flex items-center gap-1.5 ml-1">
              <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 font-mono font-bold text-xs">
                ROUND {battleSnapshot.currentRound}
              </span>
            </div>
          )}
        </div>

        {/* Center: Phase Status & Timers */}
        {phase !== 'SETUP' && (
          <div className="flex items-center gap-3">
            {/* Phase Pill */}
            <div
              className={`px-3 py-1 rounded-md border text-xs font-semibold flex items-center gap-1.5 ${
                phase === 'P1_PROGRAMMING'
                  ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                  : phase === 'P2_PROGRAMMING'
                  ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                  : phase === 'HANDOVER'
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                  : phase === 'ROUND_COUNTDOWN'
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 animate-pulse'
                  : phase === 'BATTLE'
                  ? 'bg-rose-500/20 border-rose-500/40 text-rose-300 animate-pulse'
                  : phase === 'ROUND_INTERMISSION'
                  ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                  : 'bg-slate-800 border-slate-700 text-slate-300'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  phase === 'P1_PROGRAMMING'
                    ? 'bg-sky-400'
                    : phase === 'P2_PROGRAMMING'
                    ? 'bg-rose-400'
                    : phase === 'HANDOVER'
                    ? 'bg-amber-400'
                    : phase === 'ROUND_COUNTDOWN'
                    ? 'bg-emerald-400'
                    : phase === 'BATTLE'
                    ? 'bg-rose-500'
                    : 'bg-indigo-400'
                }`}
              />
              <span>
                {phase === 'P1_PROGRAMMING' && `${p1Name || 'Player 1'} Planning`}
                {phase === 'HANDOVER' && 'Handover Laptop'}
                {phase === 'P2_PROGRAMMING' && `${p2Name || 'Player 2'} Planning`}
                {phase === 'ROUND_COUNTDOWN' && 'Engaging...'}
                {phase === 'BATTLE' && 'Combat Active'}
                {phase === 'ROUND_INTERMISSION' && 'Round Complete'}
                {phase === 'RESULTS' && 'Match Results'}
              </span>
            </div>

            {/* Planning Countdown (during P1/P2 turns) */}
            {(phase === 'P1_PROGRAMMING' || phase === 'P2_PROGRAMMING') && (
              <div
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-mono text-xs font-semibold ${
                  programmingSecondsLeft <= 10
                    ? 'bg-rose-950/70 border-rose-500/60 text-rose-300 animate-pulse'
                    : 'bg-slate-900 border-slate-800 text-slate-200'
                }`}
                title="Planning time left this round"
              >
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>{programmingSecondsLeft}s</span>
              </div>
            )}

            {/* Overall Match Battle Timer */}
            <div
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900/80 border border-slate-800 text-xs text-slate-300 font-mono"
              title="Active battle time remaining across all rounds"
            >
              <Swords className="w-3.5 h-3.5 text-slate-400" />
              <span>Battle Clock:</span>
              <span className="font-semibold text-white">
                {battleSnapshot.battleRemainingSeconds}s /{' '}
                {config.battleDurationSeconds}s
              </span>
            </div>
          </div>
        )}

        {/* Right: Persistent Health Displays */}
        {phase !== 'SETUP' ? (
          <div className="flex items-center gap-4">
            {/* Player 1 Health Bar (Blue) */}
            <div className="flex items-center gap-2 bg-slate-900/90 border border-sky-500/30 px-2.5 py-1 rounded-md">
              <span className="w-2 h-2 rounded-full bg-sky-400 shrink-0" />
              <span className="text-xs font-semibold text-sky-300 hidden xl:inline truncate max-w-[80px]">
                {battleSnapshot.p1.name}
              </span>
              <div className="w-16 sm:w-20 h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-sky-400 transition-all duration-300"
                  style={{ width: `${p1HpPercent}%` }}
                />
              </div>
              <span className="text-xs font-mono font-bold text-white min-w-[42px] text-right">
                {battleSnapshot.p1.health} HP
              </span>
            </div>

            {/* Player 2 Health Bar (Crimson) */}
            <div className="flex items-center gap-2 bg-slate-900/90 border border-rose-500/30 px-2.5 py-1 rounded-md">
              <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
              <span className="text-xs font-semibold text-rose-300 hidden xl:inline truncate max-w-[80px]">
                {battleSnapshot.p2.name}
              </span>
              <div className="w-16 sm:w-20 h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-rose-500 transition-all duration-300"
                  style={{ width: `${p2HpPercent}%` }}
                />
              </div>
              <span className="text-xs font-mono font-bold text-white min-w-[42px] text-right">
                {battleSnapshot.p2.health} HP
              </span>
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-400">
            Round-Based Tactical Robot Duel
          </div>
        )}
      </header>

      {/* =====================================================================
          SCREEN 1: SETUP SCREEN (Displayed before match starts)
         ===================================================================== */}
      {phase === 'SETUP' && (
        <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto bg-[#070a10]">
          <div className="max-w-xl w-full bg-[#0e1525] border border-slate-800 rounded-xl p-6 space-y-6 shadow-2xl">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
                <Swords className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">
                  Local Robot Duel — Continuous Battles
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Fight continuous rounds on the same laptop. Write 5 commands
                  per round while observing the live battlefield situation.
                </p>
              </div>
            </div>

            {/* Player Names Input */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-sky-300">
                  Player 1 (Blue Robot • West Spawn 2, 7)
                </label>
                <input
                  type="text"
                  value={p1Name}
                  maxLength={18}
                  onChange={(e) => setP1Name(e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-700 text-sm text-white focus:outline-none focus:border-sky-400"
                  placeholder="Player 1"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-rose-300">
                  Player 2 (Crimson Robot • East Spawn 12, 7)
                </label>
                <input
                  type="text"
                  value={p2Name}
                  maxLength={18}
                  onChange={(e) => setP2Name(e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-700 text-sm text-white focus:outline-none focus:border-rose-400"
                  placeholder="Player 2"
                />
              </div>
            </div>

            {/* Match Rules Card */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4 space-y-3 text-xs">
              <div className="font-semibold text-slate-200 flex items-center gap-2">
                <Info className="w-4 h-4 text-sky-400" />
                <span>Round-Based Rules</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-slate-400">
                <div>
                  <span className="block text-slate-500">Per Round Limit</span>
                  <span className="font-mono font-semibold text-slate-200">
                    Max 5 instructions
                  </span>
                </div>
                <div>
                  <span className="block text-slate-500">Planning Time</span>
                  <span className="font-mono font-semibold text-slate-200">
                    30 seconds / round
                  </span>
                </div>
                <div>
                  <span className="block text-slate-500">Health</span>
                  <span className="font-mono font-semibold text-slate-200">
                    100 HP (persists)
                  </span>
                </div>
                <div>
                  <span className="block text-slate-500">Battle Clock</span>
                  <span className="font-mono font-semibold text-slate-200">
                    60s active simulation
                  </span>
                </div>
                <div>
                  <span className="block text-slate-500">Execution Tick</span>
                  <span className="font-mono font-semibold text-slate-200">
                    700ms simultaneous
                  </span>
                </div>
                <div>
                  <span className="block text-slate-500">Round Reset</span>
                  <span className="font-mono font-semibold text-slate-200">
                    Fresh code every round
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 pt-1 border-t border-slate-800">
                Robot positions, remaining HP, active bombs, and cooldowns
                persist across rounds until a robot is destroyed or time expires.
              </p>
            </div>

            <button
              type="button"
              onClick={handleStartMatch}
              className="w-full py-3 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold transition-colors cursor-pointer shadow-md flex items-center justify-center gap-2"
            >
              <span>Start Match — Round 1</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          MAIN SPLIT SCREEN: Battlefield Preview (Left) + Contextual Panel (Right)
          Visible during all rounds (P1 Planning, Handover, P2 Planning, Countdown, Battle)
         ===================================================================== */}
      {phase !== 'SETUP' && (
        <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden relative">
          {/* -----------------------------------------------------------------
              LEFT AREA: ACTUAL LIVE PHASER BATTLEFIELD PREVIEW
             ----------------------------------------------------------------- */}
          <div className="flex-1 min-w-0 min-h-[320px] flex flex-col bg-[#050811] relative border-r border-slate-800/80 overflow-hidden">
            {/* Battlefield Header Sub-bar */}
            <div className="h-9 px-4 bg-[#0a0f1d] border-b border-slate-800/80 flex items-center justify-between text-xs shrink-0 select-none">
              <div className="flex items-center gap-2 text-slate-300">
                {phase === 'BATTLE' ? (
                  <span className="flex items-center gap-1.5 text-rose-400 font-semibold animate-pulse">
                    <Zap className="w-3.5 h-3.5" />
                    <span>SIMULTANEOUS EXECUTION ACTIVE</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-sky-400 font-semibold">
                    <Crosshair className="w-3.5 h-3.5" />
                    <span>BATTLEFIELD FROZEN • STRATEGIC PLANNING</span>
                  </span>
                )}
              </div>

              {/* Live Coordinate / Entity Inspection */}
              <div className="flex items-center gap-3 text-slate-400 font-mono text-[11px]">
                {hoveredCell ? (
                  <span className="text-slate-200">
                    Tile ({hoveredCell.x}, {hoveredCell.y})
                    {battleSnapshot.p1.x === hoveredCell.x &&
                    battleSnapshot.p1.y === hoveredCell.y
                      ? ` • ${battleSnapshot.p1.name} (Blue)`
                      : battleSnapshot.p2.x === hoveredCell.x &&
                        battleSnapshot.p2.y === hoveredCell.y
                      ? ` • ${battleSnapshot.p2.name} (Crimson)`
                      : battleSnapshot.walls.some(
                          (w) => w.x === hoveredCell.x && w.y === hoveredCell.y
                        )
                      ? ' • Barrier Wall'
                      : battleSnapshot.bombs.some(
                          (b) => b.x === hoveredCell.x && b.y === hoveredCell.y
                        )
                      ? ' • Active Bomb'
                      : ' • Empty Floor'}
                  </span>
                ) : (
                  <span>Hover tiles to inspect coordinates</span>
                )}
              </div>
            </div>

            {/* Phaser Canvas Container */}
            <div className="flex-1 w-full h-full relative overflow-hidden bg-[#060911]">
              <div
                ref={phaserContainerRef}
                className="absolute inset-0 w-full h-full"
              />

              {/* Status overlay banner during frozen planning */}
              {(phase === 'P1_PROGRAMMING' || phase === 'P2_PROGRAMMING') && (
                <div className="absolute top-3 left-3 pointer-events-none bg-slate-950/85 backdrop-blur-xs border border-slate-800/90 rounded-md px-3 py-1.5 text-xs text-slate-300 shadow-lg space-y-0.5">
                  <div className="flex items-center gap-1.5 font-semibold text-white">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        activePlayerLabel === 'P1'
                          ? 'bg-sky-400'
                          : 'bg-rose-400'
                      }`}
                    />
                    <span>
                      Round {battleSnapshot.currentRound}: {activePlayerName} is
                      planning
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    Blue at ({battleSnapshot.p1.x}, {battleSnapshot.p1.y}) •
                    Crimson at ({battleSnapshot.p2.x}, {battleSnapshot.p2.y})
                    {battleSnapshot.bombs.length > 0 &&
                      ` • ${battleSnapshot.bombs.length} active bomb(s)`}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* -----------------------------------------------------------------
              RIGHT AREA: CONTEXTUAL PANEL
              (Code Editor OR Handover OR Round Countdown OR Battle HUD)
             ----------------------------------------------------------------- */}
          <aside className="w-full lg:w-[460px] xl:w-[520px] shrink-0 flex flex-col bg-[#0b101c] border-t lg:border-t-0 border-slate-800/80 min-h-0 overflow-hidden">
            {/* CASE A: PLANNING TURNS (P1_PROGRAMMING / P2_PROGRAMMING) */}
            {(phase === 'P1_PROGRAMMING' || phase === 'P2_PROGRAMMING') && (
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                {/* Editor Header: Current Player Identity, Slot Counter & Lock Button */}
                <div className="p-3.5 bg-[#0d131f] border-b border-slate-800/80 space-y-3 shrink-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`w-3 h-3 rounded-full ${
                          activePlayerLabel === 'P1'
                            ? 'bg-sky-400'
                            : 'bg-rose-400'
                        }`}
                      />
                      <div>
                        <h3 className="text-sm font-bold text-white tracking-tight">
                          {activePlayerName}
                        </h3>
                        <p className="text-[11px] text-slate-400">
                          {activePlayerLabel === 'P1'
                            ? 'Blue Robot (West)'
                            : 'Crimson Robot (East)'}{' '}
                          • Round {battleSnapshot.currentRound}
                        </p>
                      </div>
                    </div>

                    {/* Instruction Slots Counter & Visual Bar */}
                    <div className="text-right space-y-1">
                      <div className="flex items-center gap-1.5 font-mono text-xs justify-end">
                        <span className="text-slate-400">Slots:</span>
                        <span
                          className={`font-bold ${
                            liveValidation.instructionCount >
                            config.maxInstructionSlots
                              ? 'text-rose-400'
                              : 'text-sky-300'
                          }`}
                        >
                          {liveValidation.instructionCount} /{' '}
                          {config.maxInstructionSlots}
                        </span>
                      </div>
                      {/* 5-segment slot meter */}
                      <div className="flex items-center gap-1 justify-end">
                        {Array.from({
                          length: config.maxInstructionSlots,
                        }).map((_, idx) => {
                          const filled = idx < liveValidation.instructionCount;
                          const overflow =
                            liveValidation.instructionCount >
                            config.maxInstructionSlots;
                          return (
                            <div
                              key={idx}
                              className={`w-3.5 h-1.5 rounded-xs transition-colors ${
                                overflow
                                  ? 'bg-rose-500'
                                  : filled
                                  ? activePlayerLabel === 'P1'
                                    ? 'bg-sky-400'
                                    : 'bg-rose-400'
                                  : 'bg-slate-800'
                              }`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Lock Program Action Bar */}
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/60">
                    <button
                      type="button"
                      onClick={() => setEditorCode('')}
                      className="px-2.5 py-1.5 rounded-md text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      Clear
                    </button>

                    <button
                      type="button"
                      onClick={handleLockProgram}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-white text-xs font-bold transition-all shadow-md cursor-pointer ${
                        activePlayerLabel === 'P1'
                          ? 'bg-sky-600 hover:bg-sky-500 active:scale-[0.98]'
                          : 'bg-rose-600 hover:bg-rose-500 active:scale-[0.98]'
                      }`}
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>
                        LOCK PROGRAM (Round {battleSnapshot.currentRound})
                      </span>
                    </button>
                  </div>
                </div>

                {/* Validation Feedback Banner */}
                {(lockError ||
                  (editorCode.trim().length > 0 &&
                    !liveValidation.valid &&
                    liveValidation.error)) && (
                  <div className="px-3.5 py-2 bg-rose-950/60 border-b border-rose-500/30 flex items-start gap-2 text-xs text-rose-200 shrink-0">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-rose-300">
                        Line {(lockError ?? liveValidation.error)?.line}:{' '}
                      </span>
                      <span className="font-mono">
                        {(lockError ?? liveValidation.error)?.message}
                      </span>
                    </div>
                  </div>
                )}

                {editorCode.trim().length > 0 && liveValidation.valid && (
                  <div className="px-3.5 py-1.5 bg-emerald-950/30 border-b border-emerald-500/20 flex items-center gap-2 text-xs text-emerald-300 shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>
                      {liveValidation.instructionCount} /{' '}
                      {config.maxInstructionSlots} valid instructions ready.
                    </span>
                  </div>
                )}

                {/* Monaco Code Editor (Fresh each round) */}
                <div className="flex-1 min-h-[220px] relative bg-[#0a0e17]">
                  <Editor
                    height="100%"
                    defaultLanguage="python"
                    value={editorCode}
                    onChange={(val) => {
                      setEditorCode(val ?? '');
                      if (lockError) setLockError(null);
                    }}
                    theme="vs-dark"
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      fontFamily: "'JetBrains Mono', monospace",
                      lineHeight: 22,
                      padding: { top: 12, bottom: 12 },
                      scrollBeyondLastLine: false,
                      renderLineHighlight: 'all',
                      automaticLayout: true,
                      overviewRulerBorder: false,
                    }}
                  />
                </div>

                {/* Compact Quick Commands Reference (Click to Insert) */}
                <div className="p-3 bg-[#090d18] border-t border-slate-800/80 space-y-2 shrink-0">
                  <div className="flex items-center justify-between text-xs text-slate-400 font-semibold">
                    <span>Quick Command Insert (Max 5 Slots)</span>
                    <span className="text-[11px] text-slate-500">
                      Click to add
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-xs">
                    <button
                      type="button"
                      onClick={() => handleInsertCommand('move_right()')}
                      className="px-2 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-left font-mono text-[11px] text-sky-300 hover:border-sky-500/40 transition-colors cursor-pointer truncate"
                      title="Move 1 tile right (+X)"
                    >
                      move_right()
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInsertCommand('move_left()')}
                      className="px-2 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-left font-mono text-[11px] text-sky-300 hover:border-sky-500/40 transition-colors cursor-pointer truncate"
                      title="Move 1 tile left (-X)"
                    >
                      move_left()
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInsertCommand('move_up()')}
                      className="px-2 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-left font-mono text-[11px] text-sky-300 hover:border-sky-500/40 transition-colors cursor-pointer truncate"
                      title="Move 1 tile up (-Y)"
                    >
                      move_up()
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInsertCommand('move_down()')}
                      className="px-2 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-left font-mono text-[11px] text-sky-300 hover:border-sky-500/40 transition-colors cursor-pointer truncate"
                      title="Move 1 tile down (+Y)"
                    >
                      move_down()
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInsertCommand('laser()')}
                      className="px-2 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-left font-mono text-[11px] text-amber-300 hover:border-amber-500/40 transition-colors cursor-pointer truncate"
                      title="Fire laser in facing direction (35 DMG)"
                    >
                      laser()
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInsertCommand('shockwave()')}
                      className="px-2 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-left font-mono text-[11px] text-amber-300 hover:border-amber-500/40 transition-colors cursor-pointer truncate"
                      title="Shockwave pulse within 2 tiles (25 DMG)"
                    >
                      shockwave()
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const targetX = hoveredCell ? hoveredCell.x : 7;
                        const targetY = hoveredCell ? hoveredCell.y : 7;
                        handleInsertCommand(`bomb(${targetX}, ${targetY})`);
                      }}
                      className="px-2 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-left font-mono text-[11px] text-amber-300 hover:border-amber-500/40 transition-colors cursor-pointer truncate"
                      title="Place timed bomb (55 DMG, 3 ticks)"
                    >
                      bomb(x, y)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleInsertCommand('wait(1)')}
                      className="px-2 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-left font-mono text-[11px] text-emerald-300 hover:border-emerald-500/40 transition-colors cursor-pointer truncate"
                      title="Wait 1 second"
                    >
                      wait(1)
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* CASE B: HANDOVER SCREEN (Privacy veil between P1 & P2) */}
            {phase === 'HANDOVER' && (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-5 bg-[#090e1a]">
                <div className="w-14 h-14 rounded-full bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shadow-lg">
                  <EyeOff className="w-7 h-7" />
                </div>

                <div className="space-y-2 max-w-sm">
                  <h3 className="text-xl font-bold text-white">
                    {p1Name.trim() || 'Player 1'} Locked Code
                  </h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Player 1&apos;s program has been saved and hidden.
                    Please pass the laptop to{' '}
                    <strong className="text-rose-400 font-semibold">
                      {p2Name.trim() || 'Player 2'}
                    </strong>
                    .
                  </p>
                  <p className="text-[11px] text-slate-500">
                    The battlefield on the left shows the current positions for
                    Round {battleSnapshot.currentRound}.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={startP2Programming}
                  className="w-full max-w-xs py-3 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-md cursor-pointer flex items-center justify-center gap-2"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>
                    I AM {p2Name.trim() || 'PLAYER 2'} — START PLANNING
                  </span>
                </button>
              </div>
            )}

            {/* CASE C: ROUND ENGAGEMENT COUNTDOWN */}
            {phase === 'ROUND_COUNTDOWN' && (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4 bg-[#090e1a]">
                <div className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <Swords className="w-7 h-7 animate-bounce" />
                </div>

                <div className="space-y-1">
                  <span className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-widest">
                    Round {battleSnapshot.currentRound}
                  </span>
                  <h3 className="text-2xl font-bold text-white">
                    Both Programs Locked!
                  </h3>
                  <p className="text-xs text-slate-400">
                    Executing instructions simultaneously against the
                    battlefield...
                  </p>
                </div>

                <div className="text-5xl font-mono font-black text-amber-400 animate-pulse my-2">
                  {roundCountdown}
                </div>
              </div>
            )}

            {/* CASE D: BATTLE EXECUTION & ROUND INTERMISSION HUD */}
            {(phase === 'BATTLE' || phase === 'ROUND_INTERMISSION') && (
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#0a0f1d]">
                {/* Round Intermission Banner (if round finished but match still running) */}
                {phase === 'ROUND_INTERMISSION' && (
                  <div className="p-3.5 bg-indigo-950/60 border-b border-indigo-500/30 flex items-center justify-between gap-3 shrink-0">
                    <div>
                      <div className="text-xs font-bold text-indigo-300">
                        Round {battleSnapshot.currentRound} Complete!
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Both robots survived. Advancing to Round{' '}
                        {battleSnapshot.currentRound + 1}...
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleAdvanceToNextRound}
                      className="px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer shadow-xs"
                    >
                      Next Round Now
                    </button>
                  </div>
                )}

                {/* Robot Status Cards */}
                <div className="p-3.5 border-b border-slate-800/80 space-y-2.5 shrink-0">
                  {/* Player 1 Active Status */}
                  <div className="bg-slate-900/90 border border-sky-500/30 rounded-lg p-2.5 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-sky-300">
                        {battleSnapshot.p1.name} (Blue)
                      </span>
                      <span className="font-mono text-white font-semibold">
                        {battleSnapshot.p1.health} HP • Step{' '}
                        {battleSnapshot.p1.instructionPointer}/
                        {battleSnapshot.p1.totalInstructions}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-300 font-mono truncate">
                      Action: {battleSnapshot.p1.lastActionText}
                    </div>
                  </div>

                  {/* Player 2 Active Status */}
                  <div className="bg-slate-900/90 border border-rose-500/30 rounded-lg p-2.5 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-rose-300">
                        {battleSnapshot.p2.name} (Crimson)
                      </span>
                      <span className="font-mono text-white font-semibold">
                        {battleSnapshot.p2.health} HP • Step{' '}
                        {battleSnapshot.p2.instructionPointer}/
                        {battleSnapshot.p2.totalInstructions}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-300 font-mono truncate">
                      Action: {battleSnapshot.p2.lastActionText}
                    </div>
                  </div>
                </div>

                {/* Combat Event Feed */}
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                  <div className="h-8 px-3.5 border-b border-slate-800/80 flex items-center justify-between text-xs font-semibold text-slate-400 bg-slate-900/50">
                    <span>Live Combat Feed</span>
                    <Shield className="w-3.5 h-3.5 text-slate-500" />
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-1.5">
                    {combatEvents.length === 0 ? (
                      <div className="text-slate-500">Battle starting...</div>
                    ) : (
                      combatEvents.map((ev) => (
                        <div
                          key={ev.id}
                          className="leading-snug text-slate-300"
                        >
                          <span className="text-slate-500 mr-1.5">
                            [{ev.timestamp}]
                          </span>
                          <span>{ev.message}</span>
                        </div>
                      ))
                    )}
                    <div ref={combatLogEndRef} />
                  </div>
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* =====================================================================
          RESULTS MODAL: Game Over / Victory / Draw Screen
         ===================================================================== */}
      {phase === 'RESULTS' && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="max-w-xl w-full bg-[#0e1525] border border-slate-800 rounded-xl p-6 space-y-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            {/* Trophy & Winner Title */}
            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400 shadow-md">
                <Trophy className="w-7 h-7" />
              </div>
              <h2 className="text-2xl font-bold text-white tracking-tight">
                {battleSnapshot.winner === 'P1'
                  ? `${battleSnapshot.p1.name} Wins the Duel!`
                  : battleSnapshot.winner === 'P2'
                  ? `${battleSnapshot.p2.name} Wins the Duel!`
                  : 'Duel Concluded in a Draw!'}
              </h2>
              <p className="text-xs text-slate-400">
                {battleSnapshot.endReason === 'KNOCKOUT' &&
                  'Resolved by opponent robot destruction'}
                {battleSnapshot.endReason === 'DOUBLE_KO' &&
                  'Both robots destroyed simultaneously in the same tick'}
                {battleSnapshot.endReason === 'TIMEOUT' &&
                  'Match concluded on 60-second battle clock limit'}
              </p>
              <div className="inline-block px-3 py-1 rounded-full bg-slate-900 border border-slate-700 font-mono text-xs text-amber-300 font-semibold">
                Fought across {battleSnapshot.currentRound}{' '}
                {battleSnapshot.currentRound === 1 ? 'round' : 'rounds'}
              </div>
            </div>

            {/* Match Statistics Comparison Table */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-4 space-y-3">
              <div className="text-xs font-semibold text-slate-300 border-b border-slate-800 pb-2">
                Duel Combat Statistics
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs text-center items-center">
                <div className="font-bold text-sky-400 truncate">
                  {battleSnapshot.p1.name}
                </div>
                <div className="text-slate-500 font-semibold text-[11px] uppercase tracking-wider">
                  Stat
                </div>
                <div className="font-bold text-rose-400 truncate">
                  {battleSnapshot.p2.name}
                </div>

                <div className="font-mono text-slate-200">
                  {battleSnapshot.p1.health} / {battleSnapshot.p1.maxHealth}
                </div>
                <div className="text-slate-400 text-[11px]">Final HP</div>
                <div className="font-mono text-slate-200">
                  {battleSnapshot.p2.health} / {battleSnapshot.p2.maxHealth}
                </div>

                <div className="font-mono text-slate-200">
                  {battleSnapshot.p1.stats.damageDealt}
                </div>
                <div className="text-slate-400 text-[11px]">Damage Dealt</div>
                <div className="font-mono text-slate-200">
                  {battleSnapshot.p2.stats.damageDealt}
                </div>

                <div className="font-mono text-slate-200">
                  {battleSnapshot.p1.stats.laserHits}
                </div>
                <div className="text-slate-400 text-[11px]">Laser Hits</div>
                <div className="font-mono text-slate-200">
                  {battleSnapshot.p2.stats.laserHits}
                </div>

                <div className="font-mono text-slate-200">
                  {battleSnapshot.p1.stats.bombsPlaced}
                </div>
                <div className="text-slate-400 text-[11px]">Bombs Placed</div>
                <div className="font-mono text-slate-200">
                  {battleSnapshot.p2.stats.bombsPlaced}
                </div>

                <div className="font-mono text-slate-200">
                  {battleSnapshot.p1.stats.shockwavesUsed}
                </div>
                <div className="text-slate-400 text-[11px]">
                  Shockwaves Used
                </div>
                <div className="font-mono text-slate-200">
                  {battleSnapshot.p2.stats.shockwavesUsed}
                </div>
              </div>
            </div>

            {/* Actions: Rematch or Return to Main Menu */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleRematch}
                className="flex-1 py-3 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition-colors cursor-pointer shadow-md flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Rematch (Round 1)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  battleController.stopBattle();
                  onReturnToMainMenu();
                }}
                className="px-5 py-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer border border-slate-700"
              >
                Return to Menu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
