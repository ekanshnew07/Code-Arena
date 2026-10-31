import {
  CommandExecutionResult,
  IGameAPI,
  SupportedCommandName,
  SupportedVariableName,
} from '../../interpreter/gameApi';
import { CodeInterpreter } from '../../interpreter/interpreter';
import { compileAndValidate } from '../../interpreter/validator';
import {
  BombState,
  CombatEventCategory,
  CombatEventEntry,
  DifficultyLevel,
  Direction,
  EnemyState,
  ExecutionLogEntry,
  GameStateSnapshot,
  GameStatus,
  GridPosition,
  SimulationSpeed,
  ValidationError,
} from '../../types/game';
import { COMBAT_CONFIG, getDifficultyConfig } from '../config/combatConfig';
import { EnemyAISystem } from './EnemyAISystem';
import { GameState } from './GameState';

export interface IArenaView {
  syncState(snapshot: GameStateSnapshot): void;
  setSimulationSpeed(speed: SimulationSpeed): void;
  animatePlayerMove(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    facing: Direction
  ): Promise<void>;
  animateBlockedMove(
    x: number,
    y: number,
    attemptedX: number,
    attemptedY: number,
    facing: Direction,
    reason: 'boundary' | 'wall'
  ): Promise<void>;
  animatePlayerDamaged(
    damage: number,
    remainingHealth: number,
    knockbackTo?: GridPosition,
    defeated?: boolean
  ): void;
  animateEnemyMove(
    enemyId: string,
    toX: number,
    toY: number,
    facing: Direction
  ): void;
  animateChaserAttack(
    enemyId: string,
    targetX: number,
    targetY: number
  ): void;
  animateEnemyLaser(
    enemyId: string,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    hitPlayer: boolean
  ): void;
  animateLaser(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    facing: Direction,
    hitEnemyId?: string,
    damage?: number,
    destroyed?: boolean
  ): Promise<void>;
  animateShockwave(
    centerX: number,
    centerY: number,
    radiusCells: number,
    hitResults: Array<{
      enemyId: string;
      damage: number;
      destroyed: boolean;
      remainingHealth: number;
    }>
  ): Promise<void>;
  spawnBombVisual(bomb: BombState): void;
  updateBombCountdownVisual(bombId: string, countdown: number): void;
  animateBombExplosion(
    bombId: string,
    x: number,
    y: number,
    blastRadius: number,
    hitResults: Array<{
      enemyId: string;
      damage: number;
      destroyed: boolean;
      remainingHealth: number;
    }>
  ): void;
  updateRealtimeVisuals(snapshot: GameStateSnapshot): void;
  resetArena(snapshot: GameStateSnapshot): void;
}

export interface ControllerStoreCallbacks {
  onStateChange?: (snapshot: GameStateSnapshot) => void;
  onStatusChange?: (status: GameStatus) => void;
  onInstructionChange?: (line: number | null, text: string | null) => void;
  onLogsChange?: (logs: ExecutionLogEntry[]) => void;
  onCombatEventsChange?: (events: CombatEventEntry[]) => void;
  onValidationError?: (error: ValidationError | null) => void;
}

const BASE_INTERPRETER_TICK_MS = 420;

export class GameController implements IGameAPI {
  public readonly gameState: GameState;
  private interpreter: CodeInterpreter;
  private enemyAI: EnemyAISystem;
  private view: IArenaView | null = null;
  private callbacks: ControllerStoreCallbacks;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;

  private logs: ExecutionLogEntry[] = [];
  private logSequence = 0;

  private combatEvents: CombatEventEntry[] = [];
  private combatEventSeq = 0;
  private lastDedupeMap: Map<string, number> = new Map();

  private bombSequence = 0;
  private isStepping = false;
  private lastFrameTimestamp = -1;
  private uiSyncAccumulatorMs = 0;
  private status: GameStatus = 'READY';

