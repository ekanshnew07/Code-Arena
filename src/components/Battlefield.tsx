import React, { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import {
  Maximize2,
  Minimize2,
  LayoutPanelLeft,
  Trash2,
  RotateCcw,
  ShieldAlert,
  Trophy,
  Expand,
  Shrink,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  PauseCircle,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import { ArenaScene } from '../game/scenes/ArenaScene';
import { GameController } from '../game/engine/GameController';
import {
  CombatEventCategory,
  CombatEventEntry,
  Direction,
  GameStateSnapshot,
  GameStatus,
  GridPosition,
} from '../types/game';

interface BattlefieldProps {
  controller: GameController;
  snapshot: GameStateSnapshot;
  status: GameStatus;
  combatEvents: CombatEventEntry[];
  isMaximized: boolean;
  onToggleMaximize: () => void;
  onRestoreDefaultLayout: () => void;
  onClearCombatEvents: () => void;
  onReset: () => void;
}

const FACING_LABELS: Record<Direction, string> = {
  east: 'Right (+X)',
  west: 'Left (-X)',
  north: 'Up (-Y)',
  south: 'Down (+Y)',
};

export const Battlefield: React.FC<BattlefieldProps> = ({
  controller,
  snapshot,
  status,
  combatEvents,
  isMaximized,
  onToggleMaximize,
  onRestoreDefaultLayout,
  onClearCombatEvents,
  onReset,
}) => {
  const battlefieldRootRef = useRef<HTMLElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const arenaSceneRef = useRef<ArenaScene | null>(null);
  const combatLogEndRef = useRef<HTMLDivElement | null>(null);

  const [hoveredCell, setHoveredCell] = useState<GridPosition | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isCombatLogCollapsed, setIsCombatLogCollapsed] =
    useState<boolean>(false);

  const expandedArena = isMaximized || isFullscreen;

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const handleToggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        if (battlefieldRootRef.current?.requestFullscreen) {
          await battlefieldRootRef.current.requestFullscreen();
        } else {
          await document.documentElement.requestFullscreen();
        }
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn('Fullscreen toggle failed:', err);
    }
  };

  useEffect(() => {
    combatLogEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [combatEvents]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const arenaScene = new ArenaScene(
      (pos) => {
        setHoveredCell(pos);
      },
      (readyScene) => {
        arenaSceneRef.current = readyScene;
        readyScene.setMaximizedMode(isMaximized || isFullscreen);
        controller.attachView(readyScene);
      },
      (time, delta) => {
        controller.updateSimulation(time, delta);
      }
    );
    arenaSceneRef.current = arenaScene;

    const config: Phaser.Types.Core.GameConfig = {
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

    const game = new Phaser.Game(config);
    gameRef.current = game;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && gameRef.current) {
          gameRef.current.scale.resize(Math.floor(width), Math.floor(height));
        }
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      controller.attachView(null);
      arenaSceneRef.current = null;
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, [controller]);

  // Synchronize maximized mode and trigger immediate resize calculation when layout changes
  useEffect(() => {
    arenaSceneRef.current?.setMaximizedMode(expandedArena);
    const syncDimensions = () => {
      const container = containerRef.current;
      if (container && gameRef.current) {
        const w = Math.floor(container.clientWidth);
        const h = Math.floor(container.clientHeight);
        if (w > 0 && h > 0) {
          gameRef.current.scale.resize(w, h);
        }
      }
    };
    const rafId = requestAnimationFrame(syncDimensions);
    const timerId = setTimeout(syncDimensions, 60);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timerId);
    };
  }, [expandedArena, isCombatLogCollapsed]);

  const getEventBadge = (
    cat: CombatEventCategory
  ): { label: string; style: string; textColor: string } => {
    switch (cat) {
      case 'spotted':
        return {
          label: 'Info',
          style: 'bg-sky-950/70 text-sky-300 border-sky-500/30',
          textColor: 'text-sky-200',
        };
      case 'approach':
        return {
          label: 'Move',
          style: 'bg-rose-950/70 text-rose-300 border-rose-500/30',
          textColor: 'text-rose-200',
        };
      case 'bomb':
        return {
          label: 'Bomb',
          style: 'bg-amber-950/70 text-amber-300 border-amber-500/30',
          textColor: 'text-amber-200',
        };
      case 'explosion':
        return {
          label: 'Blast',
          style: 'bg-orange-950/70 text-orange-300 border-orange-500/30',
          textColor: 'text-orange-200',
        };
      case 'laser':
        return {
          label: 'Laser',
          style: 'bg-purple-950/70 text-purple-300 border-purple-500/30',
          textColor: 'text-purple-200',
        };
      case 'shockwave':
        return {
          label: 'Pulse',
          style: 'bg-cyan-950/70 text-cyan-300 border-cyan-500/30',
          textColor: 'text-cyan-200',
        };
      case 'damage':
        return {
          label: 'Hit',
          style: 'bg-rose-950/80 text-rose-300 border-rose-500/40',
          textColor: 'text-rose-300 font-medium',
        };
      case 'defeated':
        return {
          label: 'Defeated',
          style: 'bg-emerald-950/70 text-emerald-300 border-emerald-500/30',
          textColor: 'text-emerald-300 font-medium',
        };
      default:
        return {
          label: 'System',
          style: 'bg-slate-800 text-slate-300 border-slate-700',
          textColor: 'text-slate-300',
        };
    }
  };

  // Detect active enemy attack warnings for unobtrusive alert pill
  const chargingLaserEnemy = snapshot.enemies.find(
    (e) =>
      e.alive &&
      e.archetype === 'LASER_SHOOTER' &&
      (e.aiState === 'AIM' || e.aiState === 'CHARGE')
  );
  const activeEnemyBomb = snapshot.bombs.find((b) => b.owner !== 'player');

  const totalEnemies = snapshot.enemies.length;
  const livingEnemiesCount = snapshot.enemies.filter(
    (e) => e.alive && e.health > 0
  ).length;
  const defeatedEnemiesCount = totalEnemies - livingEnemiesCount;

  return (
    <main
      ref={battlefieldRootRef}
      className="flex-1 min-w-[320px] flex flex-col h-full bg-[#060911] overflow-hidden select-none"
    >
      {/* Clean Battlefield Top Toolbar */}
      <div className="h-11 px-4 border-b border-slate-800/80 flex items-center justify-between gap-3 bg-[#0d131f] shrink-0">
        {/* Left: Enemy Status or Active Attack Warning */}
        <div className="flex items-center gap-2.5 min-w-0 overflow-x-auto">
          {!snapshot.simulationActive ? (
            <div className="flex items-center gap-1.5 text-xs text-slate-300 bg-slate-800/80 border border-slate-700/80 px-2.5 py-1 rounded-md shrink-0">
              <PauseCircle className="w-3.5 h-3.5 text-sky-400" />
              <span>Enemies Paused</span>
            </div>
          ) : chargingLaserEnemy ? (
            <div className="flex items-center gap-1.5 text-xs font-medium text-amber-200 bg-amber-950/60 border border-amber-500/40 px-2.5 py-1 rounded-md shrink-0 animate-pulse">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span>
                {chargingLaserEnemy.name} charging laser — move out of firing
                line!
              </span>
            </div>
          ) : activeEnemyBomb ? (
            <div className="flex items-center gap-1.5 text-xs font-medium text-amber-200 bg-amber-950/60 border border-amber-500/40 px-2.5 py-1 rounded-md shrink-0">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span>
                Bomb ticking at ({activeEnemyBomb.x}, {activeEnemyBomb.y}) —{' '}
                {activeEnemyBomb.countdown}s!
              </span>
            </div>
          ) : null}

          {/* Compact Enemy Health Pills (shown in top bar when not in expanded right-dock mode) */}
          {!expandedArena && (
            <div className="flex items-center gap-1.5 shrink-0">
              {snapshot.enemies.map((enemy) => {
                const isWarning =
                  enemy.aiState === 'CHARGE' ||
                  enemy.aiState === 'AIM' ||
                  enemy.aiState === 'ATTACK' ||
                  enemy.aiState === 'PLACE_BOMB';
                return (
                  <div
                    key={enemy.id}
                    className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs shrink-0 ${
                      !enemy.alive
                        ? 'bg-slate-900/40 border-slate-800/60 text-slate-600 line-through'
                        : isWarning
                        ? 'bg-rose-950/50 border-rose-500/40 text-rose-200'
                        : 'bg-slate-900/80 border-slate-800 text-slate-300'
                    }`}
                  >
                    <span className="font-medium">{enemy.name}</span>
                    <span className="font-mono text-[11px] text-slate-400">
                      {enemy.health}/{enemy.maxHealth}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Facing, Tile Coordinates & Layout Controls */}
        <div className="flex items-center gap-2.5 text-xs shrink-0">
          <div className="hidden md:flex items-center gap-1.5 text-slate-400">
            <span>Facing:</span>
            <span className="font-mono text-sky-300 font-medium">
              {FACING_LABELS[snapshot.player.facing]}
            </span>
          </div>

          <div className="h-3.5 w-px bg-slate-800 hidden md:block" />

          <div className="font-mono text-slate-300 min-w-[74px] text-right">
            {hoveredCell
              ? `(${hoveredCell.x}, ${hoveredCell.y})`
              : `(${snapshot.player.x}, ${snapshot.player.y})`}
          </div>

          <div className="h-3.5 w-px bg-slate-800" />

          {/* Restore Default Layout */}
          <button
            type="button"
            onClick={onRestoreDefaultLayout}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-800/70 hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white text-xs font-medium transition-colors cursor-pointer"
            title="Restore default three-panel layout"
          >
            <LayoutPanelLeft className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Reset View</span>
          </button>

          {/* Maximize / Restore Battlefield Toggle */}
          <button
            type="button"
            onClick={onToggleMaximize}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium transition-colors cursor-pointer ${
              isMaximized
                ? 'bg-sky-500/20 border-sky-400/50 text-sky-200'
                : 'bg-slate-800/70 hover:bg-slate-800 border-slate-700/80 text-slate-300 hover:text-white'
            }`}
            title={
              isMaximized
                ? 'Restore panels'
                : 'Maximize battlefield to fill screen'
            }
          >
            {isMaximized ? (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Restore Panels</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">Maximize</span>
              </>
            )}
          </button>

          {/* Fullscreen Toggle */}
          <button
            type="button"
            onClick={handleToggleFullscreen}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-medium transition-colors cursor-pointer ${
              isFullscreen
                ? 'bg-amber-500/20 border-amber-400/50 text-amber-200'
                : 'bg-slate-800/70 hover:bg-slate-800 border-slate-700/80 text-slate-300 hover:text-white'
            }`}
            title={
              isFullscreen ? 'Exit fullscreen' : 'Enter browser fullscreen'
            }
          >
            {isFullscreen ? (
              <>
                <Shrink className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">Exit Full</span>
              </>
            ) : (
              <>
                <Expand className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">Fullscreen</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Arena + Combat Event Log Container (Row in Maximized/Fullscreen for True Arena Scaling, Column in 3-Panel Mode) */}
      <div
        className={`flex-1 min-h-0 flex ${
          expandedArena ? 'flex-row' : 'flex-col'
        } overflow-hidden`}
      >
        {/* Phaser Canvas Viewport */}
        <div className="flex-1 min-w-0 min-h-0 relative overflow-hidden">
          <div ref={containerRef} className="absolute inset-0 w-full h-full" />

          {/* Unobtrusive Waiting State Banner on Battlefield */}
          {!snapshot.simulationActive &&
            status !== 'GAME_OVER' &&
            status !== 'VICTORY' && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
                <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-slate-700/90 text-xs text-slate-200 shadow-lg backdrop-blur-xs">
                  <span className="w-2 h-2 rounded-full bg-sky-400" />
                  <span>
                    Simulation paused — Write code and press{' '}
                    <strong className="text-white font-semibold">Run</strong> to
                    begin
                  </span>
                </div>
              </div>
            )}

          {/* Victory Modal Overlay */}
          {status === 'VICTORY' && (
            <div className="absolute inset-0 bg-[#050811]/80 backdrop-blur-[2px] flex items-center justify-center z-20 p-4">
              <div className="max-w-sm w-full bg-[#0e1525] border border-emerald-500/40 rounded-lg p-6 text-center shadow-2xl">
                <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center mx-auto mb-3 text-emerald-400">
                  <Trophy className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-100">
                  Victory — Sector Cleared!
                </h3>
                <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                  Your robot defeated all hostile units in the arena.
                </p>

                <div className="mt-4 grid grid-cols-2 gap-2 bg-slate-900/80 border border-slate-800 rounded-md p-3 text-xs">
                  <div>
                    <div className="text-slate-400">Remaining Health</div>
                    <div className="font-mono font-semibold text-emerald-300 mt-0.5">
                      {snapshot.player.health} / {snapshot.player.maxHealth} HP
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Enemies Defeated</div>
                    <div className="font-mono font-semibold text-slate-100 mt-0.5">
                      {defeatedEnemiesCount} / {totalEnemies}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onReset}
                  className="mt-5 w-full py-2.5 px-4 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Play Again</span>
                </button>
              </div>
            </div>
          )}

          {/* Game Over Modal Overlay */}
          {status === 'GAME_OVER' && (
            <div className="absolute inset-0 bg-[#050811]/80 backdrop-blur-[2px] flex items-center justify-center z-20 p-4">
              <div className="max-w-sm w-full bg-[#0e1525] border border-rose-500/40 rounded-lg p-6 text-center shadow-2xl">
                <div className="w-12 h-12 rounded-full bg-rose-500/15 border border-rose-500/40 flex items-center justify-center mx-auto mb-3 text-rose-400">
                  <ShieldAlert className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-100">
                  Robot Destroyed
                </h3>
                <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                  Your robot ran out of health. Refine your code strategy and
                  try again.
                </p>

                <div className="mt-4 grid grid-cols-2 gap-2 bg-slate-900/80 border border-slate-800 rounded-md p-3 text-xs">
                  <div>
                    <div className="text-slate-400">Remaining Health</div>
                    <div className="font-mono font-semibold text-rose-400 mt-0.5">
                      0 / {snapshot.player.maxHealth} HP
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Enemies Defeated</div>
                    <div className="font-mono font-semibold text-slate-100 mt-0.5">
                      {defeatedEnemiesCount} / {totalEnemies}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onReset}
                  className="mt-5 w-full py-2.5 px-4 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Reset & Try Again</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Combat Event Log (Right Side Dock when Maximized/Fullscreen, Bottom Strip in Normal 3-Panel Mode) */}
        {expandedArena ? (
          <aside
            className={`${
              isCombatLogCollapsed ? 'w-10' : 'w-72'
            } shrink-0 bg-[#0b101b] border-l border-slate-800/80 flex flex-col transition-[width] duration-150`}
          >
            <div className="h-9 px-3 border-b border-slate-800/80 flex items-center justify-between gap-2 shrink-0">
              {!isCombatLogCollapsed && (
                <span className="text-xs font-semibold text-slate-300 truncate">
                  Arena Status & Log
                </span>
              )}
              <div className="flex items-center gap-1 ml-auto">
                {!isCombatLogCollapsed && (
                  <button
                    type="button"
                    onClick={onClearCombatEvents}
                    className="p-1 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800/70 transition-colors cursor-pointer"
                    title="Clear combat log"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsCombatLogCollapsed((prev) => !prev)}
                  className="p-1 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800/70 transition-colors cursor-pointer"
                  title={
                    isCombatLogCollapsed
                      ? 'Expand side log'
                      : 'Collapse side log for maximum arena width'
                  }
                >
                  {isCombatLogCollapsed ? (
                    <PanelRightOpen className="w-4 h-4" />
                  ) : (
                    <PanelRightClose className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {!isCombatLogCollapsed && (
              <>
                {/* Enemy Units Summary */}
                <div className="p-3 border-b border-slate-800/80 space-y-1.5 shrink-0">
                  <div className="text-[11px] font-medium text-slate-400">
                    Enemy Units
                  </div>
                  {snapshot.enemies.map((enemy) => (
                    <div
                      key={enemy.id}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded border text-xs ${
                        !enemy.alive
                          ? 'bg-slate-900/40 border-slate-800/60 text-slate-600 line-through'
                          : 'bg-slate-900/80 border-slate-800 text-slate-200'
                      }`}
                    >
                      <span className="font-medium">{enemy.name}</span>
                      <span className="font-mono text-xs text-slate-400">
                        {enemy.health}/{enemy.maxHealth} HP
                      </span>
                    </div>
                  ))}
                </div>

                {/* Scrollable Combat Log */}
                <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-1.5">
                  {combatEvents.length === 0 ? (
                    <div className="text-slate-500">
                      {snapshot.simulationActive
                        ? 'Monitoring arena combat...'
                        : 'Paused. Press Run to start combat.'}
                    </div>
                  ) : (
                    combatEvents.map((ev) => {
                      const badge = getEventBadge(ev.category);
                      return (
                        <div
                          key={ev.id}
                          className="leading-snug flex items-start gap-1.5"
                        >
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.2 rounded border shrink-0 ${badge.style}`}
                          >
                            {badge.label}
                          </span>
                          <span className={`break-words ${badge.textColor}`}>
                            {ev.message}
                          </span>
                        </div>
                      );
                    })
                  )}
                  <div ref={combatLogEndRef} />
                </div>
              </>
            )}
          </aside>
        ) : (
          <div
            className={`${
              isCombatLogCollapsed ? 'h-8' : 'h-32'
            } shrink-0 bg-[#0b101b] border-t border-slate-800/80 flex flex-col transition-[height] duration-150`}
          >
            <div className="h-8 px-3.5 border-b border-slate-800/70 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-semibold text-slate-300 shrink-0">
                  Combat Log
                </span>
                {isCombatLogCollapsed && combatEvents.length > 0 && (
                  <span className="text-xs text-slate-400 truncate ml-2">
                    {combatEvents[combatEvents.length - 1].message}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsCombatLogCollapsed((prev) => !prev)}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 px-2 py-0.5 rounded hover:bg-slate-800/70 transition-colors cursor-pointer"
                >
                  {isCombatLogCollapsed ? (
                    <>
                      <ChevronUp className="w-3.5 h-3.5" />
                      <span>Expand</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5" />
                      <span>Collapse</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={onClearCombatEvents}
                  className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 px-2 py-0.5 rounded hover:bg-slate-800/70 transition-colors cursor-pointer"
                  title="Clear combat log"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Clear</span>
                </button>
              </div>
            </div>

            {!isCombatLogCollapsed && (
              <div className="flex-1 overflow-y-auto p-2.5 px-3.5 font-mono text-xs space-y-1">
                {combatEvents.length === 0 ? (
                  <div className="text-slate-500">
                    {snapshot.simulationActive
                      ? 'Monitoring arena combat...'
                      : 'Simulation paused. Press Run to start.'}
                  </div>
                ) : (
                  combatEvents.map((ev) => {
                    const badge = getEventBadge(ev.category);
                    return (
                      <div
                        key={ev.id}
                        className="flex items-center gap-2 leading-snug"
                      >
                        <span className="text-slate-500 shrink-0">
                          {ev.timestamp}
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.2 rounded border shrink-0 ${badge.style}`}
                        >
                          {badge.label}
                        </span>
                        <span className={`truncate ${badge.textColor}`}>
                          {ev.message}
                        </span>
                      </div>
                    );
                  })
                )}
                <div ref={combatLogEndRef} />
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
};
