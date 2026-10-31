import { DifficultyLevel, EnemyArchetype, GridPosition } from '../../types/game';

export interface PlayerCombatConfig {
  maxHealth: number;
  initialPosition: GridPosition;
  laserDamage: number;
  laserRange: number;
  shockwaveDamage: number;
  shockwaveRadius: number;
  shockwaveCooldownMs: number;
  bombDamage: number;
  bombBlastRadius: number;
  bombCountdownTicks: number;
  bombStepDurationMs: number;
}

export interface ChaserDifficultySettings {
  moveIntervalMs: number;
  attackDamage: number;
  attackCooldownMs: number;
  initialDelayMs: number;
}

export interface BomberDifficultySettings {
  moveIntervalMs: number;
  attackDamage: number;
  attackCooldownMs: number;
  bombCountdownTicks: number;
  bombStepDurationMs: number;
  bombBlastRadius: number;
  initialDelayMs: number;
  predictionLeadCells?: number;
}

export interface LaserShooterDifficultySettings {
  moveIntervalMs: number;
  attackDamage: number;
  aimDurationMs: number;
  chargeDurationMs: number;
  attackCooldownMs: number;
  initialDelayMs: number;
  preferredMinDist: number;
  preferredMaxDist: number;
  attackRange: number;
}

export interface DifficultyConfig {
  name: DifficultyLevel;
  playerInvulnerabilityDurationMs: number;
  enemies: {
    CHASER: ChaserDifficultySettings;
    BOMBER: BomberDifficultySettings;
    LASER_SHOOTER: LaserShooterDifficultySettings;
  };
}

export interface InitialEnemySpawn {
  id: string;
  name: string;
  archetype: EnemyArchetype;
  x: number;
  y: number;
  maxHealth: number;
}

export const DIFFICULTY_PRESETS: Record<DifficultyLevel, DifficultyConfig> = {
  Easy: {
    name: 'Easy',
    playerInvulnerabilityDurationMs: 1500, // 1.5s invulnerability window
    enemies: {
      CHASER: {
        moveIntervalMs: 2250, // 2.25s between movement steps (target: 2–2.5s)
        attackDamage: 4,      // 4 HP contact damage (target: 3–5 HP)
        attackCooldownMs: 4200, // Generous pause after attacking
        initialDelayMs: 2500, // Initial pause after RUN before chasing
      },
      BOMBER: {
        moveIntervalMs: 2800,
        attackDamage: 12,     // 12 HP explosion damage (target: 10–15 HP)
        attackCooldownMs: 11000, // 11s interval between bombs (target: 10–12s)
        bombCountdownTicks: 5,
        bombStepDurationMs: 1000, // 5.0s total countdown (target: 5s)
        bombBlastRadius: 1,
        initialDelayMs: 3500,
        predictionLeadCells: 1,
      },
      LASER_SHOOTER: {
        moveIntervalMs: 2800,
        attackDamage: 8,      // 8 HP laser damage (target: 5–10 HP)
        aimDurationMs: 800,
        chargeDurationMs: 4000, // 4.0s charging time (target: 4s)
        attackCooldownMs: 8000, // 8.0s cooldown between shots (target: 7–9s)
        initialDelayMs: 2800,
        preferredMinDist: 4,
        preferredMaxDist: 11,
        attackRange: 12,
      },
    },
  },
  Normal: {
    name: 'Normal',
    playerInvulnerabilityDurationMs: 1300,
    enemies: {
      CHASER: {
        moveIntervalMs: 1500,
        attackDamage: 8,
        attackCooldownMs: 2400,
        initialDelayMs: 1500,
      },
      BOMBER: {
        moveIntervalMs: 2000,
        attackDamage: 18,
        attackCooldownMs: 7500,
        bombCountdownTicks: 4,
        bombStepDurationMs: 950,
        bombBlastRadius: 1,
        initialDelayMs: 2000,
        predictionLeadCells: 1,
      },
      LASER_SHOOTER: {
        moveIntervalMs: 2000,
        attackDamage: 14,
        aimDurationMs: 650,
        chargeDurationMs: 2600,
        attackCooldownMs: 5500,
        initialDelayMs: 1800,
        preferredMinDist: 4,
        preferredMaxDist: 11,
        attackRange: 12,
      },
    },
  },
  Hard: {
    name: 'Hard',
    playerInvulnerabilityDurationMs: 1000,
    enemies: {
      CHASER: {
        moveIntervalMs: 1100,
        attackDamage: 12,
        attackCooldownMs: 1500,
        initialDelayMs: 1000,
      },
      BOMBER: {
        moveIntervalMs: 1500,
        attackDamage: 24,
        attackCooldownMs: 5000,
        bombCountdownTicks: 3,
        bombStepDurationMs: 900,
        bombBlastRadius: 1,
        initialDelayMs: 1200,
        predictionLeadCells: 1,
      },
      LASER_SHOOTER: {
        moveIntervalMs: 1600,
        attackDamage: 20,
        aimDurationMs: 500,
        chargeDurationMs: 1800,
        attackCooldownMs: 4000,
        initialDelayMs: 1000,
        preferredMinDist: 4,
        preferredMaxDist: 11,
        attackRange: 12,
      },
    },
  },
};

export const COMBAT_CONFIG = {
  gridSize: 15,
  defaultDifficulty: 'Easy' as DifficultyLevel,
  enemies: DIFFICULTY_PRESETS.Easy.enemies,
  initialWalls: [
    { x: 5, y: 3 },
    { x: 5, y: 11 },
    { x: 8, y: 4 },
    { x: 8, y: 10 },
  ],
  player: {
    maxHealth: 100,
    initialPosition: { x: 2, y: 7 },
    laserDamage: 35,
    laserRange: 14,
    shockwaveDamage: 25,
    shockwaveRadius: 2,
    shockwaveCooldownMs: 5000,
    bombDamage: 55,
    bombBlastRadius: 1, // 3x3 area
    bombCountdownTicks: 3,
    bombStepDurationMs: 700,
  },
  initialSpawns: [
    {
      id: 'ENEMY-01',
      name: 'LASER-01',
      archetype: 'LASER_SHOOTER' as EnemyArchetype,
      x: 11,
      y: 7,
      maxHealth: 60,
    },
    {
      id: 'ENEMY-02',
      name: 'BOMBER-02',
      archetype: 'BOMBER' as EnemyArchetype,
      x: 11,
      y: 3,
      maxHealth: 60,
    },
    {
      id: 'ENEMY-03',
      name: 'CHASER-03',
      archetype: 'CHASER' as EnemyArchetype,
      x: 11,
      y: 11,
      maxHealth: 45,
    },
  ],
};

export function getDifficultyConfig(difficulty: DifficultyLevel): DifficultyConfig {
  return DIFFICULTY_PRESETS[difficulty] ?? DIFFICULTY_PRESETS.Easy;
}
