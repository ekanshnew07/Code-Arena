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
  Move,
  Zap,
  FastForward,
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

const PVP_COMMAND_DOCS = [
  {
    category: 'Movement',
    items: [
      { sig: 'move_right()', desc: 'Move 1 tile right (+X) and face right.' },
      { sig: 'move_left()', desc: 'Move 1 tile left (-X) and face left.' },
      { sig: 'move_up()', desc: 'Move 1 tile up (-Y) and face up.' },
      { sig: 'move_down()', desc: 'Move 1 tile down (+Y) and face down.' },
    ],
  },
  {
    category: 'Attacks',
    items: [
      {
        sig: 'laser()',
        desc: 'Fire directional beam in facing direction (35 DMG).',
      },
      {
        sig: 'shockwave()',
        desc: 'Circular pulse within 2 tiles (25 DMG, 5s cooldown).',
      },
      {
        sig: 'bomb(7, 7)',
        desc: 'Deploy timed charge at (x, y), 3×3 blast (55 DMG).',
      },
    ],
  },
  {
    category: 'Timing',
    items: [
      {
        sig: 'wait(2)',
        desc: 'Delay your next instruction by n seconds (1–10s).',
      },
    ],
  },
];

export const PvPModeLayout: React.FC<PvPModeLayoutProps> = ({
  onReturnToMainMenu,
}) => {
  const config = DEFAULT_PVP_CONFIG;

  const [phase, setPhase] = useState<PvPPhase>('SETUP');
  const [p1Name, setP1Name] = useState<string>('Player 1');
  const [p2Name, setP2Name] = useState<string>('Player 2');

  // Active editor state for the current programming turn (cleared on handover!)
  const [editorCode, setEditorCode] = useState<string>('');
  const [lockError, setLockError] = useState<{
    line: number;
    message: string;
  } | null>(null);
  const [programmingSecondsLeft, setProgrammingSecondsLeft] = useState<number>(
    config.programmingTimeSeconds
  );

  // Privately stored validated programs
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
  const [combatEvents, setCombatEvents] = useState<CombatEventEntry[]>([]);
  const [hoveredCell, setHoveredCell] = useState<GridPosition | null>(null);

  const phaserContainerRef = useRef<HTMLDivElement | null>(null);
  const phaserGameRef = useRef<Phaser.Game | null>(null);
  const combatLogEndRef = useRef<HTMLDivElement | null>(null);

  // Live validation of current editor code
  const liveValidation = validatePvPProgram(editorCode, config, false);

  // Whenever the player's current editor code is valid (or empty), update lastValidTurnProgramRef
  useEffect(() => {
    if (phase !== 'P1_PROGRAMMING' && phase !== 'P2_PROGRAMMING') return;
    const check = validatePvPProgram(editorCode, config, true);
    if (check.valid) {
      lastValidTurnProgramRef.current = check.instructions;
    }
  }, [editorCode, phase, config]);

  // Start Player 1 programming turn
  const startP1Programming = useCallback(() => {
    p1LockedProgramRef.current = [];
    p2LockedProgramRef.current = [];
    lastValidTurnProgramRef.current = [];
    setEditorCode('');
    setLockError(null);
    setProgrammingSecondsLeft(config.programmingTimeSeconds);
    setPhase('P1_PROGRAMMING');
  }, [config.programmingTimeSeconds]);

  // Start Player 2 programming turn from Handover screen
  const startP2Programming = useCallback(() => {
    lastValidTurnProgramRef.current = [];
    setEditorCode('');
    setLockError(null);
    setProgrammingSecondsLeft(config.programmingTimeSeconds);
    setPhase('P2_PROGRAMMING');
  }, [config.programmingTimeSeconds]);

  // Launch the simultaneous battle after P2 locks code
  const beginBattlePhase = useCallback(
    (p1Prog: PvPInstruction[], p2Prog: PvPInstruction[]) => {
      setEditorCode('');
      setLockError(null);
      setPhase('BATTLE');
      battleController.startBattle(
        p1Prog,
        p2Prog,
        p1Name.trim() || 'Player 1',
        p2Name.trim() || 'Player 2'
      );
    },
    [battleController, p1Name, p2Name]
  );

  // Manual LOCK CODE handler
  const handleLockCode = () => {
    const res = validatePvPProgram(editorCode, config, false);
    if (!res.valid) {
      setLockError(
        res.error ?? { line: 1, message: 'Please fix invalid code before locking.' }
      );
      return;
    }

    if (phase === 'P1_PROGRAMMING') {
      p1LockedProgramRef.current = res.instructions;
      // Clear editor state immediately so Player 1's code is never visible
      setEditorCode('');
      setLockError(null);
      lastValidTurnProgramRef.current = [];
      setPhase('HANDOVER');
    } else if (phase === 'P2_PROGRAMMING') {
      p2LockedProgramRef.current = res.instructions;
      setEditorCode('');
      setLockError(null);
      lastValidTurnProgramRef.current = [];
      beginBattlePhase(p1LockedProgramRef.current, res.instructions);
    }
  };

  // Auto-lock when 60-second programming timer expires
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
      beginBattlePhase(p1LockedProgramRef.current, resolvedProgram);
    }
  }, [beginBattlePhase, config, editorCode, phase]);

  // 60-second countdown timer during P1_PROGRAMMING and P2_PROGRAMMING
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

  // Mount shared Phaser battlefield during BATTLE phase
  useEffect(() => {
    if (phase !== 'BATTLE') {
      battleController.attachView(null);
      if (phaserGameRef.current) {
        phaserGameRef.current.destroy(true);
        phaserGameRef.current = null;
      }
      return;
    }

    const container = phaserContainerRef.current;
    if (!container) return;

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
      battleController.attachView(null);
      if (phaserGameRef.current) {
        phaserGameRef.current.destroy(true);
        phaserGameRef.current = null;
      }
    };
  }, [phase, battleController]);

  useEffect(() => {
    combatLogEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [combatEvents]);

  // Rematch handler: resets everything cleanly and returns to Player 1 programming
  const handleRematch = () => {
    battleController.resetBattle([], [], p1Name, p2Name);
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

  const bothProgramsFinishedAndIdle =
    battleSnapshot.p1.executionState === 'FINISHED' &&
    battleSnapshot.p2.executionState === 'FINISHED' &&
    battleSnapshot.bombs.length === 0;

  return (
    <div className="h-screen w-screen flex flex-col bg-[#070a10] text-slate-100 overflow-hidden select-none">
      {/* Top PvP Navigation Header */}
      <header className="h-13 px-5 border-b border-slate-800/80 bg-[#0d131f] flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              battleController.stopBattle();
              onReturnToMainMenu();
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/80 text-xs font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Main Menu</span>
          </button>
          <span className="text-slate-700">/</span>
          <div className="flex items-center gap-2">
            <Swords className="w-4 h-4 text-rose-400" />
            <span className="font-semibold text-sm text-white">
              Local PvP — Robot Duel
            </span>
          </div>
        </div>

        {/* Phase Indicator */}
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`px-2.5 py-1 rounded-md border font-medium ${
              phase === 'P1_PROGRAMMING'
                ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                : phase === 'P2_PROGRAMMING'
                ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                : phase === 'BATTLE'
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-800 border-slate-700 text-slate-300'
            }`}
          >
            {phase === 'SETUP' && 'Match Setup'}
            {phase === 'P1_PROGRAMMING' && `${p1Name || 'Player 1'} Programming`}
            {phase === 'HANDOVER' && 'Handover Laptop'}
            {phase === 'P2_PROGRAMMING' && `${p2Name || 'Player 2'} Programming`}
            {phase === 'BATTLE' && 'Battle in Progress'}
            {phase === 'RESULTS' && 'Match Results'}
          </span>
        </div>
      </header>

      {/* =====================================================================
          1. SETUP SCREEN
         ===================================================================== */}
      {phase === 'SETUP' && (
        <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
          <div className="max-w-xl w-full bg-[#0e1525] border border-slate-800 rounded-xl p-6 space-y-6 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
                <Swords className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">
                  Hot-Seat Robot Duel Setup
                </h2>
                <p className="text-xs text-slate-400">
                  Two players program their robots secretly on this laptop, then
                  battle simultaneously.
                </p>
              </div>
            </div>

            {/* Player Names */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-sky-300">
                  Player 1 (West Spawn: 2, 7 • Facing Right)
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
                <label className="block text-xs font-medium text-rose-300">
                  Player 2 (East Spawn: 12, 7 • Facing Left)
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

            {/* Match Rules Summary */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4 space-y-2.5 text-xs">
              <div className="font-semibold text-slate-200">
                Match Configuration
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-slate-400">
                <div>
                  <span className="block text-slate-500">Robot Health</span>
                  <span className="font-mono font-semibold text-slate-200">
                    {config.maxHealth} HP each
                  </span>
                </div>
                <div>
                  <span className="block text-slate-500">Instruction Limit</span>
                  <span className="font-mono font-semibold text-slate-200">
                    {config.maxInstructionSlots} slots max
                  </span>
                </div>
                <div>
                  <span className="block text-slate-500">Programming Time</span>
                  <span className="font-mono font-semibold text-slate-200">
                    {config.programmingTimeSeconds}s per player
                  </span>
                </div>
                <div>
                  <span className="block text-slate-500">Battle Duration</span>
                  <span className="font-mono font-semibold text-slate-200">
                    {config.battleDurationSeconds}s max
                  </span>
                </div>
                <div>
                  <span className="block text-slate-500">Execution Step</span>
                  <span className="font-mono font-semibold text-slate-200">
                    {config.instructionIntervalMs}ms interval
                  </span>
                </div>
                <div>
                  <span className="block text-slate-500">Allowed Syntax</span>
                  <span className="font-mono font-semibold text-slate-200">
                    Sequential commands
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={startP1Programming}
              className="w-full py-3 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold transition-colors cursor-pointer"
            >
              Start {p1Name.trim() || 'Player 1'} Programming Turn
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          2. SEQUENTIAL PROGRAMMING PHASE (P1_PROGRAMMING / P2_PROGRAMMING)
         ===================================================================== */}
      {(phase === 'P1_PROGRAMMING' || phase === 'P2_PROGRAMMING') && (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left Panel: PvP Command Reference & Starting Coordinates */}
          <aside className="w-72 shrink-0 bg-[#0d131f] border-r border-slate-800/80 flex flex-col overflow-hidden">
            <div className="p-3.5 border-b border-slate-800/80 space-y-2">
              <div className="text-xs font-semibold text-slate-200">
                Starting Arena Positions (15×15)
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div
                  className={`p-2 rounded border ${
                    activePlayerLabel === 'P1'
                      ? 'bg-sky-950/50 border-sky-500/40 text-sky-200'
                      : 'bg-slate-900/70 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="font-semibold truncate">
                    {p1Name.trim() || 'Player 1'}
                  </div>
                  <div className="font-mono text-[11px] mt-0.5">
                    (2, 7) • Right
                  </div>
                </div>
                <div
                  className={`p-2 rounded border ${
                    activePlayerLabel === 'P2'
                      ? 'bg-rose-950/50 border-rose-500/40 text-rose-200'
                      : 'bg-slate-900/70 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="font-semibold truncate">
                    {p2Name.trim() || 'Player 2'}
                  </div>
                  <div className="font-mono text-[11px] mt-0.5">
                    (12, 7) • Left
                  </div>
                </div>
              </div>
              <div className="text-[11px] text-slate-400">
                Barriers at: <span className="font-mono">(5,3), (5,11), (9,3), (9,11)</span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
              {PVP_COMMAND_DOCS.map((group) => (
                <section key={group.category}>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-2">
                    {group.category === 'Movement' ? (
                      <Move className="w-3.5 h-3.5 text-sky-400" />
                    ) : group.category === 'Attacks' ? (
                      <Zap className="w-3.5 h-3.5 text-amber-400" />
                    ) : (
                      <Clock className="w-3.5 h-3.5 text-emerald-400" />
                    )}
                    <span>{group.category}</span>
                  </div>
                  <div className="space-y-1.5">
                    {group.items.map((cmd) => (
                      <button
                        key={cmd.sig}
                        type="button"
                        onClick={() => handleInsertCommand(cmd.sig)}
                        className="w-full text-left p-2 rounded-md bg-slate-900/70 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700 transition-colors cursor-pointer"
                      >
                        <div className="font-mono text-xs font-medium text-sky-300">
                          {cmd.sig}
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                          {cmd.desc}
                        </p>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </aside>

          {/* Main Programming Area */}
          <div className="flex-1 flex flex-col min-w-0 bg-[#0f1623]">
            {/* Turn Header Bar: Player Name, 60s Countdown, Slot Counter & LOCK CODE Button */}
            <div className="p-3.5 bg-[#0d131f] border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span
                  className={`w-3 h-3 rounded-full ${
                    activePlayerLabel === 'P1' ? 'bg-sky-400' : 'bg-rose-400'
                  }`}
                />
                <div>
                  <h2 className="text-sm font-bold text-white">
                    {activePlayerName} — Secret Programming Turn
                  </h2>
                  <p className="text-xs text-slate-400">
                    Write up to {config.maxInstructionSlots} sequential commands
                    (no loops or conditions) and click Lock Code.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                {/* Instruction Slots Counter */}
                <div className="bg-slate-900 border border-slate-800 rounded-md px-3 py-1.5 text-xs flex items-center gap-2">
                  <span className="text-slate-400">Instruction Slots:</span>
                  <span
                    className={`font-mono font-bold ${
                      liveValidation.instructionCount >
                      config.maxInstructionSlots
                        ? 'text-rose-400'
                        : 'text-sky-300'
                    }`}
                  >
                    {liveValidation.instructionCount} /{' '}
                    {config.maxInstructionSlots}
                  </span>
                  <span className="text-slate-500">
                    ({liveValidation.remainingSlots} left)
                  </span>
                </div>

                {/* 60-Second Programming Timer */}
                <div
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border font-mono text-xs font-semibold ${
                    programmingSecondsLeft <= 10
                      ? 'bg-rose-950/60 border-rose-500/50 text-rose-300 animate-pulse'
                      : 'bg-slate-900 border-slate-800 text-slate-200'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  <span>{programmingSecondsLeft}s</span>
                </div>

                {/* LOCK CODE Button */}
                <button
                  type="button"
                  onClick={handleLockCode}
                  className="flex items-center gap-2 px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>LOCK CODE</span>
                </button>
              </div>
            </div>

            {/* Validation Error / Status Banner */}
            {(lockError || (editorCode.trim().length > 0 && !liveValidation.valid && liveValidation.error)) && (
              <div className="px-4 py-2.5 bg-rose-950/50 border-b border-rose-500/30 flex items-start gap-2.5 text-xs text-rose-200">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
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
              <div className="px-4 py-2 bg-emerald-950/30 border-b border-emerald-500/20 flex items-center gap-2 text-xs text-emerald-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  Program valid ({liveValidation.instructionCount}{' '}
                  {liveValidation.instructionCount === 1
                    ? 'instruction'
                    : 'instructions'}{' '}
                  ready to lock).
                </span>
              </div>
            )}

            {/* Monaco Editor */}
            <div className="flex-1 min-h-0 relative bg-[#0a0e17]">
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
                  fontSize: 14,
                  fontFamily: "'JetBrains Mono', monospace",
                  lineHeight: 23,
                  padding: { top: 16, bottom: 16 },
                  scrollBeyondLastLine: false,
                  renderLineHighlight: 'all',
                  automaticLayout: true,
                  overviewRulerBorder: false,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          3. HANDOVER SCREEN (PRIVACY TRANSITION BETWEEN P1 & P2)
         ===================================================================== */}
      {phase === 'HANDOVER' && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#0e1525] border border-slate-800 rounded-xl p-6 text-center space-y-5 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-sky-500/15 border border-sky-500/30 flex items-center justify-center mx-auto text-sky-400">
              <EyeOff className="w-6 h-6" />
            </div>

            <div className="space-y-1.5">
              <h2 className="text-xl font-bold text-white">
                {p1Name.trim() || 'Player 1'} Code Locked!
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                {p1Name.trim() || 'Player 1'}&apos;s program is hidden and
                stored privately. Please hand the laptop over to{' '}
                <strong className="text-rose-300 font-semibold">
                  {p2Name.trim() || 'Player 2'}
                </strong>
                .
              </p>
            </div>

            <button
              type="button"
              onClick={startP2Programming}
              className="w-full py-3 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold transition-colors cursor-pointer"
            >
              I Am {p2Name.trim() || 'Player 2'} — Start My Programming Turn
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          4. SHARED BATTLE SIMULATION INTERFACE (NO SOURCE CODE SHOWN)
         ===================================================================== */}
      {phase === 'BATTLE' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Top PvP Battle HUD: P1 Status | Countdown | P2 Status */}
          <div className="px-5 py-2.5 bg-[#0b101b] border-b border-slate-800/80 grid grid-cols-1 md:grid-cols-3 items-center gap-4 shrink-0">
            {/* Player 1 HUD */}
            <div className="flex items-center gap-3 bg-slate-900/90 border border-sky-500/30 rounded-lg px-3.5 py-2">
              <div className="w-3 h-3 rounded-full bg-sky-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-sky-300 truncate">
                    {battleSnapshot.p1.name}
                  </span>
                  <span className="font-mono font-semibold text-white">
                    {battleSnapshot.p1.health}/{battleSnapshot.p1.maxHealth} HP
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden my-1">
                  <div
                    className="h-full bg-sky-400 transition-all duration-200"
                    style={{
                      width: `${Math.max(
                        0,
                        (battleSnapshot.p1.health /
                          battleSnapshot.p1.maxHealth) *
                          100
                      )}%`,
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span className="truncate">{battleSnapshot.p1.lastActionText}</span>
                  <span className="font-mono shrink-0 ml-2">
                    Step {battleSnapshot.p1.instructionPointer}/
                    {battleSnapshot.p1.totalInstructions}
                  </span>
                </div>
              </div>
            </div>

            {/* Center Battle Countdown & Status */}
            <div className="flex flex-col items-center justify-center text-center">
              <div className="flex items-center gap-2 text-lg font-mono font-bold text-white">
                <Clock className="w-4 h-4 text-amber-400" />
                <span>{battleSnapshot.battleRemainingSeconds}s</span>
              </div>
              <div className="text-[11px] text-slate-400">
                Simultaneous Execution • 700ms Step
                {hoveredCell
                  ? ` • Tile (${hoveredCell.x}, ${hoveredCell.y})`
                  : ''}
              </div>
              {bothProgramsFinishedAndIdle && (
                <button
                  type="button"
                  onClick={() => battleController.finishAtTimeoutNow()}
                  className="mt-1 flex items-center gap-1 px-2.5 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 text-[11px] font-medium cursor-pointer"
                >
                  <FastForward className="w-3 h-3" />
                  <span>Both Programs Done — Resolve Match Now</span>
                </button>
              )}
            </div>

            {/* Player 2 HUD */}
            <div className="flex items-center gap-3 bg-slate-900/90 border border-rose-500/30 rounded-lg px-3.5 py-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-rose-300 truncate">
                    {battleSnapshot.p2.name}
                  </span>
                  <span className="font-mono font-semibold text-white">
                    {battleSnapshot.p2.health}/{battleSnapshot.p2.maxHealth} HP
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden my-1">
                  <div
                    className="h-full bg-rose-500 transition-all duration-200"
                    style={{
                      width: `${Math.max(
                        0,
                        (battleSnapshot.p2.health /
                          battleSnapshot.p2.maxHealth) *
                          100
                      )}%`,
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span className="truncate">{battleSnapshot.p2.lastActionText}</span>
                  <span className="font-mono shrink-0 ml-2">
                    Step {battleSnapshot.p2.instructionPointer}/
                    {battleSnapshot.p2.totalInstructions}
                  </span>
                </div>
              </div>
              <div className="w-3 h-3 rounded-full bg-rose-500 shrink-0" />
            </div>
          </div>

          {/* Shared Battlefield Canvas + Right Combat Event Log */}
          <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
            <div className="flex-1 min-w-0 min-h-0 relative overflow-hidden bg-[#060911]">
              <div
                ref={phaserContainerRef}
                className="absolute inset-0 w-full h-full"
              />
            </div>

            <aside className="w-72 shrink-0 bg-[#0b101b] border-l border-slate-800/80 flex flex-col">
              <div className="h-9 px-3.5 border-b border-slate-800/80 flex items-center justify-between text-xs font-semibold text-slate-300">
                <span>Battle Event Log</span>
                <Shield className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-1.5">
                {combatEvents.length === 0 ? (
                  <div className="text-slate-500">Battle starting...</div>
                ) : (
                  combatEvents.map((ev) => (
                    <div key={ev.id} className="leading-snug text-slate-300">
                      <span className="text-slate-500 mr-1.5">
                        [{ev.timestamp}]
                      </span>
                      <span>{ev.message}</span>
                    </div>
                  ))
                )}
                <div ref={combatLogEndRef} />
              </div>
            </aside>
          </div>
        </div>
      )}

      {/* =====================================================================
          5. RESULTS SCREEN
         ===================================================================== */}
      {phase === 'RESULTS' && (
        <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
          <div className="max-w-2xl w-full bg-[#0e1525] border border-slate-800 rounded-xl p-6 space-y-6 shadow-2xl">
            {/* Winner Banner */}
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400">
                <Trophy className="w-6 h-6" />
              </div>
              <h2 className="text-2xl font-bold text-white">
                {battleSnapshot.winner === 'P1'
                  ? `${battleSnapshot.p1.name} Wins!`
                  : battleSnapshot.winner === 'P2'
                  ? `${battleSnapshot.p2.name} Wins!`
                  : 'Match Draw!'}
              </h2>
              <p className="text-xs text-slate-400">
                {battleSnapshot.endReason === 'KNOCKOUT' &&
                  'Victory by opponent robot destruction'}
                {battleSnapshot.endReason === 'DOUBLE_KO' &&
                  'Simultaneous double knockout'}
                {battleSnapshot.endReason === 'TIMEOUT' &&
                  (battleSnapshot.winner === 'DRAW'
                    ? '60-second time limit reached with equal remaining health'
                    : '60-second time limit reached — won by higher remaining health')}
              </p>
            </div>

            {/* Side-by-Side Player Statistics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[battleSnapshot.p1, battleSnapshot.p2].map((p) => {
                const isWinner = battleSnapshot.winner === p.id;
                const accentBorder =
                  p.id === 'P1' ? 'border-sky-500/40' : 'border-rose-500/40';
                const accentText =
                  p.id === 'P1' ? 'text-sky-300' : 'text-rose-300';

                return (
                  <div
                    key={p.id}
                    className={`bg-slate-900/90 border ${accentBorder} rounded-lg p-4 space-y-3`}
                  >
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className={`font-bold text-sm ${accentText}`}>
                        {p.name}
                      </span>
                      {isWinner && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          WINNER
                        </span>
                      )}
                    </div>

                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Remaining Health</span>
                        <span className="font-mono font-semibold text-white">
                          {p.health} / {p.maxHealth} HP
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Damage Dealt</span>
                        <span className="font-mono font-semibold text-emerald-300">
                          {p.stats.damageDealt} HP
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">
                          Successful Laser Hits
                        </span>
                        <span className="font-mono font-semibold text-slate-200">
                          {p.stats.laserHits}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Bombs Placed</span>
                        <span className="font-mono font-semibold text-slate-200">
                          {p.stats.bombsPlaced}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Shockwaves Used</span>
                        <span className="font-mono font-semibold text-slate-200">
                          {p.stats.shockwavesUsed}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Action Buttons: Rematch & Return to Main Menu */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                type="button"
                onClick={handleRematch}
                className="flex-1 py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Rematch (New Programming Phase)</span>
              </button>

              <button
                type="button"
                onClick={onReturnToMainMenu}
                className="flex-1 py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Return to Main Menu</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

