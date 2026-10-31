import {
  BombState,
  CombatEventCategory,
  CombatEventEntry,
  Direction,
  GridPosition,
} from '../../types/game';
import { PvPInterpreterContext } from './PvPInterpreterContext';
import {
  DEFAULT_PVP_CONFIG,
  IPvPArenaView,
  PvPBattleCallbacks,
  PvPBattleSnapshot,
  PvPEndReason,
  PvPInstruction,
  PvPMatchConfig,
  PvPPlayerId,
  PvPRoundPhase,
  PvPWinner,
} from './pvpTypes';

/** Temporary round-lifecycle debug logging. Set to false to silence. */
const PVP_DEBUG = true;

interface QueuedDamage {
  targetId: PvPPlayerId;
  attackerId: PvPPlayerId;
  amount: number;
  reason: string;
  bypassSameTickInvulnerability: boolean;
}

export class PvPBattleController {
  public readonly config: PvPMatchConfig;
  public readonly p1Context: PvPInterpreterContext;
  public readonly p2Context: PvPInterpreterContext;

  private walls: GridPosition[] = [];
  private bombs: BombState[] = [];
  private bombSequence = 0;

  private currentRound = 1;
  private roundPhase: PvPRoundPhase = 'PLAYER_1_PROGRAMMING';
  private pendingP1Program: PvPInstruction[] | null = null;
  private pendingP2Program: PvPInstruction[] | null = null;
  private roundElapsedMs = 0;
  private roundCompletionSettlingMs = 0;
  private isRoundFinished = false;
  private p1CompletionLogged = false;
  private p2CompletionLogged = false;

  private battleElapsedMs = 0;
  private isBattleActive = false;
  private isBattleFinished = false;
  private winner: PvPWinner = null;
  private endReason: PvPEndReason = null;

  private view: IPvPArenaView | null = null;
  private callbacks: PvPBattleCallbacks;
  private combatEvents: CombatEventEntry[] = [];
  private combatEventSeq = 0;
  private lastFrameTimestamp = -1;
  private uiSyncAccumulatorMs = 0;

  constructor(
    callbacks: PvPBattleCallbacks = {},
    config: PvPMatchConfig = DEFAULT_PVP_CONFIG
  ) {
    this.callbacks = callbacks;
    this.config = { ...config };

    this.p1Context = new PvPInterpreterContext(
      'P1',
      'Player 1',
      this.config.p1Spawn.x,
      this.config.p1Spawn.y,
      this.config.p1Spawn.facing,
      this.config.maxHealth
    );

    this.p2Context = new PvPInterpreterContext(
      'P2',
      'Player 2',
      this.config.p2Spawn.x,
      this.config.p2Spawn.y,
      this.config.p2Spawn.facing,
      this.config.maxHealth
    );

    this.resetMatch('Player 1', 'Player 2', false);
  }

  public attachView(view: IPvPArenaView | null): void {
    this.view = view;
    if (view) {
      view.initPvPArena(this.getSnapshot());
    }
  }

  /**
   * Resets the entire match to Round 1: spawns, 100 HP, stats, bombs, and timer.
   */
  public resetMatch(
    p1Name = 'Player 1',
    p2Name = 'Player 2',
    notifyCallbacks = true
  ): void {
    this.currentRound = 1;
    this.roundPhase = 'PLAYER_1_PROGRAMMING';
    this.pendingP1Program = null;
    this.pendingP2Program = null;
    this.roundElapsedMs = 0;
    this.roundCompletionSettlingMs = 0;
    this.isRoundFinished = false;
    this.battleElapsedMs = 0;
    this.isBattleActive = false;
    this.isBattleFinished = false;
    this.winner = null;
    this.endReason = null;
    this.lastFrameTimestamp = -1;
    this.uiSyncAccumulatorMs = 0;

    this.walls = this.config.initialWalls.map((w) => ({ ...w }));
    this.bombs = [];
    this.bombSequence = 0;
    this.combatEvents = [];
    this.combatEventSeq = 0;

    this.p1Context.reset([], this.config, p1Name);
    this.p2Context.reset([], this.config, p2Name);
    this.syncPlayerVariables();

    const snap = this.getSnapshot();
    if (notifyCallbacks) {
      this.callbacks.onCombatEventsChange?.([]);
      this.callbacks.onSnapshotChange?.(snap);
    }
    this.view?.initPvPArena(snap);
    if (notifyCallbacks) {
      this.debug('Match reset. Round started.');
      this.debug('Player 1 programming.');
    }
  }

  public getRoundPhase(): PvPRoundPhase {
    return this.roundPhase;
  }

