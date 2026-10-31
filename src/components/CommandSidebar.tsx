import React from 'react';
import {
  Move,
  Zap,
  Clock,
  Database,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { CommandItem, GameStateSnapshot } from '../types/game';

interface CommandExampleItem extends CommandItem {
  snippet?: string;
}

const INITIAL_COMMANDS: CommandExampleItem[] = [
  // Movement
  {
    name: 'move_right',
    signature: 'move_right()',
    description: 'Move 1 tile right (+X) and face right.',
    category: 'Movement',
  },
  {
    name: 'move_left',
    signature: 'move_left()',
    description: 'Move 1 tile left (-X) and face left.',
    category: 'Movement',
  },
  {
    name: 'move_up',
    signature: 'move_up()',
    description: 'Move 1 tile up (-Y) and face up.',
    category: 'Movement',
  },
  {
    name: 'move_down',
    signature: 'move_down()',
    description: 'Move 1 tile down (+Y) and face down.',
    category: 'Movement',
  },
  // Weapons
  {
    name: 'laser',
    signature: 'laser()',
    description:
      'Fire a beam in the direction your robot is facing (35 damage).',
    category: 'Weapons',
  },
  {
    name: 'shockwave',
    signature: 'shockwave()',
    description:
      'Emit a circular pulse damaging enemies within 2 tiles (25 damage, 5s cooldown).',
    category: 'Weapons',
  },
  {
    name: 'bomb',
    signature: 'bomb(x, y)',
    description:
      'Place a timed charge at (x, y) that explodes in a 3×3 area (55 damage).',
    category: 'Weapons',
  },
  // Control
  {
    name: 'wait',
    signature: 'wait(1)',
    description: 'Pause script execution for the given number of ticks.',
    category: 'Control',
  },
  {
    name: 'for_range',
    signature: 'for i in range(4):',
    snippet: 'for i in range(4):\n    move_right()',
    description: 'Repeat indented commands a fixed number of times.',
    category: 'Control',
  },
  {
    name: 'while_loop',
    signature: 'while True:',
    snippet: 'while True:\n    laser()\n    wait(1)',
    description: 'Repeat indented commands continuously.',
    category: 'Control',
  },
  // Variables
  {
    name: 'x',
    signature: 'x',
    description: 'Your robot X coordinate (0–14).',
    category: 'Variables',
  },
  {
    name: 'y',
    signature: 'y',
    description: 'Your robot Y coordinate (0–14).',
    category: 'Variables',
  },
  {
    name: 'health',
    signature: 'health',
    description: 'Your current health (0–100).',
    category: 'Variables',
  },
  {
    name: 'enemy_count',
    signature: 'enemy_count',
    description: 'Number of living enemies remaining.',
    category: 'Variables',
  },
  {
    name: 'enemy_x',
    signature: 'enemy_x',
    description: 'X position of the nearest enemy.',
    category: 'Variables',
  },
  {
    name: 'enemy_y',
    signature: 'enemy_y',
    description: 'Y position of the nearest enemy.',
    category: 'Variables',
  },
];

interface CommandSidebarProps {
  width: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  snapshot?: GameStateSnapshot;
  onInsertSnippet?: (snippet: string) => void;
}

export const CommandSidebar: React.FC<CommandSidebarProps> = ({
  width,
  collapsed,
  onToggleCollapse,
  snapshot,
  onInsertSnippet,
}) => {
  if (collapsed) {
    return (
      <aside className="w-11 shrink-0 bg-[#0d131f] border-r border-slate-800/80 flex flex-col items-center py-3 select-none">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="p-1.5 rounded-md bg-slate-800/70 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
          title="Expand Commands Sidebar"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
        <div className="mt-6 flex-1 flex items-center justify-center">
          <span className="text-xs font-medium tracking-wide text-slate-400 [writing-mode:vertical-rl] rotate-180">
            Commands
          </span>
        </div>
      </aside>
    );
  }

  const movementCommands = INITIAL_COMMANDS.filter(
    (c) => c.category === 'Movement'
  );
  const weaponCommands = INITIAL_COMMANDS.filter(
    (c) => c.category === 'Weapons'
  );
  const controlCommands = INITIAL_COMMANDS.filter(
    (c) => c.category === 'Control'
  );
  const variableItems = INITIAL_COMMANDS.filter(
    (c) => c.category === 'Variables'
  );

  const getLiveVariableValue = (name: string): number | string => {
    if (!snapshot) return '--';
    const living = snapshot.enemies.filter((e) => e.alive && e.health > 0);
    let nearest = living[0] ?? null;
    if (nearest) {
      let bestDist =
        Math.abs(nearest.x - snapshot.player.x) +
        Math.abs(nearest.y - snapshot.player.y);
      for (let i = 1; i < living.length; i++) {
        const d =
          Math.abs(living[i].x - snapshot.player.x) +
          Math.abs(living[i].y - snapshot.player.y);
        if (d < bestDist) {
          bestDist = d;
          nearest = living[i];
        }
      }
    }

    switch (name) {
      case 'x':
        return snapshot.player.x;
      case 'y':
        return snapshot.player.y;
      case 'health':
        return snapshot.player.health;
      case 'enemy_count':
        return living.length;
      case 'enemy_x':
        return nearest ? nearest.x : -1;
      case 'enemy_y':
        return nearest ? nearest.y : -1;
      default:
        return '--';
    }
  };

  return (
    <aside
      style={{ width: `${width}px` }}
      className="shrink-0 bg-[#0d131f] flex flex-col h-full select-none overflow-hidden"
    >
      {/* Panel Header */}
      <div className="h-11 px-4 border-b border-slate-800/80 flex items-center justify-between">
        <h2 className="text-xs font-semibold text-slate-200 tracking-wide">
          Commands & Reference
        </h2>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="p-1 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer shrink-0"
          title="Collapse Sidebar"
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable Documentation List */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-5">
        {/* Movement Section */}
        <section>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-2">
            <Move className="w-3.5 h-3.5 text-sky-400" />
            <span>Movement</span>
          </div>
          <div className="space-y-1.5">
            {movementCommands.map((cmd) => (
              <button
                key={cmd.name}
                type="button"
                onClick={() => onInsertSnippet?.(cmd.snippet ?? cmd.signature)}
                className="w-full text-left p-2.5 rounded-md bg-slate-900/70 hover:bg-slate-800/80 border border-slate-800/80 hover:border-slate-700 transition-colors cursor-pointer group"
                title="Click to insert into editor"
              >
                <div className="font-mono text-xs font-medium text-sky-300 group-hover:text-sky-200">
                  {cmd.signature}
                </div>
                <p className="text-xs text-slate-400 mt-0.5 leading-snug">
                  {cmd.description}
                </p>
              </button>
            ))}
          </div>
        </section>

        {/* Weapons Section */}
        <section>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-2">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>Attacks</span>
          </div>
          <div className="space-y-1.5">
            {weaponCommands.map((cmd) => (
              <button
                key={cmd.name}
                type="button"
                onClick={() => onInsertSnippet?.(cmd.snippet ?? cmd.signature)}
                className="w-full text-left p-2.5 rounded-md bg-slate-900/70 hover:bg-slate-800/80 border border-slate-800/80 hover:border-slate-700 transition-colors cursor-pointer group"
                title="Click to insert into editor"
              >
                <div className="font-mono text-xs font-medium text-amber-300 group-hover:text-amber-200">
                  {cmd.signature}
                </div>
                <p className="text-xs text-slate-400 mt-0.5 leading-snug">
                  {cmd.description}
                </p>
              </button>
            ))}
          </div>
        </section>

        {/* Control & Loops Section */}
        <section>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-2">
            <Clock className="w-3.5 h-3.5 text-emerald-400" />
            <span>Control & Loops</span>
          </div>
          <div className="space-y-1.5">
            {controlCommands.map((cmd) => (
              <button
                key={cmd.name}
                type="button"
                onClick={() => onInsertSnippet?.(cmd.snippet ?? cmd.signature)}
                className="w-full text-left p-2.5 rounded-md bg-slate-900/70 hover:bg-slate-800/80 border border-slate-800/80 hover:border-slate-700 transition-colors cursor-pointer group"
                title="Click to insert into editor"
              >
                <div className="font-mono text-xs font-medium text-emerald-300 group-hover:text-emerald-200">
                  {cmd.signature}
                </div>
                <p className="text-xs text-slate-400 mt-0.5 leading-snug">
                  {cmd.description}
                </p>
              </button>
            ))}
          </div>
        </section>

        {/* Variables Section */}
        <section>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-2">
            <Database className="w-3.5 h-3.5 text-purple-400" />
            <span>Robot Variables</span>
          </div>
          <div className="space-y-1.5">
            {variableItems.map((item) => {
              const liveVal = getLiveVariableValue(item.name);
              return (
                <div
                  key={item.name}
                  className="p-2.5 rounded-md bg-slate-900/60 border border-slate-800/80"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-medium text-purple-300">
                      {item.signature}
                    </span>
                    <span className="text-xs font-mono font-semibold px-1.5 py-0.5 rounded bg-slate-800 text-slate-200">
                      {liveVal}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 leading-snug">
                    {item.description}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </aside>
  );
};
