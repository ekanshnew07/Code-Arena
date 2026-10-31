import {
  BombState,
  DifficultyLevel,
  Direction,
  EnemyAIState,
  EnemyState,
  GameStateSnapshot,
  GridPosition,
  SimulationSpeed,
} from '../../types/game';
import { SupportedVariableName } from '../../interpreter/gameApi';
import { COMBAT_CONFIG, getDifficultyConfig } from '../config/combatConfig';

export const ARENA_GRID_SIZE = COMBAT_CONFIG.gridSize;

export class GameState {
  public readonly gridSize = COMBAT_CONFIG.gridSize;
  public simulationSpeed: SimulationSpeed = 1;
  public difficulty: DifficultyLevel = COMBAT_CONFIG.defaultDifficulty;
  public simulationActive = false;

  public player = {
    x: COMBAT_CONFIG.player.initialPosition.x,
    y: COMBAT_CONFIG.player.initialPosition.y,
    prevX: COMBAT_CONFIG.player.initialPosition.x,
    prevY: COMBAT_CONFIG.player.initialPosition.y,
    health: COMBAT_CONFIG.player.maxHealth,
    maxHealth: COMBAT_CONFIG.player.maxHealth,
    facing: 'east' as Direction,
    invulnerableRemainingMs: 0,
    shockwaveCooldownRemainingMs: 0,
  };

  public enemies: EnemyState[] = [];
  public walls: GridPosition[] = [];
  public bombs: BombState[] = [];

  constructor() {
    this.reset();
  }

  public reset(): void {
    const diffCfg = getDifficultyConfig(this.difficulty);
    this.simulationActive = false;

    this.player = {
      x: COMBAT_CONFIG.player.initialPosition.x,
      y: COMBAT_CONFIG.player.initialPosition.y,
      prevX: COMBAT_CONFIG.player.initialPosition.x,
      prevY: COMBAT_CONFIG.player.initialPosition.y,
      health: COMBAT_CONFIG.player.maxHealth,
      maxHealth: COMBAT_CONFIG.player.maxHealth,
      facing: 'east',
      invulnerableRemainingMs: 0,
      shockwaveCooldownRemainingMs: 0,
    };

    this.enemies = COMBAT_CONFIG.initialSpawns.map((spawn) => {
      const eDiff = diffCfg.enemies[spawn.archetype];
      const initialState: EnemyAIState =
        spawn.archetype === 'CHASER'
          ? 'CHASE'
          : spawn.archetype === 'BOMBER'
          ? 'TRACK'
          : 'SEARCH';

      return {
        id: spawn.id,
        name: spawn.name,
        archetype: spawn.archetype,
        aiState: initialState,
        x: spawn.x,
        y: spawn.y,
        facing: 'west',
        health: spawn.maxHealth,
        maxHealth: spawn.maxHealth,
        alive: true,
        stateTimerMs: 0,
        moveTimerMs: 0,
        initialDelayRemainingMs: eDiff.initialDelayMs,
        chargeProgress: 0,
      };
    });

    this.walls = COMBAT_CONFIG.initialWalls.map((w) => ({ ...w }));
    this.bombs = [];
  }

  public setDifficulty(level: DifficultyLevel): void {
    this.difficulty = level;
    const diffCfg = getDifficultyConfig(level);
    for (const enemy of this.enemies) {
      if (enemy.initialDelayRemainingMs !== undefined && enemy.initialDelayRemainingMs > 0) {
        enemy.initialDelayRemainingMs = diffCfg.enemies[enemy.archetype].initialDelayMs;
      }
    }
  }

  public getSnapshot(): GameStateSnapshot {
    return {
      gridSize: this.gridSize,
      simulationSpeed: this.simulationSpeed,
      difficulty: this.difficulty,
      simulationActive: this.simulationActive,
      player: { ...this.player },
      enemies: this.enemies.map((e) => ({
        ...e,
        lockedTarget: e.lockedTarget ? { ...e.lockedTarget } : undefined,
      })),
      walls: this.walls.map((w) => ({ ...w })),
      bombs: this.bombs.map((b) => ({ ...b })),
    };
  }

  public isInsideArena(x: number, y: number): boolean {
    return x >= 0 && x < this.gridSize && y >= 0 && y < this.gridSize;
  }

  public isWallAt(x: number, y: number): boolean {
    return this.walls.some((w) => w.x === x && w.y === y);
  }

  public isEnemyAt(x: number, y: number, excludeEnemyId?: string): boolean {
    return this.enemies.some(
      (e) =>
        e.alive &&
        e.health > 0 &&
        e.id !== excludeEnemyId &&
        e.x === x &&
        e.y === y
    );
  }