  /**
   * Locks a player's program for the current round. Guarded so each lock
   * happens exactly once and only in the correct phase:
   *   P1 lock: PLAYER_1_PROGRAMMING -> PLAYER_2_PROGRAMMING
   *   P2 lock: PLAYER_2_PROGRAMMING -> ROUND_EXECUTING (execution pending)
   * Returns false (and does nothing) if called out of order.
   */
  public lockProgram(playerId: PvPPlayerId, program: PvPInstruction[]): boolean {
    const copy = program.map((i) => ({ ...i, args: [...i.args] }));
    if (playerId === 'P1' && this.roundPhase === 'PLAYER_1_PROGRAMMING') {
      this.pendingP1Program = copy;
      this.roundPhase = 'PLAYER_2_PROGRAMMING';
      this.debug(`Player 1 locked program (${copy.length} instructions).`);
      this.debug('Player 2 programming.');
      return true;
    }
    if (playerId === 'P2' && this.roundPhase === 'PLAYER_2_PROGRAMMING') {
      this.pendingP2Program = copy;
      this.roundPhase = 'ROUND_EXECUTING';
      this.debug(`Player 2 locked program (${copy.length} instructions).`);
      this.debug('Both programs ready.');
      return true;
    }
    this.debug(
      `Ignored ${playerId} lock: phase is ${this.roundPhase}.`,
      'warn'
    );
    return false;
  }

  /**
   * Starts simultaneous execution of both locked programs. Runs exactly once
   * per round: the pending programs are consumed, so repeat calls are no-ops.
   */
  public beginRoundExecution(): boolean {
    if (
      this.roundPhase !== 'ROUND_EXECUTING' ||
      this.pendingP1Program === null ||
      this.pendingP2Program === null
    ) {
      this.debug(
        `Ignored beginRoundExecution: phase=${this.roundPhase}, programs ready=${
          this.pendingP1Program !== null && this.pendingP2Program !== null
        }.`,
        'warn'
      );
      return false;
    }

    const p1Program = this.pendingP1Program;
    const p2Program = this.pendingP2Program;
    this.pendingP1Program = null;
    this.pendingP2Program = null;

    // Round-specific state only. Positions, HP, bombs, cooldowns, walls and the
    // battle clock are deliberately untouched so they persist across rounds.
    this.roundElapsedMs = 0;
    this.roundCompletionSettlingMs = 0;
    this.isRoundFinished = false;
    // Drop any stale frame timestamp so the first frame of this round is never skipped.
    this.lastFrameTimestamp = -1;
    this.p1Context.startNewRound(p1Program, this.battleElapsedMs, this.config);
    this.p2Context.startNewRound(p2Program, this.battleElapsedMs, this.config);
    this.syncPlayerVariables();
    this.isBattleActive = true;

    this.debug(
      `Execution started (P1: ${p1Program.length}, P2: ${p2Program.length} instructions).`
    );
    this.addCombatEvent(
      'system',
      `Round ${this.currentRound} began! Both robots executing instructions.`
    );
    this.callbacks.onSnapshotChange?.(this.getSnapshot());
    return true;
  }

  /**
   * Convenience used by tests: lock both programs and execute immediately.
   * Only valid from PLAYER_1_PROGRAMMING.
   */
  public startRoundBattle(
    p1Program: PvPInstruction[],
    p2Program: PvPInstruction[]
  ): boolean {
    return (
      this.lockProgram('P1', p1Program) &&
      this.lockProgram('P2', p2Program) &&
      this.beginRoundExecution()
    );
  }

  /**
   * ROUND_TRANSITION -> PLAYER_1_PROGRAMMING with round + 1. Preserves player
   * health, positions, facing, active bombs and cooldowns. Guarded so a
   * double trigger (auto-advance timer + "Next Round" click) advances once.
   */
  public advanceToNextRound(): boolean {
    if (this.roundPhase !== 'ROUND_TRANSITION') {
      this.debug(
        `Ignored advanceToNextRound: phase is ${this.roundPhase}.`,
        'warn'
      );
      return false;
    }
    this.currentRound += 1;
    this.roundPhase = 'PLAYER_1_PROGRAMMING';
    this.pendingP1Program = null;
    this.pendingP2Program = null;
    this.roundElapsedMs = 0;
    this.roundCompletionSettlingMs = 0;
    this.isRoundFinished = false;
    this.isBattleActive = false;
    this.syncPlayerVariables();

    this.debug('Next round started.');
    this.debug('Player 1 programming.');
    this.addCombatEvent(
      'system',
      `Round ${this.currentRound} planning phase started.`
    );
    this.callbacks.onSnapshotChange?.(this.getSnapshot());
    return true;
  }