  constructor(callbacks: ControllerStoreCallbacks = {}) {
    this.callbacks = callbacks;
    this.gameState = new GameState();

    this.interpreter = new CodeInterpreter(this, {
      onInstructionChange: (line, text) => {
        this.callbacks.onInstructionChange?.(line, text);
      },
      onLog: (message, type, line) => {
        this.addLog(message, type, line);
      },
      onStatusChange: (nextStatus) => {
        if (this.status !== 'GAME_OVER' && this.status !== 'VICTORY') {
          this.setStatus(nextStatus);
        }
      },
    });

    this.enemyAI = new EnemyAISystem(this.gameState, {
      onEnemyMoved: (enemy, _fromX, _fromY, toX, toY) => {
        this.view?.animateEnemyMove(enemy.id, toX, toY, enemy.facing);
        this.emitStateSnapshot();
      },
      onEnemyStateChanged: (_enemy) => {
        this.emitStateSnapshot();
      },
      onChaserAttack: (enemy, targetX, targetY, damage) => {
        this.view?.animateChaserAttack(enemy.id, targetX, targetY);
        this.applyCombatDamageToPlayer(
          damage,
          enemy.x,
          enemy.y,
          `${enemy.name} struck UNIT-01 for ${damage} contact damage!`
        );
      },
      onBomberPlaceBomb: (
        enemy,
        bombX,
        bombY,
        countdownTicks,
        stepDurationMs,
        blastRadius,
        damage
      ) => {
        const diffCfg = getDifficultyConfig(this.gameState.difficulty);
        const resolvedTicks =
          countdownTicks ?? diffCfg.enemies.BOMBER.bombCountdownTicks;
        const resolvedDuration =
          stepDurationMs ?? diffCfg.enemies.BOMBER.bombStepDurationMs;
        const resolvedRadius =
          blastRadius ?? diffCfg.enemies.BOMBER.bombBlastRadius;
        const resolvedDamage = damage ?? diffCfg.enemies.BOMBER.attackDamage;
        this.deployBombInstance(
          enemy.id,
          bombX,
          bombY,
          resolvedTicks,
          resolvedDuration,
          resolvedRadius,
          resolvedDamage
        );
        this.addCombatEvent(
          'bomb',
          `${enemy.name} placed a timed bomb at (${bombX}, ${bombY})! Blast timer: ${(resolvedTicks * (resolvedDuration / 1000)).toFixed(1)}s`
        );
      },
      onLaserShooterFire: (enemy, _dir, endX, endY, hitPlayer, damage) => {
        this.view?.animateEnemyLaser(
          enemy.id,
          enemy.x,
          enemy.y,
          endX,
          endY,
          hitPlayer
        );
        if (hitPlayer) {
          this.applyCombatDamageToPlayer(
            damage,
            enemy.x,
            enemy.y,
            `${enemy.name} hit UNIT-01 with precision laser (-${damage} HP)!`
          );
        } else {
          this.addCombatEvent(
            'laser',
            `${enemy.name} fired laser to (${endX}, ${endY}) — evaded!`,
            `evade-${enemy.id}`
          );
        }
      },
      onCombatEvent: (category, message, dedupeKey) => {
        this.addCombatEvent(category, message, dedupeKey);
      },
    });
  }

  private setStatus(nextStatus: GameStatus): void {
    this.status = nextStatus;
    this.callbacks.onStatusChange?.(nextStatus);
  }

  public attachView(view: IArenaView | null): void {
    this.view = view;
    if (view) {
      view.setSimulationSpeed(this.gameState.simulationSpeed);
      view.syncState(this.gameState.getSnapshot());
    }
  }

  public setSimulationSpeed(speed: SimulationSpeed): void {
    this.gameState.simulationSpeed = speed;
    this.view?.setSimulationSpeed(speed);
    this.emitStateSnapshot();
    this.addCombatEvent(
      'system',
      `Simulation speed set to ${speed}x.`,
      `speed-${speed}`
    );
  }

  public getVariable(name: SupportedVariableName): number {
    return this.gameState.getVariable(name);
  }

  public startSimulation(): void {
    if (!this.gameState.simulationActive) {
      this.gameState.simulationActive = true;
      this.emitStateSnapshot();
    }
  }

