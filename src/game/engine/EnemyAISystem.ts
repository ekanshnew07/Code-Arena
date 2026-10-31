import {
  CombatEventCategory,
  Direction,
  EnemyAIState,
  EnemyState,
  GridPosition,
} from '../../types/game';
import { getDifficultyConfig } from '../config/combatConfig';
import { GameState } from './GameState';

export interface EnemyAICallbacks {
  onEnemyMoved: (
    enemy: EnemyState,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number
  ) => void;
  onEnemyStateChanged: (enemy: EnemyState, prevState: EnemyAIState) => void;
  onChaserAttack: (
    enemy: EnemyState,
    targetX: number,
    targetY: number,
    damage: number
  ) => void;
  onBomberPlaceBomb: (
    enemy: EnemyState,
    bombX: number,
    bombY: number,
    countdownTicks: number,
    stepDurationMs: number,
    blastRadius: number,
    damage: number
  ) => void;
  onLaserShooterFire: (
    enemy: EnemyState,
    dir: Direction,
    endX: number,
    endY: number,
    hitPlayer: boolean,
    damage: number
  ) => void;
  onCombatEvent: (
    category: CombatEventCategory,
    message: string,
    dedupeKey?: string
  ) => void;
}

export class EnemyAISystem {
  private gameState: GameState;
  private callbacks: EnemyAICallbacks;
  private spottedAnnounced = false;

  constructor(gameState: GameState, callbacks: EnemyAICallbacks) {
    this.gameState = gameState;
    this.callbacks = callbacks;
  }

  public reset(): void {
    this.spottedAnnounced = false;
  }

  /**
   * Advances all living enemies independently using scaledDeltaMs.
   */
  public update(scaledDeltaMs: number): void {
    if (this.gameState.player.health <= 0) return;

    const livingEnemies = this.gameState.getLivingEnemies();
    if (livingEnemies.length === 0) return;

    if (!this.spottedAnnounced) {
      this.spottedAnnounced = true;
      this.callbacks.onCombatEvent(
        'spotted',
        `${livingEnemies.length} hostile units active in Sector 01 [Difficulty: ${this.gameState.difficulty}].`,
        'initial-spotted'
      );
    }

    const diffCfg = getDifficultyConfig(this.gameState.difficulty);

    for (const enemy of livingEnemies) {
      // Handle initial startup delay grace period
      if (
        enemy.initialDelayRemainingMs !== undefined &&
        enemy.initialDelayRemainingMs > 0
      ) {
        enemy.initialDelayRemainingMs = Math.max(
          0,
          enemy.initialDelayRemainingMs - scaledDeltaMs
        );
        // Face player during grace period without attacking
        this.faceToward(enemy, this.gameState.player.x, this.gameState.player.y);
        continue;
      }

      enemy.stateTimerMs += scaledDeltaMs;
      enemy.moveTimerMs += scaledDeltaMs;

      switch (enemy.archetype) {
        case 'CHASER':
          this.updateChaser(enemy, diffCfg.enemies.CHASER);
          break;
        case 'BOMBER':
          this.updateBomber(enemy, diffCfg.enemies.BOMBER);
          break;
        case 'LASER_SHOOTER':
          this.updateLaserShooter(enemy, diffCfg.enemies.LASER_SHOOTER);
          break;
      }
    }
  }

