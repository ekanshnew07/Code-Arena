import React, { useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import {
  Play,
  Square,
  RotateCcw,
  AlertTriangle,
  Trash2,
  Info,
} from 'lucide-react';
import {
  ExecutionLogEntry,
  GameStatus,
  ValidationError,
} from '../types/game';

interface CodeEditorProps {
  width: number;
  code: string;
  onChange: (value: string) => void;
  status: GameStatus;
  simulationActive?: boolean;
  shockwaveCooldownMs?: number;
  currentLine: number | null;
  currentInstruction: string | null;
  validationError: ValidationError | null;
  logs: ExecutionLogEntry[];
  onRun: () => void;
  onStop: () => void;
  onReset: () => void;
  onClearLogs: () => void;
}

export const DEFAULT_STARTER_CODE = `# Write instructions for your robot and press Run
while True:
    move_right()
    laser()
    wait(1)
`;

export const CodeEditor: React.FC<CodeEditorProps> = ({
  width,
  code,
  onChange,
  status,
  simulationActive = false,
  shockwaveCooldownMs = 0,
  currentLine,
  currentInstruction,
  validationError,
  logs,
  onRun,
  onStop,
  onReset,
  onClearLogs,
}) => {
  const isRunning = status === 'RUNNING';
  const consoleEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const getLogColor = (type: ExecutionLogEntry['type']): string => {
    switch (type) {
      case 'command':
        return 'text-sky-300';
      case 'error':
        return 'text-rose-400 font-medium';
      case 'warning':
        return 'text-amber-300';
      case 'success':
        return 'text-emerald-300 font-medium';
      default:
        return 'text-slate-300';
    }
  };

  const getExecutionStateText = (): { text: string; color: string } => {
    if (status === 'RUNNING') {
      return {
        text: currentInstruction
          ? `Line ${currentLine ?? '-'}: ${currentInstruction}`
          : 'Running...',
        color: 'text-emerald-300',
      };
    }
    if (status === 'STOPPED') {
      return {
        text: 'Stopped (Enemies remain active)',
        color: 'text-amber-300',
      };
    }
    if (status === 'ERROR') {
      return {
        text: 'Stopped due to code error',
        color: 'text-rose-300',
      };
    }
    if (status === 'VICTORY') {
      return {
        text: 'Completed — All enemies defeated!',
        color: 'text-emerald-300',
      };
    }
    if (status === 'GAME_OVER') {
      return {
        text: 'Halted — Robot destroyed',
        color: 'text-rose-300',
      };
    }
    if (!simulationActive) {
      return {
        text: 'Waiting — Press Run to begin',
        color: 'text-slate-400',
      };
    }
    return {
      text: 'Completed',
      color: 'text-emerald-300',
    };
  };

  const execState = getExecutionStateText();

  return (
    <section
      style={{ width: `${width}px` }}
      className="shrink-0 bg-[#0f1623] flex flex-col h-full overflow-hidden"
    >
      {/* Prominent Control Toolbar: RUN / STOP / RESET */}
      <div className="p-3 bg-[#0d131f] border-b border-slate-800/80 flex items-center justify-between gap-2 select-none">
        <div className="flex items-center gap-2 flex-1">
          <button
            type="button"
            onClick={onRun}
            disabled={isRunning}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              isRunning
                ? 'bg-emerald-950/40 border border-emerald-500/30 text-emerald-400/50 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs active:scale-[0.99]'
            }`}
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Run</span>
          </button>

          <button
            type="button"
            onClick={onStop}
            disabled={!isRunning}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-xs font-semibold border transition-all cursor-pointer ${
              !isRunning
                ? 'bg-slate-900/50 border-slate-800/80 text-slate-600 cursor-not-allowed'
                : 'bg-amber-500/15 hover:bg-amber-500/25 border-amber-500/40 text-amber-200 active:scale-[0.99]'
            }`}
            title="Stop your robot's script (enemies continue moving)"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>Stop</span>
          </button>

          <button
            type="button"
            onClick={onReset}
            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-xs font-medium bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/80 text-slate-200 transition-all cursor-pointer active:scale-[0.99]"
            title="Stop simulation and reset arena to initial state"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* First-Time Waiting State Onboarding Hint */}
      {!simulationActive && !validationError && (
        <div className="px-3.5 py-2 bg-sky-950/30 border-b border-sky-500/20 flex items-center gap-2.5 text-xs text-sky-200/90 select-none">
          <Info className="w-4 h-4 text-sky-400 shrink-0" />
          <span>
            Write your code below and press{' '}
            <strong className="font-semibold text-white">Run</strong> to start.
            Enemies stay paused until you begin.
          </span>
        </div>
      )}

      {/* Validation Error Alert Banner */}
      {validationError && (
        <div className="px-3.5 py-2.5 bg-rose-950/50 border-b border-rose-500/30 flex items-start gap-2.5 text-xs text-rose-200 select-none">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-rose-300">
              Syntax Error on Line {validationError.line}
            </div>
            <div className="text-xs text-rose-200/90 mt-0.5 break-words font-mono">
              {validationError.message}
            </div>
          </div>
        </div>
      )}

      {/* Clean Execution Status Bar */}
      <div className="h-8 px-3.5 bg-[#0b101b] border-b border-slate-800/80 flex items-center justify-between gap-2 text-xs select-none">
        <div className="flex items-center gap-2 truncate">
          <span className="text-slate-400 font-medium">Status:</span>
          <span className={`font-mono truncate ${execState.color}`}>
            {execState.text}
          </span>
        </div>
        {simulationActive && (
          <span
            className={`text-[11px] font-mono shrink-0 ${
              shockwaveCooldownMs > 0 ? 'text-amber-400' : 'text-sky-400'
            }`}
          >
            {shockwaveCooldownMs > 0
              ? `Shockwave: ${(shockwaveCooldownMs / 1000).toFixed(1)}s`
              : 'Shockwave: Ready'}
          </span>
        )}
      </div>

      {/* Monaco Editor Container */}
      <div className="flex-1 min-h-[200px] relative overflow-hidden bg-[#0a0e17]">
        <Editor
          height="100%"
          defaultLanguage="python"
          value={code}
          onChange={(val) => onChange(val ?? '')}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 13.5,
            fontFamily: "'JetBrains Mono', monospace",
            lineHeight: 22,
            padding: { top: 14, bottom: 14 },
            scrollBeyondLastLine: false,
            renderLineHighlight: 'all',
            cursorBlinking: 'smooth',
            smoothScrolling: true,
            tabSize: 4,
            insertSpaces: true,
            automaticLayout: true,
            overviewRulerBorder: false,
          }}
        />
      </div>

      {/* Compact Execution Output Panel */}
      <div className="h-40 shrink-0 bg-[#0b101b] border-t border-slate-800/80 flex flex-col">
        <div className="h-8 px-3.5 border-b border-slate-800/70 flex items-center justify-between select-none">
          <span className="text-xs font-semibold text-slate-300">
            Script Output
          </span>
          <button
            type="button"
            onClick={onClearLogs}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 px-2 py-0.5 rounded hover:bg-slate-800/70 transition-colors cursor-pointer"
            title="Clear script output"
          >
            <Trash2 className="w-3 h-3" />
            <span>Clear</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-1">
          {logs.length === 0 ? (
            <div className="text-slate-500">
              {simulationActive
                ? 'No script output yet.'
                : 'Ready. Press Run to execute your robot commands.'}
            </div>
          ) : (
            logs.map((entry) => (
              <div key={entry.id} className="leading-relaxed flex gap-2">
                <span className="text-slate-500 shrink-0 select-none">
                  {entry.timestamp}
                </span>
                <span className={`break-words ${getLogColor(entry.type)}`}>
                  {entry.message}
                </span>
              </div>
            ))
          )}
          <div ref={consoleEndRef} />
        </div>
      </div>
    </section>
  );
};