  /**
   * Called each frame from Phaser's update loop.
   * Advances independent Enemy AI, bomb countdowns, and invulnerability timers
   * ONLY after the simulation has been started via RUN.
   */
  public updateSimulation(frameTimeMs: number, rawDeltaMs: number): void {
    // Prevent accidental multiple updates in the same frame
    if (frameTimeMs === this.lastFrameTimestamp) return;
    this.lastFrameTimestamp = frameTimeMs;

    // Do not run enemy AI, bombs, or timers until the player presses RUN
    if (!this.gameState.simulationActive) {
      return;
    }

    if (this.status === 'GAME_OVER' || this.status === 'VICTORY') {
      return;
    }

    const clampedDelta = Math.min(100, Math.max(0, rawDeltaMs));
    const scaledDelta = clampedDelta * this.gameState.simulationSpeed;

    // 1. Update player invulnerability & shockwave cooldown timers
    if (this.gameState.player.invulnerableRemainingMs > 0) {
      this.gameState.player.invulnerableRemainingMs = Math.max(
        0,
        this.gameState.player.invulnerableRemainingMs - scaledDelta
      );
    }

    if (this.gameState.player.shockwaveCooldownRemainingMs > 0) {
      this.gameState.player.shockwaveCooldownRemainingMs = Math.max(
        0,
        this.gameState.player.shockwaveCooldownRemainingMs - scaledDelta
      );
    }

    // 2. Update active bomb timers
    this.updateBombs(scaledDelta);

    // 3. Update independent Enemy AI state machines
    this.enemyAI.update(scaledDelta);

    // 4. Update real-time Phaser visual overlays (charge bars, warning beams, invulnerability flicker)
    const snapshot = this.gameState.getSnapshot();
    this.view?.updateRealtimeVisuals(snapshot);

    // Periodically sync React telemetry for smooth charge/timer bars
    this.uiSyncAccumulatorMs += clampedDelta;
    if (this.uiSyncAccumulatorMs >= 180) {
      this.uiSyncAccumulatorMs = 0;
      this.callbacks.onStateChange?.(snapshot);
    }
  }

  private updateBombs(scaledDeltaMs: number): void {
    if (this.gameState.bombs.length === 0) return;

    const toDetonate: BombState[] = [];

    for (const bomb of this.gameState.bombs) {
      bomb.elapsedMs += scaledDeltaMs;
      if (bomb.elapsedMs >= bomb.stepDurationMs) {
        bomb.elapsedMs -= bomb.stepDurationMs;
        bomb.countdown -= 1;

        if (bomb.countdown > 0) {
          this.view?.updateBombCountdownVisual(bomb.id, bomb.countdown);
        } else {
          toDetonate.push(bomb);
        }
      }
    }

    for (const bomb of toDetonate) {
      this.detonateBomb(bomb);
    }
  }

  public runCode(sourceCode: string): boolean {
    if (this.status === 'GAME_OVER' || this.status === 'VICTORY') {
      this.reset();
    }

    this.clearTickTimer();

    // Validate before execution
    const validation = compileAndValidate(sourceCode);
    if (!validation.valid || !validation.ast) {
      const err = validation.error ?? {
        line: 1,
        message: 'Syntax error on line 1',
      };
      this.callbacks.onValidationError?.(err);
      this.setStatus('ERROR');
      this.callbacks.onInstructionChange?.(
        err.line,
        `Error on line ${err.line}`
      );
      this.addLog(`Line ${err.line}: ${err.message}`, 'error', err.line);
      return false;
    }

    const wasActive = this.gameState.simulationActive;
    this.gameState.simulationActive = true;

    this.callbacks.onValidationError?.(null);
    this.setStatus('RUNNING');
    this.addLog('Program started.', 'info');
    if (!wasActive) {
      this.addCombatEvent('system', 'Battle simulation started.');
    }
    this.emitStateSnapshot();

    this.interpreter.start(validation.ast);
    this.scheduleNextTick(60);
    return true;
  }

  /**
   * Stops ONLY player code execution. Independent enemy AI continues running.
   */
  public stop(): void {
    this.clearTickTimer();
    this.interpreter.stop(false);
  }

  /**
   * Stops execution and restores the entire battlefield to its initial state.
   */
  public reset(): void {
    this.clearTickTimer();
    this.interpreter.stop(true);
    const currentSpeed = this.gameState.simulationSpeed;
    this.gameState.reset();
    this.gameState.simulationSpeed = currentSpeed;
    this.enemyAI.reset();

    this.logSequence = 0;
    this.logs = [];
    this.combatEventSeq = 0;
    this.combatEvents = [];
    this.lastDedupeMap.clear();

    this.callbacks.onLogsChange?.([]);
    this.callbacks.onCombatEventsChange?.([]);
    this.callbacks.onValidationError?.(null);
    this.callbacks.onInstructionChange?.(null, null);
    this.setStatus('READY');

    const snapshot = this.gameState.getSnapshot();
    this.callbacks.onStateChange?.(snapshot);
    this.view?.resetArena(snapshot);
    this.addLog('Arena reset to initial coordinates.', 'info');
    this.addCombatEvent('system', 'Sector 01 combat simulation reset.');
  }