  // ============================================================================
  // A. CHASER STATE MACHINE: CHASE -> ATTACK -> COOLDOWN -> CHASE
  // ============================================================================
  private updateChaser(
    enemy: EnemyState,
    cfg: ReturnType<typeof getDifficultyConfig>['enemies']['CHASER']
  ): void {
    const px = this.gameState.player.x;
    const py = this.gameState.player.y;
    const manhattanDist = Math.abs(enemy.x - px) + Math.abs(enemy.y - py);

    switch (enemy.aiState) {
      case 'CHASE': {
        this.faceToward(enemy, px, py);

        if (manhattanDist <= 1) {
          this.transitionState(enemy, 'ATTACK');
          return;
        }

        if (enemy.moveTimerMs >= cfg.moveIntervalMs) {
          enemy.moveTimerMs = 0;
          const nextStep = this.findBestStepToward(enemy, px, py, true);
          if (nextStep) {
            this.moveEnemyTo(enemy, nextStep.x, nextStep.y);
            const newDist =
              Math.abs(enemy.x - px) + Math.abs(enemy.y - py);
            if (newDist <= 3) {
              this.callbacks.onCombatEvent(
                'approach',
                `${enemy.name} approaching at (${enemy.x}, ${enemy.y}).`,
                `approach-${enemy.id}`
              );
            }
            if (newDist <= 1) {
              this.transitionState(enemy, 'ATTACK');
              return;
            }
          }

          // After pursuing for 3 consecutive steps, take a short breather pause
          if (enemy.stateTimerMs >= cfg.moveIntervalMs * 3) {
            enemy.stateTimerMs = 0;
            enemy.moveTimerMs = -Math.round(cfg.moveIntervalMs * 0.65);
          }
        }
        break;
      }

      case 'ATTACK': {
        this.faceToward(enemy, px, py);
        // Short strike wind-up so player sees the lunge indicator
        if (enemy.stateTimerMs >= 300) {
          const curDist =
            Math.abs(enemy.x - this.gameState.player.x) +
            Math.abs(enemy.y - this.gameState.player.y);
          if (curDist <= 2) {
            this.callbacks.onChaserAttack(
              enemy,
              this.gameState.player.x,
              this.gameState.player.y,
              cfg.attackDamage
            );
          }
          this.transitionState(enemy, 'COOLDOWN');
        }
        break;
      }

      case 'COOLDOWN': {
        // Avoid staying directly crowded on top of player during cooldown
        if (enemy.moveTimerMs >= cfg.moveIntervalMs) {
          enemy.moveTimerMs = 0;
          const curDist = Math.abs(enemy.x - px) + Math.abs(enemy.y - py);
          if (curDist <= 1) {
            const stepAway = this.findStepAwayFrom(enemy, px, py);
            if (stepAway) {
              this.moveEnemyTo(enemy, stepAway.x, stepAway.y);
            }
          }
        }

        if (enemy.stateTimerMs >= cfg.attackCooldownMs) {
          this.transitionState(enemy, 'CHASE');
        }
        break;
      }
    }
  }

  // ============================================================================
  // B. BOMBER STATE MACHINE: TRACK -> PLACE_BOMB -> COOLDOWN -> TRACK
  // ============================================================================
  private updateBomber(
    enemy: EnemyState,
    cfg: ReturnType<typeof getDifficultyConfig>['enemies']['BOMBER']
  ): void {
    const px = this.gameState.player.x;
    const py = this.gameState.player.y;
    const chebyshevDist = Math.max(
      Math.abs(enemy.x - px),
      Math.abs(enemy.y - py)
    );

    switch (enemy.aiState) {
      case 'TRACK': {
        this.faceToward(enemy, px, py);

        if (chebyshevDist <= 4 && enemy.stateTimerMs >= 1200) {
          const predicted = this.predictPlayerBombTarget(enemy, cfg.predictionLeadCells ?? 1);
          enemy.lockedTarget = predicted;
          this.transitionState(enemy, 'PLACE_BOMB');
          return;
        }

        if (enemy.moveTimerMs >= cfg.moveIntervalMs) {
          enemy.moveTimerMs = 0;
          const step = this.findBestStepToward(enemy, px, py, true);
          if (step) {
            this.moveEnemyTo(enemy, step.x, step.y);
          }
        }
        break;
      }

      case 'PLACE_BOMB': {
        if (enemy.stateTimerMs >= 480) {
          const target = enemy.lockedTarget ?? { x: px, y: py };
          this.callbacks.onBomberPlaceBomb(
            enemy,
            target.x,
            target.y,
            cfg.bombCountdownTicks,
            cfg.bombStepDurationMs,
            cfg.bombBlastRadius,
            cfg.attackDamage
          );
          enemy.lockedTarget = undefined;
          this.transitionState(enemy, 'COOLDOWN');
        }
        break;
      }

      case 'COOLDOWN': {
        // Evade active bombs if standing inside a blast zone
        if (enemy.moveTimerMs >= cfg.moveIntervalMs) {
          enemy.moveTimerMs = 0;
          if (this.isInAnyBombDanger(enemy.x, enemy.y)) {
            const safeStep = this.findSafeStepFromBombs(enemy);
            if (safeStep) {
              this.moveEnemyTo(enemy, safeStep.x, safeStep.y);
            }
          } else if (chebyshevDist < 3) {
            // Keep tactical spacing from player while cooling down
            const retreatStep = this.findStepAwayFrom(enemy, px, py);
            if (retreatStep) {
              this.moveEnemyTo(enemy, retreatStep.x, retreatStep.y);
            }
          }
        }

        if (enemy.stateTimerMs >= cfg.attackCooldownMs) {
          this.transitionState(enemy, 'TRACK');
        }
        break;
      }
    }
  }