  public startBattle(
    p1Program: PvPInstruction[],
    p2Program: PvPInstruction[],
    p1Name = 'Player 1',
    p2Name = 'Player 2'
  ): void {
    this.resetMatch(p1Name, p2Name, false);
    this.startRoundBattle(p1Program, p2Program);
    const snap = this.getSnapshot();
    this.view?.initPvPArena(snap);
    this.callbacks.onSnapshotChange?.(snap);
  }

  public resetBattle(
    p1Program: PvPInstruction[] = [],
    p2Program: PvPInstruction[] = [],
    p1Name = 'Player 1',
    p2Name = 'Player 2',
    notifyCallbacks = true
  ): void {
    this.resetMatch(p1Name, p2Name, notifyCallbacks);
    if (p1Program.length > 0 || p2Program.length > 0) {
      this.startRoundBattle(p1Program, p2Program);
    }
  }

  public stopBattle(): void {
    this.isBattleActive = false;
  }

  private debug(message: string, level: 'log' | 'warn' = 'log'): void {
    if (!PVP_DEBUG) return;
    console[level](`[PvP][Round ${this.currentRound}] ${message}`);
  }

  private finishRound(reason: string): void {
    if (this.roundPhase !== 'ROUND_EXECUTING') return;
    this.isBattleActive = false;
    this.isRoundFinished = true;
    this.roundPhase = 'ROUND_TRANSITION';
    this.debug(`Round completed (${reason}).`);
    this.addCombatEvent('system', `Round ${this.currentRound} complete. ${reason}`);
    const snap = this.getSnapshot();
    this.callbacks.onSnapshotChange?.(snap);
    this.callbacks.onRoundFinished?.(snap);
  }

  /**
   * Called each frame from Phaser's update loop (or deterministically in tests).
   * Uses a fixed internal sub-step so simultaneous 700ms action boundaries and
   * wait(n) timers are evaluated at exact timestamps without drift or order bias.
   */
  public updateSimulation(frameTimeMs: number, rawDeltaMs: number): void {
    if (frameTimeMs === this.lastFrameTimestamp) return;
    this.lastFrameTimestamp = frameTimeMs;

    if (!this.isBattleActive || this.isBattleFinished) return;

    const clampedDelta = Math.min(250, Math.max(0, rawDeltaMs));
    let remainingDelta = clampedDelta;
    const maxStepMs = 50;

    while (remainingDelta > 0 && this.isBattleActive && !this.isBattleFinished) {
      const stepMs = Math.min(remainingDelta, maxStepMs);
      remainingDelta -= stepMs;
      this.advanceStep(stepMs);
    }

    const snap = this.getSnapshot();
    this.view?.updatePvPRealtimeVisuals(snap);

    this.uiSyncAccumulatorMs += clampedDelta;
    if (this.uiSyncAccumulatorMs >= 100 || this.isBattleFinished) {
      this.uiSyncAccumulatorMs = 0;
      this.callbacks.onSnapshotChange?.(snap);
    }
  }

  private advanceStep(stepMs: number): void {
    const maxBattleMs = this.config.battleDurationSeconds * 1000;
    const nextElapsed = Math.min(maxBattleMs, this.battleElapsedMs + stepMs);
    const actualDelta = nextElapsed - this.battleElapsedMs;
    this.battleElapsedMs = nextElapsed;
    this.roundElapsedMs += actualDelta;

    // 1. Update cooldowns & invulnerability timers on both isolated contexts
    this.p1Context.updateTimers(actualDelta);
    this.p2Context.updateTimers(actualDelta);

    // 2. Update active bombs on the shared battlefield
    this.updateBombs(actualDelta);
    if (this.checkAndResolveKnockout()) {
      return;
    }

    // 3. Check if one or both players have an instruction due at this simulation time
    const p1Due = this.p1Context.isActionDue(this.battleElapsedMs);
    const p2Due = this.p2Context.isActionDue(this.battleElapsedMs);

    if (p1Due || p2Due) {
      this.executeSimultaneousActionBatch(p1Due, p2Due);
      if (this.checkAndResolveKnockout()) {
        return;
      }
    }

    // 4. Check 60-second battle timeout
    if (this.battleElapsedMs >= maxBattleMs) {
      this.resolveTimeoutEnd();
      return;
    }

    // 5. Check if round has completed (both programs finished or max round safety timeout reached)
    const p1WasDone = this.p1Context.isRoundCompleted();
    const p2WasDone = this.p2Context.isRoundCompleted();
    // isActionDue() also promotes a finished trailing wait(n) to FINISHED.
    this.p1Context.isActionDue(this.battleElapsedMs);
    this.p2Context.isActionDue(this.battleElapsedMs);
    const p1Done = this.p1Context.isRoundCompleted();
    const p2Done = this.p2Context.isRoundCompleted();
    if (p1Done && !this.p1CompletionLogged) {
      this.p1CompletionLogged = true;
      this.debug(`Player 1 program completed${p1WasDone ? '' : ''}.`);
    }
    if (p2Done && !this.p2CompletionLogged) {
      this.p2CompletionLogged = true;
      this.debug(`Player 2 program completed${p2WasDone ? '' : ''}.`);
    }
    const maxRoundDurationMs =
      this.config.maxInstructionSlots *
        (this.config.instructionIntervalMs + this.config.waitMaxSeconds * 1000) +
      1500;

    if (p1Done && p2Done) {
      // Short settling period so the final animations play before freezing.
      this.roundCompletionSettlingMs += actualDelta;
      if (this.roundCompletionSettlingMs >= 500) {
        this.finishRound('Both programs executed.');
      }
    } else if (this.roundElapsedMs >= maxRoundDurationMs) {
      this.finishRound('Round safety time limit reached.');
    }
  }