  public setDifficulty(level: DifficultyLevel): void {
    this.gameState.setDifficulty(level);
    this.addCombatEvent(
      'system',
      `Combat difficulty adjusted to ${level.toUpperCase()}.`
    );
    this.addLog(`Difficulty level set to ${level}.`, 'info');
    this.emitStateSnapshot();
  }

  public clearLogs(): void {
    this.logSequence = 0;
    this.logs = [];
    this.callbacks.onLogsChange?.([]);
  }

  public clearCombatEvents(): void {
    this.combatEventSeq = 0;
    this.combatEvents = [];
    this.lastDedupeMap.clear();
    this.callbacks.onCombatEventsChange?.([]);
  }

  private getScaledInterpreterTickMs(): number {
    return Math.round(BASE_INTERPRETER_TICK_MS / this.gameState.simulationSpeed);
  }

  private isGameOver(): boolean {
    return this.status === 'GAME_OVER' || this.status === 'VICTORY';
  }

  private scheduleNextTick(delayMs?: number): void {
    this.clearTickTimer();
    if (!this.interpreter.isRunning() || this.isGameOver()) return;

    const waitMs = delayMs ?? this.getScaledInterpreterTickMs();
    this.tickTimer = setTimeout(async () => {
      if (
        !this.interpreter.isRunning() ||
        this.isStepping ||
        this.isGameOver()
      ) {
        return;
      }
      this.isStepping = true;
      try {
        const keepGoing = await this.interpreter.stepTick();
        if (
          keepGoing &&
          this.interpreter.isRunning() &&
          !this.isGameOver()
        ) {
          this.scheduleNextTick(this.getScaledInterpreterTickMs());
        }
      } finally {
        this.isStepping = false;
      }
    }, waitMs);
  }