  // ============================================================================
  // C. LASER SHOOTER STATE MACHINE: SEARCH -> AIM -> CHARGE -> FIRE -> COOLDOWN
  // ============================================================================
  private updateLaserShooter(
    enemy: EnemyState,
    cfg: ReturnType<typeof getDifficultyConfig>['enemies']['LASER_SHOOTER']
  ): void {
    const px = this.gameState.player.x;
    const py = this.gameState.player.y;
    const aimDuration = cfg.aimDurationMs;
    const chargeDuration = cfg.chargeDurationMs;
    const preferredMin = cfg.preferredMinDist;

    switch (enemy.aiState) {
      case 'SEARCH': {
        this.faceToward(enemy, px, py);

        // Check if aligned on X or Y with clear line-of-sight
        const alignedAxis = this.getClearFiringDirection(enemy, px, py);
        const manhattanDist = Math.abs(enemy.x - px) + Math.abs(enemy.y - py);

        if (
          alignedAxis &&
          manhattanDist <= cfg.attackRange &&
          enemy.stateTimerMs >= 600
        ) {
          enemy.lockedDirection = alignedAxis;
          enemy.facing = alignedAxis;
          enemy.chargeProgress = 0;
          this.transitionState(enemy, 'AIM');
          return;
        }

        if (enemy.moveTimerMs >= cfg.moveIntervalMs) {
          enemy.moveTimerMs = 0;
          const step = this.findLaserShooterPositionStep(
            enemy,
            px,
            py,
            preferredMin
          );
          if (step) {
            this.moveEnemyTo(enemy, step.x, step.y);
          }
        }
        break;
      }

      case 'AIM': {
        if (enemy.lockedDirection) {
          enemy.facing = enemy.lockedDirection;
        }
        enemy.chargeProgress = Math.min(
          0.2,
          (enemy.stateTimerMs / aimDuration) * 0.2
        );

        if (enemy.stateTimerMs >= aimDuration) {
          this.callbacks.onCombatEvent(
            'laser',
            `⚠ ${enemy.name} locked on ${
              enemy.lockedDirection === 'east' || enemy.lockedDirection === 'west'
                ? `Row Y:${enemy.y}`
                : `Column X:${enemy.x}`
            } — CHARGING LASER! DODGE! ⚠`,
            `charge-${enemy.id}`
          );
          this.transitionState(enemy, 'CHARGE');
        }
        break;
      }

      case 'CHARGE': {
        enemy.chargeProgress = Math.min(
          1,
          enemy.stateTimerMs / chargeDuration
        );
        if (enemy.stateTimerMs >= chargeDuration) {
          enemy.chargeProgress = 1;
          this.transitionState(enemy, 'FIRE');
        }
        break;
      }

      case 'FIRE': {
        const dir = enemy.lockedDirection ?? enemy.facing;
        const beamResult = this.traceEnemyLaserBeam(enemy, dir);
        this.callbacks.onLaserShooterFire(
          enemy,
          dir,
          beamResult.endX,
          beamResult.endY,
          beamResult.hitPlayer,
          cfg.attackDamage
        );
        enemy.chargeProgress = 0;
        enemy.lockedDirection = undefined;
        this.transitionState(enemy, 'COOLDOWN');
        break;
      }

      case 'COOLDOWN': {
        enemy.chargeProgress = 0;
        if (enemy.moveTimerMs >= cfg.moveIntervalMs) {
          enemy.moveTimerMs = 0;
          const dist = Math.abs(enemy.x - px) + Math.abs(enemy.y - py);
          if (dist < preferredMin) {
            const stepAway = this.findStepAwayFrom(enemy, px, py);
            if (stepAway) {
              this.moveEnemyTo(enemy, stepAway.x, stepAway.y);
            }
          }
        }

        if (enemy.stateTimerMs >= cfg.attackCooldownMs) {
          this.transitionState(enemy, 'SEARCH');
        }
        break;
      }
    }
  }