  /**
   * Executes due instructions for P1 and/or P2 in a single simultaneous batch:
   * - Movements are resolved together without P1/P2 order advantage.
   * - Attacks are evaluated against post-move positions, and resulting damage
   *   is applied simultaneously after both attacks have been evaluated.
   */
  private executeSimultaneousActionBatch(
    p1Due: boolean,
    p2Due: boolean
  ): void {
    const p1ActionTime = p1Due ? this.p1Context.nextActionTimeMs : 0;
    const p2ActionTime = p2Due ? this.p2Context.nextActionTimeMs : 0;

    const p1Instr = p1Due ? this.p1Context.popNextInstruction() : null;
    const p2Instr = p2Due ? this.p2Context.popNextInstruction() : null;

    // =========================================================================
    // PHASE 1: SIMULTANEOUS MOVEMENT RESOLUTION
    // =========================================================================
    const p1MoveIntent = p1Instr ? this.getMoveIntent(this.p1Context, p1Instr) : null;
    const p2MoveIntent = p2Instr ? this.getMoveIntent(this.p2Context, p2Instr) : null;

    let p1CanMove = false;
    let p2CanMove = false;
    let p1BlockReason: 'boundary' | 'wall' | 'robot' | null = null;
    let p2BlockReason: 'boundary' | 'wall' | 'robot' | null = null;

    if (p1MoveIntent) {
      this.p1Context.facing = p1MoveIntent.facing;
      if (!this.isInsideArena(p1MoveIntent.targetX, p1MoveIntent.targetY)) {
        p1BlockReason = 'boundary';
      } else if (this.isWallAt(p1MoveIntent.targetX, p1MoveIntent.targetY)) {
        p1BlockReason = 'wall';
      } else {
        p1CanMove = true;
      }
    }

    if (p2MoveIntent) {
      this.p2Context.facing = p2MoveIntent.facing;
      if (!this.isInsideArena(p2MoveIntent.targetX, p2MoveIntent.targetY)) {
        p2BlockReason = 'boundary';
      } else if (this.isWallAt(p2MoveIntent.targetX, p2MoveIntent.targetY)) {
        p2BlockReason = 'wall';
      } else {
        p2CanMove = true;
      }
    }

    // Check robot-to-robot movement conflicts fairly
    if (p1CanMove && p2CanMove && p1MoveIntent && p2MoveIntent) {
      const sameTarget =
        p1MoveIntent.targetX === p2MoveIntent.targetX &&
        p1MoveIntent.targetY === p2MoveIntent.targetY;
      const headOnSwap =
        p1MoveIntent.targetX === this.p2Context.x &&
        p1MoveIntent.targetY === this.p2Context.y &&
        p2MoveIntent.targetX === this.p1Context.x &&
        p2MoveIntent.targetY === this.p1Context.y;

      if (sameTarget || headOnSwap) {
        p1CanMove = false;
        p2CanMove = false;
        p1BlockReason = 'robot';
        p2BlockReason = 'robot';
      }
    } else if (p1CanMove && p1MoveIntent && !p2CanMove) {
      if (
        p1MoveIntent.targetX === this.p2Context.x &&
        p1MoveIntent.targetY === this.p2Context.y
      ) {
        p1CanMove = false;
        p1BlockReason = 'robot';
      }
    } else if (p2CanMove && p2MoveIntent && !p1CanMove) {
      if (
        p2MoveIntent.targetX === this.p1Context.x &&
        p2MoveIntent.targetY === this.p1Context.y
      ) {
        p2CanMove = false;
        p2BlockReason = 'robot';
      }
    }

    if (p1MoveIntent) {
      if (p1CanMove) {
        const fromX = this.p1Context.x;
        const fromY = this.p1Context.y;
        this.p1Context.prevX = fromX;
        this.p1Context.prevY = fromY;
        this.p1Context.x = p1MoveIntent.targetX;
        this.p1Context.y = p1MoveIntent.targetY;
        this.p1Context.lastActionText = `Moved to (${this.p1Context.x}, ${this.p1Context.y})`;
        this.view?.animatePvPMove(
          'P1',
          fromX,
          fromY,
          this.p1Context.x,
          this.p1Context.y,
          this.p1Context.facing
        );
      } else {
        this.p1Context.lastActionText = `Move blocked (${p1BlockReason})`;
        this.view?.animatePvPBlockedMove(
          'P1',
          this.p1Context.x,
          this.p1Context.y,
          p1MoveIntent.targetX,
          p1MoveIntent.targetY,
          this.p1Context.facing,
          p1BlockReason ?? 'wall'
        );
      }
    }

    if (p2MoveIntent) {
      if (p2CanMove) {
        const fromX = this.p2Context.x;
        const fromY = this.p2Context.y;
        this.p2Context.prevX = fromX;
        this.p2Context.prevY = fromY;
        this.p2Context.x = p2MoveIntent.targetX;
        this.p2Context.y = p2MoveIntent.targetY;
        this.p2Context.lastActionText = `Moved to (${this.p2Context.x}, ${this.p2Context.y})`;
        this.view?.animatePvPMove(
          'P2',
          fromX,
          fromY,
          this.p2Context.x,
          this.p2Context.y,
          this.p2Context.facing
        );
      } else {
        this.p2Context.lastActionText = `Move blocked (${p2BlockReason})`;
        this.view?.animatePvPBlockedMove(
          'P2',
          this.p2Context.x,
          this.p2Context.y,
          p2MoveIntent.targetX,
          p2MoveIntent.targetY,
          this.p2Context.facing,
          p2BlockReason ?? 'wall'
        );
      }
    }

    // =========================================================================
    // PHASE 2: SIMULTANEOUS ATTACK & WAIT EVALUATION
    // =========================================================================
    const queuedDamages: QueuedDamage[] = [];
    let p1WaitSec = 0;
    let p2WaitSec = 0;

    if (p1Instr && !p1MoveIntent) {
      p1WaitSec = this.evaluateNonMoveInstruction(
        this.p1Context,
        this.p2Context,
        p1Instr,
        queuedDamages
      );
    }

    if (p2Instr && !p2MoveIntent) {
      p2WaitSec = this.evaluateNonMoveInstruction(
        this.p2Context,
        this.p1Context,
        p2Instr,
        queuedDamages
      );
    }

    // =========================================================================
    // PHASE 3: APPLY SIMULTANEOUS DAMAGE POST-BATCH
    // =========================================================================
    this.applyQueuedDamages(queuedDamages);

    // =========================================================================
    // PHASE 4: SCHEDULE NEXT ACTION TIMES INDEPENDENTLY
    // =========================================================================
    if (p1Instr) {
      this.p1Context.scheduleAfterInstruction(
        p1ActionTime,
        this.config.instructionIntervalMs,
        p1WaitSec
      );
    }
    if (p2Instr) {
      this.p2Context.scheduleAfterInstruction(
        p2ActionTime,
        this.config.instructionIntervalMs,
        p2WaitSec
      );
    }

    this.syncPlayerVariables();
    this.callbacks.onSnapshotChange?.(this.getSnapshot());
  }

