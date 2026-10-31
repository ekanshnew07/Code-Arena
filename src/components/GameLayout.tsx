import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Header } from './Header';
import { CommandSidebar } from './CommandSidebar';
import { CodeEditor, DEFAULT_STARTER_CODE } from './CodeEditor';
import { Battlefield } from './Battlefield';
import { GameController } from '../game/engine/GameController';
import {
  CombatEventEntry,
  DifficultyLevel,
  ExecutionLogEntry,
  GameStateSnapshot,
  GameStatus,
  SimulationSpeed,
  ValidationError,
} from '../types/game';

const DEFAULT_SIDEBAR_WIDTH = 276;
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 420;

const DEFAULT_EDITOR_WIDTH = 440;
const MIN_EDITOR_WIDTH = 310;
const MAX_EDITOR_WIDTH = 740;

const MIN_BATTLEFIELD_WIDTH = 360;

interface GameLayoutProps {
  onOpenMainMenu?: () => void;
  onOpenPvP?: () => void;
}

export const GameLayout: React.FC<GameLayoutProps> = ({
  onOpenMainMenu,
  onOpenPvP,
}) => {
  const [code, setCode] = useState<string>(DEFAULT_STARTER_CODE);
  const [status, setStatus] = useState<GameStatus>('READY');
  const [currentLine, setCurrentLine] = useState<number | null>(null);
  const [currentInstruction, setCurrentInstruction] = useState<string | null>(
    null
  );
  const [validationError, setValidationError] =
    useState<ValidationError | null>(null);
  const [logs, setLogs] = useState<ExecutionLogEntry[]>([]);
  const [combatEvents, setCombatEvents] = useState<CombatEventEntry[]>([]);

  // Resizable panel layout state
  const [sidebarWidth, setSidebarWidth] = useState<number>(
    DEFAULT_SIDEBAR_WIDTH
  );
  const [editorWidth, setEditorWidth] = useState<number>(DEFAULT_EDITOR_WIDTH);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [isBattlefieldMaximized, setIsBattlefieldMaximized] =
    useState<boolean>(false);
  const [activeDivider, setActiveDivider] = useState<
    'sidebar' | 'editor' | null
  >(null);

  const layoutContainerRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<GameController | null>(null);

  if (!controllerRef.current) {
    controllerRef.current = new GameController({
      onStateChange: (nextSnapshot) => {
        setSnapshot(nextSnapshot);
      },
      onStatusChange: (nextStatus) => {
        setStatus(nextStatus);
      },
      onInstructionChange: (line, text) => {
        setCurrentLine(line);
        setCurrentInstruction(text);
      },
      onLogsChange: (nextLogs) => {
        setLogs(nextLogs);
      },
      onCombatEventsChange: (nextEvents) => {
        setCombatEvents(nextEvents);
      },
      onValidationError: (err) => {
        setValidationError(err);
      },
    });
  }

  const controller = controllerRef.current;
  const [snapshot, setSnapshot] = useState<GameStateSnapshot>(() =>
    controller.gameState.getSnapshot()
  );

  useEffect(() => {
    return () => {
      controller.stop();
    };
  }, [controller]);

  // Pointer drag resizing for panels
  useEffect(() => {
    if (!activeDivider) return;

    const handlePointerMove = (e: PointerEvent) => {
      const container = layoutContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const totalWidth = rect.width;

      if (activeDivider === 'sidebar') {
        const maxAllowed = Math.min(
          MAX_SIDEBAR_WIDTH,
          totalWidth - editorWidth - MIN_BATTLEFIELD_WIDTH
        );
        const clamped = Math.max(
          MIN_SIDEBAR_WIDTH,
          Math.min(maxAllowed, relX)
        );
        setSidebarWidth(clamped);
      } else if (activeDivider === 'editor') {
        const effectiveSidebarW = isSidebarCollapsed ? 44 : sidebarWidth;
        const proposedEditorW = relX - effectiveSidebarW;
        const maxAllowed = Math.min(
          MAX_EDITOR_WIDTH,
          totalWidth - effectiveSidebarW - MIN_BATTLEFIELD_WIDTH
        );
        const clamped = Math.max(
          MIN_EDITOR_WIDTH,
          Math.min(maxAllowed, proposedEditorW)
        );
        setEditorWidth(clamped);
      }
    };

    const handlePointerUp = () => {
      setActiveDivider(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [activeDivider, editorWidth, isSidebarCollapsed, sidebarWidth]);

  const handleRestoreDefaultLayout = useCallback(() => {
    setIsBattlefieldMaximized(false);
    setIsSidebarCollapsed(false);
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    setEditorWidth(DEFAULT_EDITOR_WIDTH);
  }, []);

  const handleRun = () => {
    controller.runCode(code);
  };

  const handleStop = () => {
    controller.stop();
  };

  const handleReset = () => {
    controller.reset();
  };

  const handleClearLogs = () => {
    controller.clearLogs();
  };

  const handleClearCombatEvents = () => {
    controller.clearCombatEvents();
  };

  const handleSpeedChange = (speed: SimulationSpeed) => {
    controller.setSimulationSpeed(speed);
  };

  const handleDifficultyChange = (level: DifficultyLevel) => {
    controller.setDifficulty(level);
  };

  const handleInsertSnippet = (snippet: string) => {
    setCode((prev) => {
      const trimmedEnd = prev.replace(/\s+$/, '');
      return trimmedEnd.length > 0
        ? `${trimmedEnd}\n${snippet}\n`
        : `${snippet}\n`;
    });
  };

  const livingEnemies = snapshot.enemies.filter(
    (e) => e.alive && e.health > 0
  ).length;

  return (
    <div
      className={`h-screen w-screen flex flex-col bg-[#070a10] text-slate-200 overflow-hidden ${
        activeDivider ? 'cursor-col-resize select-none' : ''
      }`}
    >
      <Header
        health={snapshot.player.health}
        maxHealth={snapshot.player.maxHealth}
        enemyCount={livingEnemies}
        totalEnemies={snapshot.enemies.length}
        status={status}
        simulationActive={snapshot.simulationActive}
        simulationSpeed={snapshot.simulationSpeed}
        difficulty={snapshot.difficulty}
        onSpeedChange={handleSpeedChange}
        onDifficultyChange={handleDifficultyChange}
        onOpenMainMenu={onOpenMainMenu}
        onOpenPvP={onOpenPvP}
      />

      <div
        ref={layoutContainerRef}
        className="flex-1 flex min-h-0 overflow-hidden relative"
      >
        {/* Left Sidebar & Center Editor (hidden when Battlefield is maximized) */}
        {!isBattlefieldMaximized && (
          <>
            <CommandSidebar
              width={sidebarWidth}
              collapsed={isSidebarCollapsed}
              onToggleCollapse={() =>
                setIsSidebarCollapsed((prev) => !prev)
              }
              snapshot={snapshot}
              onInsertSnippet={handleInsertSnippet}
            />

            {/* Draggable Splitter 1: Sidebar <-> Editor */}
            {!isSidebarCollapsed && (
              <div
                onPointerDown={() => setActiveDivider('sidebar')}
                className={`w-1.5 shrink-0 cursor-col-resize transition-colors flex items-center justify-center group ${
                  activeDivider === 'sidebar'
                    ? 'bg-sky-500/60'
                    : 'bg-slate-800/80 hover:bg-sky-500/40'
                }`}
                title="Drag to resize sidebar"
              >
                <div className="w-0.5 h-8 rounded bg-slate-600 group-hover:bg-sky-300" />
              </div>
            )}

            <CodeEditor
              width={editorWidth}
              code={code}
              onChange={(val) => {
                setCode(val);
                if (validationError) {
                  setValidationError(null);
                }
              }}
              status={status}
              simulationActive={snapshot.simulationActive}
              shockwaveCooldownMs={snapshot.player.shockwaveCooldownRemainingMs}
              currentLine={currentLine}
              currentInstruction={currentInstruction}
              validationError={validationError}
              logs={logs}
              onRun={handleRun}
              onStop={handleStop}
              onReset={handleReset}
              onClearLogs={handleClearLogs}
            />

            {/* Draggable Splitter 2: Editor <-> Battlefield */}
            <div
              onPointerDown={() => setActiveDivider('editor')}
              className={`w-1.5 shrink-0 cursor-col-resize transition-colors flex items-center justify-center group ${
                activeDivider === 'editor'
                  ? 'bg-sky-500/60'
                  : 'bg-slate-800/80 hover:bg-sky-500/40'
              }`}
              title="Drag to resize code editor and battlefield"
            >
              <div className="w-0.5 h-8 rounded bg-slate-600 group-hover:bg-sky-300" />
            </div>
          </>
        )}

        {/* Right / Main Area: Phaser Battlefield */}
        <Battlefield
          controller={controller}
          snapshot={snapshot}
          status={status}
          combatEvents={combatEvents}
          isMaximized={isBattlefieldMaximized}
          onToggleMaximize={() =>
            setIsBattlefieldMaximized((prev) => !prev)
          }
          onRestoreDefaultLayout={handleRestoreDefaultLayout}
          onClearCombatEvents={handleClearCombatEvents}
          onReset={handleReset}
        />
      </div>
    </div>
  );
};