  // ============================================================================
  // TACTICAL PATHFINDING & HELPER METHODS
  // ============================================================================
  private transitionState(enemy: EnemyState, nextState: EnemyAIState): void {
    const prev = enemy.aiState;
    if (prev === nextState) return;
    enemy.aiState = nextState;
    enemy.stateTimerMs = 0;
    this.callbacks.onEnemyStateChanged(enemy, prev);
  }

  private moveEnemyTo(enemy: EnemyState, toX: number, toY: number): void {
    const fromX = enemy.x;
    const fromY = enemy.y;
    if (fromX === toX && fromY === toY) return;

    if (toX > fromX) enemy.facing = 'east';
    else if (toX < fromX) enemy.facing = 'west';
    else if (toY > fromY) enemy.facing = 'south';
    else if (toY < fromY) enemy.facing = 'north';

    enemy.x = toX;
    enemy.y = toY;
    this.callbacks.onEnemyMoved(enemy, fromX, fromY, toX, toY);
  }

  private faceToward(enemy: EnemyState, targetX: number, targetY: number): void {
    const dx = targetX - enemy.x;
    const dy = targetY - enemy.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      enemy.facing = dx >= 0 ? 'east' : 'west';
    } else {
      enemy.facing = dy >= 0 ? 'south' : 'north';
    }
  }

  private getValidNeighbors(
    enemy: EnemyState,
    avoidPlayerTile = true
  ): GridPosition[] {
    const dirs = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    const valid: GridPosition[] = [];

    for (const d of dirs) {
      const nx = enemy.x + d.x;
      const ny = enemy.y + d.y;
      if (!this.gameState.isInsideArena(nx, ny)) continue;
      if (this.gameState.isWallAt(nx, ny)) continue;
      if (this.gameState.isEnemyAt(nx, ny, enemy.id)) continue;
      if (
        avoidPlayerTile &&
        nx === this.gameState.player.x &&
        ny === this.gameState.player.y
      ) {
        continue;
      }
      valid.push({ x: nx, y: ny });
    }
    return valid;
  }

  private findBestStepToward(
    enemy: EnemyState,
    targetX: number,
    targetY: number,
    avoidBombs = true
  ): GridPosition | null {
    const neighbors = this.getValidNeighbors(enemy, true);
    if (neighbors.length === 0) return null;

    let best: GridPosition | null = null;
    let bestScore = Infinity;

    for (const cand of neighbors) {
      const dist = Math.abs(cand.x - targetX) + Math.abs(cand.y - targetY);
      const bombPenalty =
        avoidBombs && this.isInAnyBombDanger(cand.x, cand.y) ? 20 : 0;
      const score = dist + bombPenalty;
      if (score < bestScore) {
        bestScore = score;
        best = cand;
      }
    }

    return best;
  }

  private findStepAwayFrom(
    enemy: EnemyState,
    fromX: number,
    fromY: number
  ): GridPosition | null {
    const neighbors = this.getValidNeighbors(enemy, true);
    if (neighbors.length === 0) return null;

    let best: GridPosition | null = null;
    let bestScore = -Infinity;

    for (const cand of neighbors) {
      if (this.isInAnyBombDanger(cand.x, cand.y)) continue;
      const dist = Math.abs(cand.x - fromX) + Math.abs(cand.y - fromY);
      if (dist > bestScore) {
        bestScore = dist;
        best = cand;
      }
    }
    return best;
  }

  private isInAnyBombDanger(x: number, y: number): boolean {
    return this.gameState.bombs.some(
      (b) =>
        Math.abs(b.x - x) <= b.blastRadius &&
        Math.abs(b.y - y) <= b.blastRadius
    );
  }

  private findSafeStepFromBombs(enemy: EnemyState): GridPosition | null {
    const neighbors = this.getValidNeighbors(enemy, true);
    for (const cand of neighbors) {
      if (!this.isInAnyBombDanger(cand.x, cand.y)) {
        return cand;
      }
    }
    return neighbors[0] ?? null;
  }

  private predictPlayerBombTarget(enemy: EnemyState, leadCells: number): GridPosition {
    const px = this.gameState.player.x;
    const py = this.gameState.player.y;
    const vx = Math.sign(px - this.gameState.player.prevX);
    const vy = Math.sign(py - this.gameState.player.prevY);

    const candidates: GridPosition[] = [
      { x: px + vx * leadCells, y: py + vy * leadCells },
      { x: px, y: py },
      {
        x: px + Math.sign(enemy.x - px),
        y: py + Math.sign(enemy.y - py),
      },
    ];

    for (const cand of candidates) {
      const cx = Math.max(0, Math.min(this.gameState.gridSize - 1, cand.x));
      const cy = Math.max(0, Math.min(this.gameState.gridSize - 1, cand.y));
      if (!this.gameState.isWallAt(cx, cy)) {
        return { x: cx, y: cy };
      }
    }

    return { x: px, y: py };
  }

  private getClearFiringDirection(
    enemy: EnemyState,
    px: number,
    py: number
  ): Direction | null {
    if (
      enemy.y === py &&
      this.gameState.hasClearLineOfSight(enemy.x, enemy.y, px, py)
    ) {
      return px >= enemy.x ? 'east' : 'west';
    }
    if (
      enemy.x === px &&
      this.gameState.hasClearLineOfSight(enemy.x, enemy.y, px, py)
    ) {
      return py >= enemy.y ? 'south' : 'north';
    }
    return null;
  }

  private findLaserShooterPositionStep(
    enemy: EnemyState,
    px: number,
    py: number,
    preferredMinDist: number
  ): GridPosition | null {
    const neighbors = this.getValidNeighbors(enemy, true);
    if (neighbors.length === 0) return null;

    let best: GridPosition | null = null;
    let bestCost = Infinity;

    for (const cand of neighbors) {
      const axisError = Math.min(
        Math.abs(cand.x - px),
        Math.abs(cand.y - py)
      );
      const dist = Math.abs(cand.x - px) + Math.abs(cand.y - py);
      const distPenalty =
        dist < preferredMinDist ? (preferredMinDist - dist) * 3 : dist * 0.25;
      const bombPenalty = this.isInAnyBombDanger(cand.x, cand.y) ? 25 : 0;
      const cost = axisError * 2 + distPenalty + bombPenalty;

      if (cost < bestCost) {
        bestCost = cost;
        best = cand;
      }
    }

    return best;
  }

  public traceEnemyLaserBeam(
    enemy: EnemyState,
    dir: Direction
  ): {
    endX: number;
    endY: number;
    hitPlayer: boolean;
  } {
    const dx = dir === 'east' ? 1 : dir === 'west' ? -1 : 0;
    const dy = dir === 'south' ? 1 : dir === 'north' ? -1 : 0;

    let endX = enemy.x;
    let endY = enemy.y;
    let hitPlayer = false;

    let cx = enemy.x + dx;
    let cy = enemy.y + dy;

    while (this.gameState.isInsideArena(cx, cy)) {
      if (this.gameState.isWallAt(cx, cy)) {
        endX = cx;
        endY = cy;
        break;
      }
      endX = cx;
      endY = cy;
      if (
        cx === this.gameState.player.x &&
        cy === this.gameState.player.y &&
        this.gameState.player.health > 0
      ) {
        hitPlayer = true;
        break;
      }
      cx += dx;
      cy += dy;
    }

    return { endX, endY, hitPlayer };
  }
}
