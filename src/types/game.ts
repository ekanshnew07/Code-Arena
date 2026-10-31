export type GameStatus =
  | 'READY'
  | 'RUNNING'
  | 'STOPPED'
  | 'ERROR'
  | 'GAME_OVER'
  | 'VICTORY';

export type SimulationSpeed = 0.5 | 1 | 2;

export type DifficultyLevel = 'Easy' | 'Normal' | 'Hard';

export interface CommandItem {
  name: string;
  signature: string;
  description: string;
  category: 'Movement' | 'Weapons' | 'Control' | 'Variables';
  returnType?: string;
}

export interface GridPosition {
  x: number;
  y: number;
}

export type Direction = 'east' | 'west' | 'north' | 'south';

export type EnemyArchetype = 'CHASER' | 'BOMBER' | 'LASER_SHOOTER';

export type ChaserAIState = 'CHASE' | 'ATTACK' | 'COOLDOWN' | 'DEFEATED';
export type BomberAIState = 'TRACK' | 'PLACE_BOMB' | 'COOLDOWN' | 'DEFEATED';
export type LaserShooterAIState =
  | 'SEARCH'
  | 'AIM'
  | 'CHARGE'
  | 'FIRE'
  | 'COOLDOWN'
  | 'DEFEATED';

export type EnemyAIState =
  | ChaserAIState
  | BomberAIState
  | LaserShooterAIState;

export interface EnemyState {
  id: string;
  name: string;
  archetype: EnemyArchetype;
  aiState: EnemyAIState;
  x: number;
  y: number;
  facing: Direction;
  health: number;
  maxHealth: number;
  alive: boolean;
  /** Elapsed ms in current AI state */
  stateTimerMs: number;
  /** Elapsed ms since last grid move */
  moveTimerMs: number;
  /** Initial spawn grace period remaining before first action */
  initialDelayRemainingMs?: number;
  /** Locked target coordinates for AIM/CHARGE/FIRE or PLACE_BOMB */
  lockedTarget?: GridPosition;
  /** Locked firing axis direction for LASER_SHOOTER */
  lockedDirection?: Direction;
  /** Charge progress 0..1 when charging or aiming */
  chargeProgress?: number;
}

export interface BombState {
  id: string;
  owner: 'player' | string;
  x: number;
  y: number;
  countdown: number; // integer seconds/steps remaining (3, 2, 1)
  elapsedMs: number;
  stepDurationMs: number;
  blastRadius: number;
  damage: number;
}

export interface GameStateSnapshot {
  gridSize: number;
  simulationSpeed: SimulationSpeed;
  difficulty: DifficultyLevel;
  simulationActive: boolean;
  player: {
    x: number;
    y: number;
    health: number;
    maxHealth: number;
    facing: Direction;
    invulnerableRemainingMs: number;
    shockwaveCooldownRemainingMs: number;
    prevX: number;
    prevY: number;
  };
  enemies: EnemyState[];
  walls: GridPosition[];
  bombs: BombState[];
}

export interface ExecutionLogEntry {
  id: string;
  timestamp: string;
  message: string;
  type: 'info' | 'command' | 'warning' | 'error' | 'success';
  line?: number;
}

export type CombatEventCategory =
  | 'spotted'
  | 'approach'
  | 'bomb'
  | 'explosion'
  | 'laser'
  | 'shockwave'
  | 'damage'
  | 'defeated'
  | 'system';

export interface CombatEventEntry {
  id: string;
  timestamp: string;
  category: CombatEventCategory;
  message: string;
}

export interface ValidationError {
  line: number;
  message: string;
}