  private getMoveIntent(
    ctx: PvPInterpreterContext,
    instr: PvPInstruction
  ): { targetX: number; targetY: number; facing: Direction } | null {
    switch (instr.command) {
      case 'move_right':
        return { targetX: ctx.x + 1, targetY: ctx.y, facing: 'east' };
      case 'move_left':
        return { targetX: ctx.x - 1, targetY: ctx.y, facing: 'west' };
      case 'move_up':
        return { targetX: ctx.x, targetY: ctx.y - 1, facing: 'north' };
      case 'move_down':
        return { targetX: ctx.x, targetY: ctx.y + 1, facing: 'south' };
      default:
        return null;
    }
  }

  private evaluateNonMoveInstruction(
    attacker: PvPInterpreterContext,
    opponent: PvPInterpreterContext,
    instr: PvPInstruction,
    queuedDamages: QueuedDamage[]
  ): number {
    switch (instr.command) {
      case 'wait': {
        const waitSec = Math.max(
          this.config.waitMinSeconds,
          Math.min(this.config.waitMaxSeconds, Math.round(instr.args[0] ?? 1))
        );
        attacker.lastActionText = `Waiting (${waitSec}s)`;
        return waitSec;
      }

      case 'bomb': {
        const bx = Math.max(
          0,
          Math.min(this.config.gridSize - 1, Math.round(instr.args[0] ?? attacker.x))
        );
        const by = Math.max(
          0,
          Math.min(this.config.gridSize - 1, Math.round(instr.args[1] ?? attacker.y))
        );
        attacker.stats.bombsPlaced += 1;
        attacker.lastActionText = `Placed bomb at (${bx}, ${by})`;

        const bomb: BombState = {
          id: `pvp-bomb-${++this.bombSequence}`,
          owner: attacker.id,
          x: bx,
          y: by,
          countdown: this.config.bombCountdownTicks,
          elapsedMs: 0,
          stepDurationMs: this.config.bombStepDurationMs,
          blastRadius: this.config.bombBlastRadius,
          damage: this.config.bombDamage,
        };
        this.bombs.push(bomb);
        this.view?.spawnBombVisual(bomb);
        this.addCombatEvent(
          'bomb',
          `${attacker.name} placed a bomb at (${bx}, ${by})!`
        );
        return 0;
      }

      case 'laser': {
        const facing = attacker.facing;
        const dx = facing === 'east' ? 1 : facing === 'west' ? -1 : 0;
        const dy = facing === 'south' ? 1 : facing === 'north' ? -1 : 0;

        let endX = attacker.x;
        let endY = attacker.y;
        let hitOpponent = false;

        for (let step = 1; step <= this.config.laserRange; step++) {
          const cx = attacker.x + dx * step;
          const cy = attacker.y + dy * step;

          if (!this.isInsideArena(cx, cy)) break;
          endX = cx;
          endY = cy;

          if (this.isWallAt(cx, cy)) break;

          if (opponent.alive && opponent.x === cx && opponent.y === cy) {
            hitOpponent = true;
            break;
          }
        }

        this.view?.animatePvPLaser(
          attacker.id,
          attacker.x,
          attacker.y,
          endX,
          endY,
          facing,
          hitOpponent
        );

        if (hitOpponent) {
          attacker.stats.laserHits += 1;
          attacker.lastActionText = `Laser hit ${opponent.name}!`;
          queuedDamages.push({
            targetId: opponent.id,
            attackerId: attacker.id,
            amount: this.config.laserDamage,
            reason: `${attacker.name} hit ${opponent.name} with laser (-${this.config.laserDamage} HP)!`,
            bypassSameTickInvulnerability: true,
          });
        } else {
          attacker.lastActionText = 'Fired laser';
          this.addCombatEvent(
            'laser',
            `${attacker.name} fired laser (${facing}).`
          );
        }
        return 0;
      }

      case 'shockwave': {
        if (attacker.shockwaveCooldownRemainingMs > 0) {
          const remSec = (
            attacker.shockwaveCooldownRemainingMs / 1000
          ).toFixed(1);
          attacker.lastActionText = `Shockwave recharging (${remSec}s)`;
          this.addCombatEvent(
            'system',
            `${attacker.name} used shockwave while recharging (${remSec}s left).`
          );
          return 0;
        }

        attacker.shockwaveCooldownRemainingMs =
          this.config.shockwaveCooldownMs;
        attacker.stats.shockwavesUsed += 1;

        const dist = Math.hypot(
          opponent.x - attacker.x,
          opponent.y - attacker.y
        );
        const hitOpponent =
          opponent.alive && dist <= this.config.shockwaveRadius + 0.25;

        this.view?.animatePvPShockwave(
          attacker.id,
          attacker.x,
          attacker.y,
          this.config.shockwaveRadius,
          hitOpponent,
          opponent.x,
          opponent.y
        );

        if (hitOpponent) {
          attacker.lastActionText = `Shockwave hit ${opponent.name}!`;
          queuedDamages.push({
            targetId: opponent.id,
            attackerId: attacker.id,
            amount: this.config.shockwaveDamage,
            reason: `${attacker.name} hit ${opponent.name} with shockwave (-${this.config.shockwaveDamage} HP)!`,
            bypassSameTickInvulnerability: true,
          });
        } else {
          attacker.lastActionText = 'Released shockwave';
          this.addCombatEvent(
            'shockwave',
            `${attacker.name} released a shockwave pulse.`
          );
        }
        return 0;
      }

      default:
        return 0;
    }
  }

