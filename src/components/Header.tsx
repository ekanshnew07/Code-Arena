import React from 'react';
import { Heart, ShieldAlert, Swords, LayoutGrid } from 'lucide-react';
import { DifficultyLevel, GameStatus, SimulationSpeed } from '../types/game';

interface HeaderProps {
  health: number;
  maxHealth: number;
  enemyCount: number;
  totalEnemies?: number;
  status: GameStatus;
  simulationActive: boolean;
  simulationSpeed: SimulationSpeed;
  difficulty: DifficultyLevel;
  onSpeedChange: (speed: SimulationSpeed) => void;
  onDifficultyChange: (diff: DifficultyLevel) => void;
  onOpenMainMenu?: () => void;
  onOpenPvP?: () => void;
}

const SPEEDS: SimulationSpeed[] = [0.5, 1, 2];
const DIFFICULTIES: DifficultyLevel[] = ['Easy', 'Normal', 'Hard'];

export const Header: React.FC<HeaderProps> = ({
  health,
  maxHealth,
  enemyCount,
  totalEnemies = 3,
  status,
  simulationActive,
  simulationSpeed,
  difficulty,
  onSpeedChange,
  onDifficultyChange,
  onOpenMainMenu,
  onOpenPvP,
}) => {
  const healthPercent = Math.max(
    0,
    Math.min(100, Math.round((health / maxHealth) * 100))
  );

  const getStatusPresentation = (): {
    label: string;
    dot: string;
    badge: string;
  } => {
    if (status === 'VICTORY') {
      return {
        label: 'Victory',
        dot: 'bg-emerald-400',
        badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      };
    }
    if (status === 'GAME_OVER') {
      return {
        label: 'Defeated',
        dot: 'bg-rose-500 animate-ping',
        badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
      };
    }
    if (status === 'ERROR') {
      return {
        label: 'Code Error',
        dot: 'bg-rose-400',
        badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
      };
    }
    if (status === 'RUNNING') {
      return {
        label: 'Running',
        dot: 'bg-emerald-400 animate-pulse',
        badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      };
    }
    if (status === 'STOPPED') {
      return {
        label: 'Script Stopped',
        dot: 'bg-amber-400',
        badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
      };
    }
    if (!simulationActive) {
      return {
        label: 'Waiting to Start',
        dot: 'bg-sky-400',
        badge: 'bg-slate-800/90 text-slate-200 border-slate-700',
      };
    }
    return {
      label: 'Completed',
      dot: 'bg-emerald-400',
      badge: 'bg-slate-800/90 text-emerald-300 border-emerald-500/30',
    };
  };

  const statusInfo = getStatusPresentation();

  const healthBarColor =
    healthPercent > 50
      ? 'bg-emerald-500'
      : healthPercent > 25
      ? 'bg-amber-500'
      : 'bg-rose-500';

  return (
    <header className="h-13 shrink-0 bg-[#0d131f] border-b border-slate-800/80 px-4 lg:px-5 flex items-center justify-between gap-4 select-none overflow-x-auto">
      {/* Left: Game Title & Level */}
      <div className="flex items-center gap-3 shrink-0">
        {onOpenMainMenu && (
          <button
            type="button"
            onClick={onOpenMainMenu}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-700/80 px-2.5 py-1 rounded-md transition-colors cursor-pointer"
            title="Open Main Menu"
          >
            <LayoutGrid className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">Modes</span>
          </button>
        )}
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.6)]" />
          <span className="font-semibold tracking-tight text-base text-slate-100">
            Code Arena
          </span>
        </div>
        <span className="text-slate-600 hidden sm:inline">/</span>
        <span className="hidden sm:inline text-xs font-medium text-slate-400">
          Level 1: First Contact
        </span>
      </div>

      {/* Center: Primary Gameplay Status (Health, Enemies, Execution State) */}
      <div className="flex items-center gap-4 lg:gap-6 shrink-0">
        {/* 1. Player Health */}
        <div className="flex items-center gap-2.5 bg-slate-900/80 border border-slate-800/90 px-3 py-1 rounded-md">
          <Heart className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-xs font-medium text-slate-300 hidden md:inline">
            Health
          </span>
          <div className="w-24 sm:w-32 h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-200 rounded-full ${healthBarColor}`}
              style={{ width: `${healthPercent}%` }}
            />
          </div>
          <span className="text-xs font-mono font-semibold text-slate-100 min-w-[58px] text-right">
            {health}/{maxHealth}
          </span>
        </div>

        {/* 2. Enemies Remaining */}
        <div className="flex items-center gap-2 bg-slate-900/80 border border-slate-800/90 px-3 py-1 rounded-md">
          <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
          <span className="text-xs font-medium text-slate-300 hidden sm:inline">
            Enemies
          </span>
          <span className="text-xs font-mono font-semibold text-slate-100">
            {enemyCount}/{totalEnemies}
          </span>
        </div>

        {/* 3. Clear Game Status Pill */}
        <div
          className={`flex items-center gap-2 px-3 py-1 rounded-md border text-xs font-medium ${statusInfo.badge}`}
        >
          <span className={`w-2 h-2 rounded-full ${statusInfo.dot}`} />
          <span>{statusInfo.label}</span>
        </div>
      </div>

      {/* Right: Difficulty & Speed Controls */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Difficulty Selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-400 hidden xl:inline">
            Difficulty
          </span>
          <div className="flex items-center bg-slate-900 p-0.5 rounded-md border border-slate-800">
            {DIFFICULTIES.map((diff) => {
              const active = difficulty === diff;
              return (
                <button
                  key={diff}
                  type="button"
                  onClick={() => onDifficultyChange(diff)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                    active
                      ? 'bg-slate-800 text-slate-100 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title={`Set difficulty to ${diff}`}
                >
                  {diff}
                </button>
              );
            })}
          </div>
        </div>

        {/* Simulation Speed Selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-400 hidden xl:inline">Speed</span>
          <div className="flex items-center bg-slate-900 p-0.5 rounded-md border border-slate-800">
            {SPEEDS.map((spd) => {
              const active = simulationSpeed === spd;
              return (
                <button
                  key={spd}
                  type="button"
                  onClick={() => onSpeedChange(spd)}
                  className={`px-2 py-1 text-xs font-mono font-medium rounded transition-colors cursor-pointer ${
                    active
                      ? 'bg-slate-800 text-sky-300 shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title={`Set game speed to ${spd}x`}
                >
                  {spd}×
                </button>
              );
            })}
          </div>
        </div>

        {/* Quick switch to Local PvP */}
        {onOpenPvP && (
          <button
            type="button"
            onClick={onOpenPvP}
            className="flex items-center gap-1.5 text-xs font-medium text-rose-300 hover:text-white bg-rose-950/50 hover:bg-rose-900/60 border border-rose-500/30 px-2.5 py-1 rounded-md transition-colors cursor-pointer"
            title="Switch to Local Hot-Seat PvP Mode"
          >
            <Swords className="w-3.5 h-3.5 text-rose-400" />
            <span className="hidden md:inline">Local PvP</span>
          </button>
        )}
      </div>
    </header>
  );
};