  private clearTickTimer(): void {
    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  public async executeCommand(
    name: SupportedCommandName,
    args: number[],
    _line: number
  ): Promise<CommandExecutionResult> {
    switch (name) {
      case 'move_right':
        return this.handleMove(1, 0, 'east', 'move_right()');
      case 'move_left':
        return this.handleMove(-1, 0, 'west', 'move_left()');
      case 'move_up':
        return this.handleMove(0, -1, 'north', 'move_up()');
      case 'move_down':
        return this.handleMove(0, 1, 'south', 'move_down()');
      case 'bomb': {
        const rawX = Math.round(args[0] ?? this.gameState.player.x);
        const rawY = Math.round(args[1] ?? this.gameState.player.y);
        return this.handlePlayerBomb(rawX, rawY);
      }
      case 'laser':
        return this.handlePlayerLaser();
      case 'shockwave':
        return this.handlePlayerShockwave();
      case 'wait': {
        const ticks = Math.max(1, Math.min(20, Math.round(args[0] ?? 1)));
        return {
          success: true,
          formattedCall: `wait(${ticks})`,
          message: `wait(${ticks}) executed.`,
          waitTicks: ticks,
        };
      }
    }
  }

  private async handleMove(
    dx: number,
    dy: number,
    facing: Direction,
    callLabel: string
  ): Promise<CommandExecutionResult> {
    const fromX = this.gameState.player.x;
    const fromY = this.gameState.player.y;
    const targetX = fromX + dx;
    const targetY = fromY + dy;

    this.gameState.player.facing = facing;

    if (!this.gameState.isInsideArena(targetX, targetY)) {
      this.emitStateSnapshot();
      if (this.view) {
        await this.view.animateBlockedMove(
          fromX,
          fromY,
          targetX,
          targetY,
          facing,
          'boundary'
        );
      }
      return {
        success: false,
        formattedCall: callLabel,
        message: `${callLabel} blocked by arena boundary at (${fromX}, ${fromY}).`,
      };
    }

    if (this.gameState.isWallAt(targetX, targetY)) {
      this.emitStateSnapshot();
      if (this.view) {
        await this.view.animateBlockedMove(
          fromX,
          fromY,
          targetX,
          targetY,
          facing,
          'wall'
        );
      }
      return {
        success: false,
        formattedCall: callLabel,
        message: `${callLabel} blocked by barrier at (${targetX}, ${targetY}).`,
      };
    }

    this.gameState.player.prevX = fromX;
    this.gameState.player.prevY = fromY;
    this.gameState.player.x = targetX;
    this.gameState.player.y = targetY;
    this.emitStateSnapshot();

    if (this.view) {
      await this.view.animatePlayerMove(fromX, fromY, targetX, targetY, facing);
    }

    return {
      success: true,
      formattedCall: callLabel,
      message: `${callLabel} executed -> (${targetX}, ${targetY}).`,
    };
  }

  private deployBombInstance(
    owner: 'player' | string,
    rawX: number,
    rawY: number,
    countdown: number,
    stepDurationMs: number,
    blastRadius: number,
    damage: number
  ): BombState {
    const targetX = Math.max(
      0,
      Math.min(this.gameState.gridSize - 1, rawX)
    );
    const targetY = Math.max(
      0,
      Math.min(this.gameState.gridSize - 1, rawY)
    );

    const bomb: BombState = {
      id: `bomb-${++this.bombSequence}`,
      owner,
      x: targetX,
      y: targetY,
      countdown,
      elapsedMs: 0,
      stepDurationMs,
      blastRadius,
      damage,
    };

    this.gameState.bombs.push(bomb);
    this.view?.spawnBombVisual(bomb);
    this.emitStateSnapshot();
    return bomb;
  }

  private async handlePlayerBomb(
    rawX: number,
    rawY: number
  ): Promise<CommandExecutionResult> {
    const pCfg = COMBAT_CONFIG.player;
    const bomb = this.deployBombInstance(
      'player',
      rawX,
      rawY,
      pCfg.bombCountdownTicks,
      pCfg.bombStepDurationMs,
      pCfg.bombBlastRadius,
      pCfg.bombDamage
    );

    this.addCombatEvent(
      'bomb',
      `UNIT-01 deployed plasma bomb at (${bomb.x}, ${bomb.y}).`
    );

    return {
      success: true,
      formattedCall: `bomb(${bomb.x}, ${bomb.y})`,
      message: `bomb(${bomb.x}, ${bomb.y}) executed.`,
    };
  }

  private detonateBomb(bomb: BombState): void {
    const idx = this.gameState.bombs.findIndex((b) => b.id === bomb.id);
    if (idx === -1) return;
    this.gameState.bombs.splice(idx, 1);

    const hitResults: Array<{
      enemyId: string;
      damage: number;
      destroyed: boolean;
      remainingHealth: number;
    }> = [];

    for (const enemy of this.gameState.getLivingEnemies()) {
      const distX = Math.abs(enemy.x - bomb.x);
      const distY = Math.abs(enemy.y - bomb.y);
      if (distX <= bomb.blastRadius && distY <= bomb.blastRadius) {
        const res = this.gameState.applyDamageToEnemy(enemy.id, bomb.damage);
        if (res.hit) {
          hitResults.push({
            enemyId: enemy.id,
            damage: bomb.damage,
            destroyed: res.destroyed,
            remainingHealth: res.remainingHealth,
          });
          this.addLog(
            `Bomb at (${bomb.x}, ${bomb.y}) hit ${enemy.name} for ${bomb.damage} DMG${
              res.destroyed ? ' [DESTROYED]' : ''
            }.`,
            res.destroyed ? 'success' : 'info'
          );
          if (res.destroyed) {
            this.addCombatEvent(
              'defeated',
              `${enemy.name} (${enemy.archetype}) destroyed by bomb blast!`
            );
          }
        }
      }
    }

    // Check if player is inside blast radius
    const playerDistX = Math.abs(this.gameState.player.x - bomb.x);
    const playerDistY = Math.abs(this.gameState.player.y - bomb.y);
    if (
      playerDistX <= bomb.blastRadius &&
      playerDistY <= bomb.blastRadius &&
      this.gameState.player.health > 0
    ) {
      this.applyCombatDamageToPlayer(
        bomb.damage,
        bomb.x,
        bomb.y,
        `Bomb blast at (${bomb.x}, ${bomb.y}) hit UNIT-01 (-${bomb.damage} HP)!`
      );
    } else {
      this.addCombatEvent(
        'explosion',
        `Bomb detonated at (${bomb.x}, ${bomb.y}).`
      );
    }

    this.view?.animateBombExplosion(
      bomb.id,
      bomb.x,
      bomb.y,
      bomb.blastRadius,
      hitResults
    );
    this.checkVictoryCondition();
    this.emitStateSnapshot();
  }

  private async handlePlayerLaser(): Promise<CommandExecutionResult> {
    const px = this.gameState.player.x;
    const py = this.gameState.player.y;
    const facing = this.gameState.player.facing;
    const laserDmg = COMBAT_CONFIG.player.laserDamage;
    const maxRange = COMBAT_CONFIG.player.laserRange;

    const dx = facing === 'east' ? 1 : facing === 'west' ? -1 : 0;
    const dy = facing === 'south' ? 1 : facing === 'north' ? -1 : 0;

    let endX = px;
    let endY = py;
    let hitEnemy: EnemyState | undefined;
    let destroyed = false;

    for (let step = 1; step <= maxRange; step++) {
      const cx = px + dx * step;
      const cy = py + dy * step;

      if (!this.gameState.isInsideArena(cx, cy)) {
        break;
      }

      endX = cx;
      endY = cy;

      if (this.gameState.isWallAt(cx, cy)) {
        break;
      }

      const enemyAtCell = this.gameState
        .getLivingEnemies()
        .find((e) => e.x === cx && e.y === cy);

      if (enemyAtCell) {
        hitEnemy = enemyAtCell;
        const dmgRes = this.gameState.applyDamageToEnemy(
          enemyAtCell.id,
          laserDmg
        );
        destroyed = dmgRes.destroyed;
        break;
      }
    }

    this.emitStateSnapshot();

    if (this.view) {
      await this.view.animateLaser(
        px,
        py,
        endX,
        endY,
        facing,
        hitEnemy?.id,
        hitEnemy ? laserDmg : undefined,
        destroyed
      );
    }

    if (hitEnemy) {
      if (destroyed) {
        this.addCombatEvent(
          'defeated',
          `${hitEnemy.name} defeated by laser!`
        );
        this.checkVictoryCondition();
      } else {
        this.addCombatEvent(
          'laser',
          `Laser hit ${hitEnemy.name} for ${laserDmg} damage (${hitEnemy.health} HP left).`
        );
      }
      return {
        success: true,
        formattedCall: 'laser()',
        message: `laser() hit ${hitEnemy.name} at (${endX}, ${endY}) [-${laserDmg} HP]${
          destroyed ? ' [DEFEATED]' : ''
        }.`,
      };
    }

    return {
      success: true,
      formattedCall: 'laser()',
      message: `laser() fired ${
        facing === 'east'
          ? 'right'
          : facing === 'west'
          ? 'left'
          : facing === 'north'
          ? 'up'
          : 'down'
      }.`,
    };
  }

  private async handlePlayerShockwave(): Promise<CommandExecutionResult> {
    if (this.gameState.player.shockwaveCooldownRemainingMs > 0) {
      const remSec = (
        this.gameState.player.shockwaveCooldownRemainingMs / 1000
      ).toFixed(1);
      return {
        success: false,
        formattedCall: 'shockwave()',
        message: `shockwave() is recharging (${remSec}s cooldown remaining).`,
      };
    }

    const px = this.gameState.player.x;
    const py = this.gameState.player.y;
    const pCfg = COMBAT_CONFIG.player;
    const radius = pCfg.shockwaveRadius;
    const damage = pCfg.shockwaveDamage;

    this.gameState.player.shockwaveCooldownRemainingMs =
      pCfg.shockwaveCooldownMs;

    const hitResults: Array<{
      enemyId: string;
      damage: number;
      destroyed: boolean;
      remainingHealth: number;
    }> = [];

    for (const enemy of this.gameState.getLivingEnemies()) {
      const dist = Math.hypot(enemy.x - px, enemy.y - py);
      if (dist <= radius + 0.25) {
        const res = this.gameState.applyDamageToEnemy(enemy.id, damage);
        if (res.hit) {
          hitResults.push({
            enemyId: enemy.id,
            damage,
            destroyed: res.destroyed,
            remainingHealth: res.remainingHealth,
          });
          if (res.destroyed) {
            this.addCombatEvent(
              'defeated',
              `${enemy.name} defeated by shockwave!`
            );
          } else {
            this.addCombatEvent(
              'shockwave',
              `Shockwave hit ${enemy.name} for ${damage} damage (${res.remainingHealth} HP left).`
            );
          }
        }
      }
    }

    if (hitResults.length === 0) {
      this.addCombatEvent(
        'shockwave',
        `Shockwave pulse released at (${px}, ${py}).`
      );
    }

    this.emitStateSnapshot();

    if (this.view) {
      await this.view.animateShockwave(px, py, radius, hitResults);
    }

    this.checkVictoryCondition();
    this.emitStateSnapshot();

    if (hitResults.length > 0) {
      return {
        success: true,
        formattedCall: 'shockwave()',
        message: `shockwave() hit ${hitResults.length} ${
          hitResults.length === 1 ? 'enemy' : 'enemies'
        } (-${damage} HP).`,
      };
    }

    return {
      success: true,
      formattedCall: 'shockwave()',
      message: 'shockwave() executed (no enemies in range).',
    };
  }

  private applyCombatDamageToPlayer(
    damage: number,
    sourceX: number,
    sourceY: number,
    eventMessage: string
  ): void {
    const res = this.gameState.applyDamageToPlayer(damage, sourceX, sourceY);
    if (!res.damaged) return;

    this.view?.animatePlayerDamaged(
      damage,
      res.remainingHealth,
      res.knockbackTo,
      res.defeated
    );
    this.addCombatEvent('damage', eventMessage);

    if (res.defeated) {
      this.clearTickTimer();
      this.interpreter.stop(true);
      this.setStatus('GAME_OVER');
      this.addLog('Robot destroyed! Press Reset to try again.', 'error');
      this.addCombatEvent(
        'damage',
        'Robot destroyed! Press Reset to try again.'
      );
    }

    this.emitStateSnapshot();
  }

  private checkVictoryCondition(): void {
    if (
      this.gameState.getLivingEnemies().length === 0 &&
      this.gameState.player.health > 0 &&
      this.status !== 'VICTORY'
    ) {
      this.clearTickTimer();
      this.interpreter.stop(true);
      this.setStatus('VICTORY');
      this.addCombatEvent(
        'defeated',
        'All enemy units defeated — Victory!'
      );
      this.addLog('All enemies defeated! Victory achieved!', 'success');
      this.emitStateSnapshot();
    }
  }

  private emitStateSnapshot(): void {
    this.callbacks.onStateChange?.(this.gameState.getSnapshot());
  }

  private addLog(
    message: string,
    type: ExecutionLogEntry['type'],
    line?: number
  ): void {
    this.logSequence++;
    const mins = Math.floor(this.logSequence / 60)
      .toString()
      .padStart(2, '0');
    const secs = (this.logSequence % 60).toString().padStart(2, '0');
    const entry: ExecutionLogEntry = {
      id: `log-${Date.now()}-${this.logSequence}`,
      timestamp: `${mins}:${secs}`,
      message,
      type,
      line,
    };

    this.logs = [...this.logs.slice(-99), entry];
    this.callbacks.onLogsChange?.(this.logs);
  }

  public addCombatEvent(
    category: CombatEventCategory,
    message: string,
    dedupeKey?: string
  ): void {
    const now = Date.now();
    if (dedupeKey) {
      const prevTime = this.lastDedupeMap.get(dedupeKey);
      if (prevTime && now - prevTime < 2800) {
        return;
      }
      this.lastDedupeMap.set(dedupeKey, now);
    }

    this.combatEventSeq++;
    const mins = Math.floor(this.combatEventSeq / 60)
      .toString()
      .padStart(2, '0');
    const secs = (this.combatEventSeq % 60).toString().padStart(2, '0');
    const entry: CombatEventEntry = {
      id: `combat-${now}-${this.combatEventSeq}`,
      timestamp: `${mins}:${secs}`,
      category,
      message,
    };

    this.combatEvents = [...this.combatEvents.slice(-59), entry];
    this.callbacks.onCombatEventsChange?.(this.combatEvents);
  }
}
