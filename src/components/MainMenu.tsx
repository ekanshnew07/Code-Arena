import React from 'react';
import { Bot, Swords, ArrowRight, Terminal, Shield, Clock } from 'lucide-react';
import { GameMode } from '../game/pvp/pvpTypes';

interface MainMenuProps {
  onSelectMode: (mode: GameMode) => void;
}

export const MainMenu: React.FC<MainMenuProps> = ({ onSelectMode }) => {
  return (
    <div className="h-screen w-screen bg-[#070a10] text-slate-100 flex flex-col justify-between overflow-y-auto select-none">
      {/* Top Bar */}
      <header className="h-14 px-6 border-b border-slate-800/80 bg-[#0d131f] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.6)]" />
          <span className="font-semibold tracking-tight text-base text-white">
            Code Arena
          </span>
        </div>
        <span className="text-xs text-slate-400">
          Tactical Robot Programming Game
        </span>
      </header>

      {/* Center Content */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-4xl w-full space-y-8">
          <div className="text-center space-y-2.5">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
              Choose Your Game Mode
            </h1>
            <p className="text-sm text-slate-400 max-w-xl mx-auto">
              Program autonomous combat robots using Python-style commands and
              watch your strategy unfold on the battlefield.
            </p>
          </div>

          {/* Mode Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Option 1: Single Player Campaign */}
            <button
              type="button"
              onClick={() => onSelectMode('SINGLE_PLAYER')}
              className="group text-left bg-[#0e1525] hover:bg-[#131c31] border border-slate-800 hover:border-sky-500/50 rounded-xl p-6 transition-all flex flex-col justify-between cursor-pointer shadow-lg"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="w-11 h-11 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400">
                    <Bot className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-sky-950/60 border border-sky-500/30 text-sky-300">
                    Campaign
                  </span>
                </div>

                <div>
                  <h2 className="text-xl font-bold text-white group-hover:text-sky-300 transition-colors">
                    Single Player
                  </h2>
                  <p className="text-xs font-medium text-slate-400 mt-0.5">
                    Level 1: First Contact
                  </p>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  Write loops, conditionals, and combat scripts to defeat three
                  independent AI enemy archetypes in real time.
                </p>

                <div className="pt-2 space-y-1.5 text-xs text-slate-400">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span>Full Python-lite loops, conditions & variables</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Shield className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span>Easy, Normal & Hard difficulty presets</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs font-semibold text-sky-400 group-hover:text-sky-300">
                <span>Launch Single Player</span>
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </div>
            </button>

            {/* Option 2: Local Hot-Seat PvP */}
            <button
              type="button"
              onClick={() => onSelectMode('LOCAL_PVP')}
              className="group text-left bg-[#0e1525] hover:bg-[#131c31] border border-slate-800 hover:border-rose-500/50 rounded-xl p-6 transition-all flex flex-col justify-between cursor-pointer shadow-lg"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="w-11 h-11 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
                    <Swords className="w-5 h-5" />
                  </div>
                  <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-rose-950/60 border border-rose-500/30 text-rose-300">
                    2 Players • Hot-Seat
                  </span>
                </div>

                <div>
                  <h2 className="text-xl font-bold text-white group-hover:text-rose-300 transition-colors">
                    Local PvP — Robot Duel
                  </h2>
                  <p className="text-xs font-medium text-slate-400 mt-0.5">
                    Same-Laptop Tactical Programming Duel
                  </p>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  Two players secretly program up to 12 instructions each. Watch
                  both robots execute simultaneously in a 60-second arena battle.
                </p>

                <div className="pt-2 space-y-1.5 text-xs text-slate-400">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    <span>60s secret programming turn per player</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Swords className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    <span>12 instruction slots • Simultaneous execution</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs font-semibold text-rose-400 group-hover:text-rose-300">
                <span>Start Local PvP Duel</span>
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </div>
            </button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="h-10 px-6 border-t border-slate-800/60 flex items-center justify-center text-xs text-slate-500 shrink-0">
        Code Arena • Single Player & Local Hot-Seat PvP
      </footer>
    </div>
  );
};

