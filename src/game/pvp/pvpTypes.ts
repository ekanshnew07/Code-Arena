import {
  BombState,
  CombatEventEntry,
  Direction,
  GridPosition,
  ValidationError,
} from '../../types/game';
import { SupportedCommandName } from '../../interpreter/gameApi';

export type GameMode = 'MENU' | 'SINGLE_PLAYER' | 'LOCAL_PVP';

export type PvPPhase =
  | 'SETUP'
  | 'P1_PROGRAMMING'
  | 'HANDOVER'
  | 'P2_PROGRAMMING'
  | 'BATTLE'
  | 'RESULTS';

export type PvPPlayerId = 'P1' | 'P2';

export type PvPExecutionState = 'RUNNING' | 'WAITING' | 'FINISHED' | 'DEFEATED';

export type PvPWinner = 'P1' | 'P2' | 'DRAW' | null;

export type PvPEndReason = 'KNOCKOUT' | 'DOUBLE_KO' | 'TIMEOUT' | null;

export interface PvPInstruction {
  command: SupportedCommandName;
  args: number[];
  line: number;
  formatted: string;
}

export interface PvPValidationResult {
  valid: boolean;
  instructions: PvPInstruction[];
  instructionCount: number;
  remainingSlots: number;
  error: ValidationError | null;
}

export interface PvPPlayerStats {
  damageDealt: number;
  laserHits: number;
  bombsPlaced: number;
  shockwavesUsed: number;
  instructionsExecuted: number;
}

export interface PvPPlayerSnapshot {
  id: PvPPlayerId;
  name: string;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  facing: Direction;
  health: number;
  maxHealth: number;
  alive: boolean;
  invulnerableRemainingMs: number;
  shockwaveCooldownRemainingMs: number;
  instructionPointer: number;
  totalInstructions: number;
  executionState: PvPExecutionState;
  nextActionTimeMs: number;
  lastActionText: string;
  stats: PvPPlayerStats;
  variables: Record<string, number>;
}

export interface PvPBattleSnapshot {
  gridSize: number;
  battleElapsedMs: number;
  battleRemainingSeconds: number;
  battleDurationSeconds: number;
  isBattleActive: boolean;
  isBattleFinished: boolean;
  winner: PvPWinner;
  endReason: PvPEndReason;
  p1: PvPPlayerSnapshot;
  p2: PvPPlayerSnapshot;
  walls: GridPosition[];
  bombs: BombState[];
}

export interface PvPMatchConfig {
  gridSize: number;
  maxHealth: number;
  maxInstructionSlots: number;
  programmingTimeSeconds: number;
  battleDurationSeconds: number;
  instructionIntervalMs: number;
  waitMinSeconds: number;
  waitMaxSeconds: number;
  laserDamage: number;
  laserRange: number;
  bombDamage: number;
  bombBlastRadius: number;
  bombCountdownTicks: number;
  bombStepDurationMs: number;
  shockwaveDamage: number;
  shockwaveRadius: number;
  shockwaveCooldownMs: number;
  invulnerabilityDurationMs: number;
  p1Spawn: { x: number; y: number; facing: Direction };
  p2Spawn: { x: number; y: number; facing: Direction };
  initialWalls: GridPosition[];
}

export const DEFAULT_PVP_CONFIG: PvPMatchConfig = {
  gridSize: 15,
  maxHealth: 100,
  maxInstructionSlots: 12,
  programmingTimeSeconds: 60,
  battleDurationSeconds: 60,
  instructionIntervalMs: 700,
  waitMinSeconds: 1,
  waitMaxSeconds: 10,
  laserDamage: 35,
  laserRange: 14,
  bombDamage: 55,
  bombBlastRadius: 1,
  bombCountdownTicks: 3,
  bombStepDurationMs: 700,
  shockwaveDamage: 25,
  shockwaveRadius: 2,
  shockwaveCooldownMs: 5000,
  invulnerabilityDurationMs: 1000,
  p1Spawn: { x: 2, y: 7, facing: 'east' },
  p2Spawn: { x: 12, y: 7, facing: 'west' },
  initialWalls: [
    { x: 5, y: 3 },
    { x: 5, y: 11 },
    { x: 9, y: 3 },
    { x: 9, y: 11 },
  ],
};

export interface IPvPArenaView {
  initPvPArena(snapshot: PvPBattleSnapshot): void;
  syncPvPState(snapshot: PvPBattleSnapshot): void;
  updatePvPRealtimeVisuals(snapshot: PvPBattleSnapshot): void;
  animatePvPMove(
    playerId: PvPPlayerId,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    facing: Direction
  ): void;
  animatePvPBlockedMove(
    playerId: PvPPlayerId,
    x: number,
    y: number,
    attemptedX: number,
    attemptedY: number,
    facing: Direction,
    reason: 'boundary' | 'wall' | 'robot'
  ): void;
  animatePvPLaser(
    attackerId: PvPPlayerId,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    facing: Direction,
    hitOpponent: boolean
  ): void;
  animatePvPShockwave(
    attackerId: PvPPlayerId,
    centerX: number,
    centerY: number,
    radiusCells: number,
    hitOpponent: boolean,
    oppX: number,
    oppY: number
  ): void;
  animatePvPPlayerDamaged(
    targetId: PvPPlayerId,
    damage: number,
    remainingHealth: number,
    defeated: boolean
  ): void;
  spawnBombVisual(bomb: BombState): void;
  updateBombCountdownVisual(bombId: string, countdown: number): void;
  animatePvPBombExplosion(
    bombId: string,
    x: number,
    y: number,
    blastRadius: number
  ): void;
}

export interface PvPBattleCallbacks {
  onSnapshotChange?: (snapshot: PvPBattleSnapshot) => void;
  onCombatEventsChange?: (events: CombatEventEntry[]) => void;
  onBattleFinished?: (snapshot: PvPBattleSnapshot) => void;
}

