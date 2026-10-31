import { Direction } from '../../types/game';
import {
  PvPExecutionState,
  PvPInstruction,
  PvPMatchConfig,
  PvPPlayerId,
  PvPPlayerSnapshot,
  PvPPlayerStats,
} from './pvpTypes';

/**
 * Isolated execution context for a single player in Local PvP mode.
 * Each player owns their own instance — no instruction pointers, variables,
 * timers, or cooldowns are shared between Player 1 and Player 2.
 */
export class PvPInterpreterContext {
  public readonly id: PvPPlayerId;
  public name: string;
  private program: PvPInstruction[] = [];
  public instructionPointer = 0;
  public executionState: PvPExecutionState = 'FINISHED';
  public nextActionTimeMs = 0;

  public x: number;
  public y: number;
  public prevX: number;
  public prevY: number;
  public facing: Direction;
  public health: number;
  public maxHealth: number;
  public alive = true;

  public invulnerableRemainingMs = 0;
  public shockwaveCooldownRemainingMs = 0;
  public lastActionText = 'Ready';

  public variables: Record<string, number> = {
    x: 0,
    y: 0,
    health: 100,
    enemy_x: 0,
    enemy_y: 0,
    enemy_count: 1,
  };

  public stats: PvPPlayerStats = {
    damageDealt: 0,
    laserHits: 0,
    bombsPlaced: 0,
    shockwavesUsed: 0,
    instructionsExecuted: 0,
  };

  constructor(
    id: PvPPlayerId,
    name: string,
    spawnX: number,
    spawnY: number,
    facing: Direction,
    maxHealth: number
  ) {
    this.id = id;
    this.name = name;
    this.x = spawnX;
    this.y = spawnY;
    this.prevX = spawnX;
    this.prevY = spawnY;
    this.facing = facing;
    this.health = maxHealth;
    this.maxHealth = maxHealth;
  }

  public reset(
    program: PvPInstruction[],
    config: PvPMatchConfig,
    name?: string
  ): void {
    if (name) {
      this.name = name;
    }
    const spawn = this.id === 'P1' ? config.p1Spawn : config.p2Spawn;
    this.x = spawn.x;
    this.y = spawn.y;
    this.prevX = spawn.x;
    this.prevY = spawn.y;
    this.facing = spawn.facing;
    this.health = config.maxHealth;
    this.maxHealth = config.maxHealth;
    this.alive = true;

    this.invulnerableRemainingMs = 0;
    this.shockwaveCooldownRemainingMs = 0;

    // Deep clone instructions so contexts never share references
    this.program = program.map((instr) => ({
      ...instr,
      args: [...instr.args],
    }));
    this.instructionPointer = 0;

    if (this.program.length > 0) {
      this.executionState = 'RUNNING';
      this.nextActionTimeMs = config.instructionIntervalMs;
      this.lastActionText = 'Ready to execute';
    } else {
      this.executionState = 'FINISHED';
      this.nextActionTimeMs = Infinity;
      this.lastActionText = 'No instructions';
    }

    this.stats = {
      damageDealt: 0,
      laserHits: 0,
      bombsPlaced: 0,
      shockwavesUsed: 0,
      instructionsExecuted: 0,
    };

    this.variables = {
      x: this.x,
      y: this.y,
      health: this.health,
      enemy_x: 0,
      enemy_y: 0,
      enemy_count: 1,
    };
  }

  /**
   * Prepares the player for a fresh round in a continuous match.
   * Preserves health, position, facing direction, stats, and cooldowns.
   */
  public startNewRound(
    program: PvPInstruction[],
    currentBattleElapsedMs: number,
    config: PvPMatchConfig
  ): void {
    if (!this.alive || this.health <= 0) {
      this.program = [];
      this.instructionPointer = 0;
      this.executionState = 'DEFEATED';
      this.nextActionTimeMs = Infinity;
      this.lastActionText = 'Destroyed';
      return;
    }

    // Deep clone fresh program for this round
    this.program = program.map((instr) => ({
      ...instr,
      args: [...instr.args],
    }));
    this.instructionPointer = 0;

    if (this.program.length > 0) {
      this.executionState = 'RUNNING';
      this.nextActionTimeMs =
        currentBattleElapsedMs + config.instructionIntervalMs;
      this.lastActionText = 'Ready for round';
    } else {
      this.executionState = 'FINISHED';
      this.nextActionTimeMs = Infinity;
      this.lastActionText = 'Idle (no instructions)';
    }

    this.updateVariables(
      this.variables.enemy_x,
      this.variables.enemy_y,
      this.variables.enemy_count > 0
    );
  }

