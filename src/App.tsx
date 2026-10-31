import React, { useState } from 'react';
import { GameLayout } from './components/GameLayout';
import { MainMenu } from './components/MainMenu';
import { PvPModeLayout } from './components/pvp/PvPModeLayout';
import { GameMode } from './game/pvp/pvpTypes';

export function App(): React.ReactElement {
  const [mode, setMode] = useState<GameMode>('MENU');

  if (mode === 'SINGLE_PLAYER') {
    return (
      <GameLayout
        onOpenMainMenu={() => setMode('MENU')}
        onOpenPvP={() => setMode('LOCAL_PVP')}
      />
    );
  }

  if (mode === 'LOCAL_PVP') {
    return <PvPModeLayout onReturnToMainMenu={() => setMode('MENU')} />;
  }

  return <MainMenu onSelectMode={setMode} />;
}

export default App;