  private applyQueuedDamages(queuedDamages: QueuedDamage[]): void {
    if (queuedDamages.length === 0) return;

    // Check invulnerability state BEFORE applying any damage from this simultaneous batch
    const p1WasInvulnerable = this.p1Context.invulnerableRemainingMs > 0;
    const p2WasInvulnerable = this.p2Context.invulnerableRemainingMs > 0;

    let p1TotalDamage = 0;
    let p2TotalDamage = 0;

    for (const dmg of queuedDamages) {
      const target = dmg.targetId === 'P1' ? this.p1Context : this.p2Context;
      const attacker = dmg.attackerId === 'P1' ? this.p1Context : this.p2Context;
      const wasInvulnerable =
        dmg.targetId === 'P1' ? p1WasInvulnerable : p2WasInvulnerable;

      if (!target.alive || target.health <= 0) continue;
      if (wasInvulnerable && !dmg.bypassSameTickInvulnerability) continue;

      const effectiveDmg = Math.min(target.health, dmg.amount);
      target.health = Math.max(0, target.health - dmg.amount);
      if (target.health === 0) {
        target.alive = false;
        target.executionState = 'DEFEATED';
        target.lastActionText = 'Destroyed';
      }

      // Credit damage dealt when caused by the opponent
      if (attacker.id !== target.id) {
        attacker.stats.damageDealt += effectiveDmg;
      }

      if (target.id === 'P1') {
        p1TotalDamage += dmg.amount;
      } else {
        p2TotalDamage += dmg.amount;
      }

      this.addCombatEvent('damage', dmg.reason);
    }

    if (p1TotalDamage > 0) {
      if (this.p1Context.alive) {
        this.p1Context.invulnerableRemainingMs =
          this.config.invulnerabilityDurationMs;
      }
      this.view?.animatePvPPlayerDamaged(
        'P1',
        p1TotalDamage,
        this.p1Context.health,
        !this.p1Context.alive
      );
    }

    if (p2TotalDamage > 0) {
      if (this.p2Context.alive) {
        this.p2Context.invulnerableRemainingMs =
          this.config.invulnerabilityDurationMs;
      }
      this.view?.animatePvPPlayerDamaged(
        'P2',
        p2TotalDamage,
        this.p2Context.health,
        !this.p2Context.alive
      );
    }
  }