  public isRoundCompleted(): boolean {
    if (!this.alive || this.health <= 0) return true;
    return (
      this.executionState === 'FINISHED' || this.executionState === 'DEFEATED'
    );
  }

  public updateTimers(deltaMs: number): void {
    if (this.invulnerableRemainingMs > 0) {
      this.invulnerableRemainingMs = Math.max(
        0,
        this.invulnerableRemainingMs - deltaMs
      );
    }
    if (this.shockwaveCooldownRemainingMs > 0) {
      this.shockwaveCooldownRemainingMs = Math.max(
        0,
        this.shockwaveCooldownRemainingMs - deltaMs
      );
    }
  }

  public updateVariables(
    opponentX: number,
    opponentY: number,
    opponentAlive: boolean
  ): void {
    this.variables.x = this.x;
    this.variables.y = this.y;
    this.variables.health = this.health;
    this.variables.enemy_x = opponentAlive ? opponentX : -1;
    this.variables.enemy_y = opponentAlive ? opponentY : -1;
    this.variables.enemy_count = opponentAlive ? 1 : 0;
  }

  public isActionDue(battleElapsedMs: number): boolean {
    if (!this.alive || this.health <= 0) return false;
    if (
      this.executionState === 'FINISHED' ||
      this.executionState === 'DEFEATED'
    ) {
      return false;
    }
    if (this.instructionPointer >= this.program.length) {
      // A trailing wait(n) must fully elapse before the program counts as finished.
      if (battleElapsedMs >= this.nextActionTimeMs) {
        this.executionState = 'FINISHED';
        this.nextActionTimeMs = Infinity;
        this.lastActionText = 'Program complete';
      }
      return false;
    }
    return battleElapsedMs >= this.nextActionTimeMs;
  }

  public popNextInstruction(): PvPInstruction | null {
    if (
      !this.alive ||
      this.instructionPointer >= this.program.length
    ) {
      this.executionState = this.alive ? 'FINISHED' : 'DEFEATED';
      return null;
    }
    const instr = this.program[this.instructionPointer];
    this.instructionPointer += 1;
    this.stats.instructionsExecuted += 1;
    return instr;
  }

  public scheduleAfterInstruction(
    currentStepTimeMs: number,
    baseIntervalMs: number,
    waitSeconds = 0
  ): void {
    if (!this.alive || this.health <= 0) {
      this.executionState = 'DEFEATED';
      this.nextActionTimeMs = Infinity;
      return;
    }

    if (this.instructionPointer >= this.program.length) {
      if (waitSeconds > 0) {
        // Final instruction was wait(n): stay WAITING until it elapses.
        // isActionDue() marks the program FINISHED once the wait is over.
        this.executionState = 'WAITING';
        this.nextActionTimeMs = currentStepTimeMs + waitSeconds * 1000;
      } else {
        this.executionState = 'FINISHED';
        this.nextActionTimeMs = Infinity;
      }
      return;
    }

    if (waitSeconds > 0) {
      this.executionState = 'WAITING';
      // wait(n) adds n seconds before that player's next instruction
      this.nextActionTimeMs = currentStepTimeMs + waitSeconds * 1000;
    } else {
      this.executionState = 'RUNNING';
      this.nextActionTimeMs = currentStepTimeMs + baseIntervalMs;
    }
  }

  public getTotalInstructions(): number {
    return this.program.length;
  }

  public getSnapshot(): PvPPlayerSnapshot {
    return {
      id: this.id,
      name: this.name,
      x: this.x,
      y: this.y,
      prevX: this.prevX,
      prevY: this.prevY,
      facing: this.facing,
      health: this.health,
      maxHealth: this.maxHealth,
      alive: this.alive,
      invulnerableRemainingMs: this.invulnerableRemainingMs,
      shockwaveCooldownRemainingMs: this.shockwaveCooldownRemainingMs,
      instructionPointer: this.instructionPointer,
      totalInstructions: this.program.length,
      executionState: this.executionState,
      nextActionTimeMs: this.nextActionTimeMs,
      lastActionText: this.lastActionText,
      stats: { ...this.stats },
      variables: { ...this.variables },
    };
  }
}