  public getLivingEnemies(): EnemyState[] {
    return this.enemies.filter((e) => e.alive && e.health > 0);
  }

  public getNearestEnemy(): EnemyState | null {
    const living = this.getLivingEnemies();
    if (living.length === 0) return null;

    let nearest = living[0];
    let bestDist =
      Math.abs(nearest.x - this.player.x) + Math.abs(nearest.y - this.player.y);

    for (let i = 1; i < living.length; i++) {
      const candidate = living[i];
      const dist =
        Math.abs(candidate.x - this.player.x) +
        Math.abs(candidate.y - this.player.y);
      if (dist < bestDist) {
        bestDist = dist;
        nearest = candidate;
      }
    }

    return nearest;
  }

  public getVariable(name: SupportedVariableName): number {
    switch (name) {
      case 'x':
        return this.player.x;
      case 'y':
        return this.player.y;
      case 'health':
        return this.player.health;
      case 'enemy_count':
        return this.getLivingEnemies().length;
      case 'enemy_x': {
        const nearest = this.getNearestEnemy();
        return nearest ? nearest.x : -1;
      }
      case 'enemy_y': {
        const nearest = this.getNearestEnemy();
        return nearest ? nearest.y : -1;
      }
    }
  }

  public applyDamageToEnemy(
    enemyId: string,
    damage: number
  ): {
    hit: boolean;
    destroyed: boolean;
    remainingHealth: number;
  } {
    const enemy = this.enemies.find((e) => e.id === enemyId && e.alive);
    if (!enemy) {
      return { hit: false, destroyed: false, remainingHealth: 0 };
    }

    enemy.health = Math.max(0, enemy.health - damage);
    if (enemy.health === 0) {
      enemy.alive = false;
      enemy.aiState = 'DEFEATED';
      enemy.chargeProgress = 0;
    }

    return {
      hit: true,
      destroyed: !enemy.alive,
      remainingHealth: enemy.health,
    };
  }

  public applyDamageToPlayer(
    damage: number,
    sourceX?: number,
    sourceY?: number
  ): {
    damaged: boolean;
    invulnerableBlocked: boolean;
    remainingHealth: number;
    defeated: boolean;
    knockbackTo?: GridPosition;
  } {
    if (this.player.health <= 0) {
      return {
        damaged: false,
        invulnerableBlocked: false,
        remainingHealth: 0,
        defeated: true,
      };
    }

    if (this.player.invulnerableRemainingMs > 0) {
      return {
        damaged: false,
        invulnerableBlocked: true,
        remainingHealth: this.player.health,
        defeated: false,
      };
    }

    const diffCfg = getDifficultyConfig(this.difficulty);
    this.player.health = Math.max(0, this.player.health - damage);
    this.player.invulnerableRemainingMs =
      diffCfg.playerInvulnerabilityDurationMs;

    let knockbackTo: GridPosition | undefined;
    if (
      this.player.health > 0 &&
      sourceX !== undefined &&
      sourceY !== undefined
    ) {
      const dx = Math.sign(this.player.x - sourceX);
      const dy = Math.sign(this.player.y - sourceY);
      const candidates: GridPosition[] = [];
      if (dx !== 0) candidates.push({ x: this.player.x + dx, y: this.player.y });
      if (dy !== 0) candidates.push({ x: this.player.x, y: this.player.y + dy });

      for (const cand of candidates) {
        if (
          this.isInsideArena(cand.x, cand.y) &&
          !this.isWallAt(cand.x, cand.y) &&
          !this.isEnemyAt(cand.x, cand.y)
        ) {
          this.player.prevX = this.player.x;
          this.player.prevY = this.player.y;
          this.player.x = cand.x;
          this.player.y = cand.y;
          knockbackTo = cand;
          break;
        }
      }
    }

    return {
      damaged: true,
      invulnerableBlocked: false,
      remainingHealth: this.player.health,
      defeated: this.player.health === 0,
      knockbackTo,
    };
  }

  public hasClearLineOfSight(
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): boolean {
    if (x1 === x2) {
      const step = y2 > y1 ? 1 : -1;
      for (let cy = y1 + step; cy !== y2; cy += step) {
        if (this.isWallAt(x1, cy)) return false;
      }
      return true;
    }
    if (y1 === y2) {
      const step = x2 > x1 ? 1 : -1;
      for (let cx = x1 + step; cx !== x2; cx += step) {
        if (this.isWallAt(cx, y1)) return false;
      }
      return true;
    }
    return false;
  }
}