  private updateBombs(deltaMs: number): void {
    if (this.bombs.length === 0) return;

    const toDetonate: BombState[] = [];
    for (const bomb of this.bombs) {
      bomb.elapsedMs += deltaMs;
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

  private detonateBomb(bomb: BombState): void {
    const idx = this.bombs.findIndex((b) => b.id === bomb.id);
    if (idx === -1) return;
    this.bombs.splice(idx, 1);

    const queuedDamages: QueuedDamage[] = [];
    const ownerId: PvPPlayerId = bomb.owner === 'P2' ? 'P2' : 'P1';

    for (const target of [this.p1Context, this.p2Context]) {
      if (!target.alive) continue;
      const distX = Math.abs(target.x - bomb.x);
      const distY = Math.abs(target.y - bomb.y);
      if (distX <= bomb.blastRadius && distY <= bomb.blastRadius) {
        queuedDamages.push({
          targetId: target.id,
          attackerId: ownerId,
          amount: bomb.damage,
          reason: `Bomb at (${bomb.x}, ${bomb.y}) hit ${target.name} (-${bomb.damage} HP)!`,
          bypassSameTickInvulnerability: true,
        });
      }
    }

    if (queuedDamages.length === 0) {
      this.addCombatEvent(
        'explosion',
        `Bomb detonated at (${bomb.x}, ${bomb.y}).`
      );
    }

    this.applyQueuedDamages(queuedDamages);
    this.view?.animatePvPBombExplosion(
      bomb.id,
      bomb.x,
      bomb.y,
      bomb.blastRadius
    );
  }

  private checkAndResolveKnockout(): boolean {
    const p1Dead = !this.p1Context.alive || this.p1Context.health <= 0;
    const p2Dead = !this.p2Context.alive || this.p2Context.health <= 0;

    if (!p1Dead && !p2Dead) return false;

    this.isBattleActive = false;
    this.isBattleFinished = true;

    if (p1Dead && p2Dead) {
      this.winner = 'DRAW';
      this.endReason = 'DOUBLE_KO';
      this.addCombatEvent(
        'defeated',
        'Both robots destroyed simultaneously — Match Draw!'
      );
    } else if (p2Dead) {
      this.winner = 'P1';
      this.endReason = 'KNOCKOUT';
      this.addCombatEvent(
        'defeated',
        `${this.p2Context.name} destroyed! ${this.p1Context.name} wins!`
      );
    } else {
      this.winner = 'P2';
      this.endReason = 'KNOCKOUT';
      this.addCombatEvent(
        'defeated',
        `${this.p1Context.name} destroyed! ${this.p2Context.name} wins!`
      );
    }

    const snap = this.getSnapshot();
    this.callbacks.onSnapshotChange?.(snap);
    this.callbacks.onBattleFinished?.(snap);
    return true;
  }

  private resolveTimeoutEnd(): void {
    if (this.isBattleFinished) return;

    this.isBattleActive = false;
    this.isBattleFinished = true;
    this.endReason = 'TIMEOUT';

    if (this.p1Context.health > this.p2Context.health) {
      this.winner = 'P1';
      this.addCombatEvent(
        'system',
        `Time expired! ${this.p1Context.name} wins with higher health (${this.p1Context.health} vs ${this.p2Context.health} HP).`
      );
    } else if (this.p2Context.health > this.p1Context.health) {
      this.winner = 'P2';
      this.addCombatEvent(
        'system',
        `Time expired! ${this.p2Context.name} wins with higher health (${this.p2Context.health} vs ${this.p1Context.health} HP).`
      );
    } else {
      this.winner = 'DRAW';
      this.addCombatEvent(
        'system',
        `Time expired! Equal health (${this.p1Context.health} HP) — Match Draw!`
      );
    }

    const snap = this.getSnapshot();
    this.callbacks.onSnapshotChange?.(snap);
    this.callbacks.onBattleFinished?.(snap);
  }

  /**
   * Allows finishing the battle immediately at timeout rules when both programs
   * have finished and no bombs remain on the arena if the user chooses.
   */
  public finishAtTimeoutNow(): void {
    this.battleElapsedMs = this.config.battleDurationSeconds * 1000;
    this.resolveTimeoutEnd();
  }

  private syncPlayerVariables(): void {
    this.p1Context.updateVariables(
      this.p2Context.x,
      this.p2Context.y,
      this.p2Context.alive
    );
    this.p2Context.updateVariables(
      this.p1Context.x,
      this.p1Context.y,
      this.p1Context.alive
    );
  }

  public isInsideArena(x: number, y: number): boolean {
    return (
      x >= 0 &&
      x < this.config.gridSize &&
      y >= 0 &&
      y < this.config.gridSize
    );
  }

  public isWallAt(x: number, y: number): boolean {
    return this.walls.some((w) => w.x === x && w.y === y);
  }

  public getSnapshot(): PvPBattleSnapshot {
    const remainingMs = Math.max(
      0,
      this.config.battleDurationSeconds * 1000 - this.battleElapsedMs
    );
    return {
      gridSize: this.config.gridSize,
      currentRound: this.currentRound,
      roundPhase: this.roundPhase,
      roundElapsedMs: this.roundElapsedMs,
      isRoundFinished: this.isRoundFinished,
      battleElapsedMs: this.battleElapsedMs,
      battleRemainingSeconds: Math.ceil(remainingMs / 1000),
      battleDurationSeconds: this.config.battleDurationSeconds,
      isBattleActive: this.isBattleActive,
      isBattleFinished: this.isBattleFinished,
      winner: this.winner,
      endReason: this.endReason,
      p1: this.p1Context.getSnapshot(),
      p2: this.p2Context.getSnapshot(),
      walls: this.walls.map((w) => ({ ...w })),
      bombs: this.bombs.map((b) => ({ ...b })),
    };
  }

  private addCombatEvent(
    category: CombatEventCategory,
    message: string
  ): void {
    this.combatEventSeq++;
    const totalSec = Math.floor(this.battleElapsedMs / 1000);
    const mins = Math.floor(totalSec / 60)
      .toString()
      .padStart(2, '0');
    const secs = (totalSec % 60).toString().padStart(2, '0');
    const entry: CombatEventEntry = {
      id: `pvp-ev-${Date.now()}-${this.combatEventSeq}`,
      timestamp: `${mins}:${secs}`,
      category,
      message,
    };

    this.combatEvents = [...this.combatEvents.slice(-59), entry];
    this.callbacks.onCombatEventsChange?.(this.combatEvents);
  }
}

