import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import {
  BombState,
  Direction,
  GameStateSnapshot,
  GridPosition,
  SimulationSpeed,
} from '../../types/game';
import { IArenaView } from '../engine/GameController';
import { COMBAT_CONFIG } from '../config/combatConfig';
import {
  IPvPArenaView,
  PvPBattleSnapshot,
  PvPPlayerId,
} from '../pvp/pvpTypes';

interface ActiveBombVisual {
  container: Phaser.GameObjects.Container;
  bombGfx: Phaser.GameObjects.Graphics;
  countText: Phaser.GameObjects.Text;
  owner: 'player' | string;
  x: number;
  y: number;
  blastRadius: number;
  countdown: number;
}

export class ArenaScene
  extends Phaser.Scene
  implements IArenaView, IPvPArenaView
{
  private readonly GRID_SIZE = COMBAT_CONFIG.gridSize;
  private bgGraphics!: Phaser.GameObjects.Graphics;
  private decalGraphics!: Phaser.GameObjects.Graphics;
  private warningGraphics!: Phaser.GameObjects.Graphics;
  private wallGraphics!: Phaser.GameObjects.Graphics;
  private hoverGraphics!: Phaser.GameObjects.Graphics;
  private fxGraphics!: Phaser.GameObjects.Graphics;

  private xCoordLabels: Phaser.GameObjects.Text[] = [];
  private yCoordLabels: Phaser.GameObjects.Text[] = [];

  private player!: Player;
  private player2: Player | null = null;
  private enemies: Map<string, Enemy> = new Map();
  private activeBombs: Map<string, ActiveBombVisual> = new Map();
  private scorchMarks: GridPosition[] = [];
  private walls: GridPosition[] = COMBAT_CONFIG.initialWalls.map((w) => ({
    ...w,
  }));

  private cellSize = 36;
  private offsetX = 0;
  private offsetY = 0;
  private isMaximizedMode = false;
  private hoveredCell: GridPosition | null = null;
  private onHoverCell?: (pos: GridPosition | null) => void;
  private onSceneReady?: (scene: ArenaScene) => void;
  private onSimulationUpdate?: (time: number, delta: number) => void;

  constructor(
    onHoverCell?: (pos: GridPosition | null) => void,
    onSceneReady?: (scene: ArenaScene) => void,
    onSimulationUpdate?: (time: number, delta: number) => void
  ) {
    super({ key: 'ArenaScene' });
    this.onHoverCell = onHoverCell;
    this.onSceneReady = onSceneReady;
    this.onSimulationUpdate = onSimulationUpdate;
  }

  public setMaximizedMode(maximized: boolean): void {
    this.isMaximizedMode = maximized;
    this.refreshLayout();
  }

  public refreshLayout(): void {
    if (!this.scale || !this.bgGraphics) return;
    this.handleResize(this.scale.gameSize);
  }

  public create(): void {
    this.bgGraphics = this.add.graphics().setDepth(1);
    this.decalGraphics = this.add.graphics().setDepth(3);
    this.warningGraphics = this.add.graphics().setDepth(9);
    this.wallGraphics = this.add.graphics().setDepth(12);
    this.hoverGraphics = this.add.graphics().setDepth(8);
    this.fxGraphics = this.add.graphics().setDepth(30);

    this.calculateMetrics(this.scale.width, this.scale.height);
    this.createCoordinateLabels();
    this.drawArenaEnvironment();
    this.drawWalls();

    // Instantiate Player Robot
    const pInit = COMBAT_CONFIG.player.initialPosition;
    this.player = new Player(
      this,
      pInit.x,
      pInit.y,
      this.cellSize,
      this.offsetX,
      this.offsetY
    );

    // Instantiate all configured Enemy Archetypes
    for (const spawn of COMBAT_CONFIG.initialSpawns) {
      const initState =
        spawn.archetype === 'CHASER'
          ? 'CHASE'
          : spawn.archetype === 'BOMBER'
            ? 'TRACK'
            : 'SEARCH';
      const enemy = new Enemy(
        this,
        spawn.id,
        spawn.name,
        spawn.archetype,
        initState,
        spawn.x,
        spawn.y,
        spawn.maxHealth,
        this.cellSize,
        this.offsetX,
        this.offsetY
      );
      this.enemies.set(enemy.id, enemy);
    }

    this.highlightActiveCoordinates();

    // Pointer hover telemetry
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const gx = Math.floor((pointer.x - this.offsetX) / this.cellSize);
      const gy = Math.floor((pointer.y - this.offsetY) / this.cellSize);

      if (gx >= 0 && gx < this.GRID_SIZE && gy >= 0 && gy < this.GRID_SIZE) {
        if (
          !this.hoveredCell ||
          this.hoveredCell.x !== gx ||
          this.hoveredCell.y !== gy
        ) {
          this.hoveredCell = { x: gx, y: gy };
          this.drawHoverReticle();
          this.highlightActiveCoordinates();
          this.onHoverCell?.(this.hoveredCell);
        }
      } else if (this.hoveredCell !== null) {
        this.hoveredCell = null;
        this.hoverGraphics.clear();
        this.highlightActiveCoordinates();
        this.onHoverCell?.(null);
      }
    });

    this.scale.on('resize', this.handleResize, this);
    this.onSceneReady?.(this);
  }

  public override update(time: number, delta: number): void {
    this.onSimulationUpdate?.(time, delta);
  }

  public setSimulationSpeed(speed: SimulationSpeed): void {
    if (this.tweens) {
      this.tweens.timeScale = speed;
    }
    if (this.time) {
      this.time.timeScale = speed;
    }
  }

  public syncState(snapshot: GameStateSnapshot): void {
    this.walls = snapshot.walls.map((w) => ({ ...w }));
    if (!this.scene || !this.player) return;

    this.player.health = snapshot.player.health;
    this.player.maxHealth = snapshot.player.maxHealth;
    this.player.gridPos = { x: snapshot.player.x, y: snapshot.player.y };
    this.player.setFacing(snapshot.player.facing, false);
    this.player.updateLayout(this.cellSize, this.offsetX, this.offsetY);

    for (const enemyState of snapshot.enemies) {
      const enemyObj = this.enemies.get(enemyState.id);
      if (enemyObj) {
        enemyObj.resetTo(
          enemyState.x,
          enemyState.y,
          enemyState.facing,
          enemyState.aiState,
          enemyState.health,
          enemyState.maxHealth,
          enemyState.alive,
          this.cellSize,
          this.offsetX,
          this.offsetY
        );
      }
    }

    this.drawWalls();
    this.highlightActiveCoordinates();
  }

  public updateRealtimeVisuals(snapshot: GameStateSnapshot): void {
    if (!this.player || !this.warningGraphics) return;

    this.player.updateInvulnerabilityVisual(
      snapshot.player.invulnerableRemainingMs
    );

    this.warningGraphics.clear();

    for (const enemyState of snapshot.enemies) {
      const enemyObj = this.enemies.get(enemyState.id);
      if (enemyObj) {
        enemyObj.syncRealtimeState(
          enemyState.aiState,
          enemyState.facing,
          enemyState.chargeProgress ?? 0
        );
      }

      if (!enemyState.alive) continue;

      // Render Laser Shooter AIM / CHARGE warning beam
      if (
        enemyState.archetype === 'LASER_SHOOTER' &&
        (enemyState.aiState === 'AIM' || enemyState.aiState === 'CHARGE')
      ) {
        this.drawLaserWarningBeam(
          enemyState.x,
          enemyState.y,
          enemyState.lockedDirection ?? enemyState.facing,
          enemyState.aiState === 'CHARGE',
          enemyState.chargeProgress ?? 0
        );
      }

      // Render Bomber target reticle during PLACE_BOMB wind-up
      if (
        enemyState.archetype === 'BOMBER' &&
        enemyState.aiState === 'PLACE_BOMB' &&
        enemyState.lockedTarget
      ) {
        const tx =
          this.offsetX + enemyState.lockedTarget.x * this.cellSize;
        const ty =
          this.offsetY + enemyState.lockedTarget.y * this.cellSize;
        this.warningGraphics.lineStyle(1.5, 0xf97316, 0.85);
        this.warningGraphics.fillStyle(0xf97316, 0.14);
        this.warningGraphics.fillRect(
          tx + 2,
          ty + 2,
          this.cellSize - 4,
          this.cellSize - 4
        );
        this.warningGraphics.strokeRect(
          tx + 2,
          ty + 2,
          this.cellSize - 4,
          this.cellSize - 4
        );
      }
    }
  }

  private drawLaserWarningBeam(
    startX: number,
    startY: number,
    dir: Direction,
    isCharging: boolean,
    progress: number
  ): void {
    const dx = dir === 'east' ? 1 : dir === 'west' ? -1 : 0;
    const dy = dir === 'south' ? 1 : dir === 'north' ? -1 : 0;

    let endX = startX;
    let endY = startY;
    let cx = startX + dx;
    let cy = startY + dy;

    while (
      cx >= 0 &&
      cx < this.GRID_SIZE &&
      cy >= 0 &&
      cy < this.GRID_SIZE
    ) {
      endX = cx;
      endY = cy;
      if (this.walls.some((w) => w.x === cx && w.y === cy)) {
        break;
      }
      cx += dx;
      cy += dy;
    }

    const sx = this.offsetX + startX * this.cellSize + this.cellSize / 2;
    const sy = this.offsetY + startY * this.cellSize + this.cellSize / 2;
    const ex = this.offsetX + endX * this.cellSize + this.cellSize / 2;
    const ey = this.offsetY + endY * this.cellSize + this.cellSize / 2;

    // Highlight threatened cells along trajectory
    let tx = startX + dx;
    let ty = startY + dy;
    while (
      tx >= 0 &&
      tx < this.GRID_SIZE &&
      ty >= 0 &&
      ty < this.GRID_SIZE
    ) {
      if (this.walls.some((w) => w.x === tx && w.y === ty)) break;
      const cellX = this.offsetX + tx * this.cellSize;
      const cellY = this.offsetY + ty * this.cellSize;

      // Cell threat wash
      this.warningGraphics.fillStyle(
        0xef4444,
        isCharging ? 0.16 + progress * 0.22 : 0.08
      );
      this.warningGraphics.fillRect(
        cellX + 2,
        cellY + 2,
        this.cellSize - 4,
        this.cellSize - 4
      );

      // Threat borders along beam path
      this.warningGraphics.lineStyle(
        1,
        0xf87171,
        isCharging ? 0.4 + progress * 0.45 : 0.25
      );
      this.warningGraphics.strokeRect(
        cellX + 2,
        cellY + 2,
        this.cellSize - 4,
        this.cellSize - 4
      );

      tx += dx;
      ty += dy;
    }

    // Warning laser sight line
    const lineThickness = isCharging
      ? Math.max(2, 2 + progress * (this.cellSize * 0.2))
      : 1.5;
    const lineAlpha = isCharging ? 0.7 + progress * 0.3 : 0.5;

    // Outer warning glow line
    this.warningGraphics.lineStyle(
      lineThickness * 2.2,
      0xef4444,
      isCharging ? 0.3 + progress * 0.3 : 0.18
    );
    this.warningGraphics.beginPath();
    this.warningGraphics.moveTo(sx, sy);
    this.warningGraphics.lineTo(ex, ey);
    this.warningGraphics.strokePath();

    // Central bright red aim line
    this.warningGraphics.lineStyle(lineThickness, 0xf87171, lineAlpha);
    this.warningGraphics.beginPath();
    this.warningGraphics.moveTo(sx, sy);
    this.warningGraphics.lineTo(ex, ey);
    this.warningGraphics.strokePath();

    if (isCharging) {
      this.warningGraphics.lineStyle(
        Math.max(1, lineThickness * 0.4),
        0xfef08a,
        progress * 0.95
      );
      this.warningGraphics.beginPath();
      this.warningGraphics.moveTo(sx, sy);
      this.warningGraphics.lineTo(ex, ey);
      this.warningGraphics.strokePath();

      // Charging muzzle orb
      this.warningGraphics.fillStyle(0xef4444, 0.9);
      this.warningGraphics.fillCircle(
        sx + dx * (this.cellSize * 0.35),
        sy + dy * (this.cellSize * 0.35),
        this.cellSize * (0.12 + progress * 0.18)
      );
      this.warningGraphics.fillStyle(0xfef08a, 0.95);
      this.warningGraphics.fillCircle(
        sx + dx * (this.cellSize * 0.35),
        sy + dy * (this.cellSize * 0.35),
        this.cellSize * (0.05 + progress * 0.08)
      );
    }
  }

  public resetArena(snapshot: GameStateSnapshot): void {
    for (const [, bombVis] of this.activeBombs) {
      bombVis.container.destroy();
    }
    this.activeBombs.clear();
    this.scorchMarks = [];

    if (this.decalGraphics) this.decalGraphics.clear();
    if (this.warningGraphics) this.warningGraphics.clear();
    if (this.fxGraphics) this.fxGraphics.clear();

    if (this.player) {
      this.player.resetTo(
        snapshot.player.x,
        snapshot.player.y,
        snapshot.player.facing,
        snapshot.player.health,
        this.cellSize,
        this.offsetX,
        this.offsetY
      );
    }

    for (const enemyState of snapshot.enemies) {
      const enemyObj = this.enemies.get(enemyState.id);
      if (enemyObj) {
        enemyObj.resetTo(
          enemyState.x,
          enemyState.y,
          enemyState.facing,
          enemyState.aiState,
          enemyState.health,
          enemyState.maxHealth,
          enemyState.alive,
          this.cellSize,
          this.offsetX,
          this.offsetY
        );
      }
    }

    this.highlightActiveCoordinates();
  }

  public async animatePlayerMove(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    facing: Direction
  ): Promise<void> {
    if (!this.player) return;

    const trail = this.add.graphics().setDepth(4);
    const tx = this.offsetX + fromX * this.cellSize;
    const ty = this.offsetY + fromY * this.cellSize;
    trail.fillStyle(0x38bdf8, 0.22);
    trail.fillRoundedRect(
      tx + 4,
      ty + 4,
      this.cellSize - 8,
      this.cellSize - 8,
      4
    );
    trail.lineStyle(1, 0x38bdf8, 0.5);
    trail.strokeRoundedRect(
      tx + 4,
      ty + 4,
      this.cellSize - 8,
      this.cellSize - 8,
      4
    );

    this.tweens.add({
      targets: trail,
      alpha: 0,
      duration: 500,
      ease: 'Sine.easeOut',
      onComplete: () => trail.destroy(),
    });

    await this.player.moveTo(
      toX,
      toY,
      facing,
      this.cellSize,
      this.offsetX,
      this.offsetY
    );
    this.highlightActiveCoordinates();
  }

  public animatePlayerDamaged(
    damage: number,
    remainingHealth: number,
    knockbackTo?: GridPosition,
    defeated?: boolean
  ): void {
    if (!this.player) return;
    this.player.takeDamage(
      damage,
      remainingHealth,
      knockbackTo,
      Boolean(defeated),
      this.cellSize,
      this.offsetX,
      this.offsetY
    );
    this.highlightActiveCoordinates();
  }

  public animateEnemyMove(
    enemyId: string,
    toX: number,
    toY: number,
    facing: Direction
  ): void {
    const enemyObj = this.enemies.get(enemyId);
    if (!enemyObj || !enemyObj.alive) return;
    enemyObj.moveTo(
      toX,
      toY,
      facing,
      this.cellSize,
      this.offsetX,
      this.offsetY
    );
  }

  public animateChaserAttack(
    enemyId: string,
    targetX: number,
    targetY: number
  ): void {
    const enemyObj = this.enemies.get(enemyId);
    if (!enemyObj || !enemyObj.alive) return;
    enemyObj.animateMeleeStrike(
      targetX,
      targetY,
      this.cellSize,
      this.offsetX,
      this.offsetY
    );

    // Crimson slash shockwave at target cell
    const slash = this.add.graphics().setDepth(33);

    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 240,
      ease: 'Cubic.easeOut',
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        const tx = this.offsetX + targetX * this.cellSize + this.cellSize / 2;
        const ty = this.offsetY + targetY * this.cellSize + this.cellSize / 2;
        slash.clear();
        slash.lineStyle(3 * (1 - t), 0xf43f5e, 1 - t);
        slash.strokeCircle(tx, ty, this.cellSize * (0.25 + 0.45 * t));
      },
      onComplete: () => slash.destroy(),
    });
  }

  public animateEnemyLaser(
    _enemyId: string,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    hitPlayer: boolean
  ): void {
    const beam = this.add.graphics().setDepth(34);

    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 300,
      ease: 'Sine.easeOut',
      onUpdate: (tween) => {
        const t = tween.getValue() ?? 0;
        const alpha = 1 - t;
        const sx = this.offsetX + startX * this.cellSize + this.cellSize / 2;
        const sy = this.offsetY + startY * this.cellSize + this.cellSize / 2;
        const ex = this.offsetX + endX * this.cellSize + this.cellSize / 2;
        const ey = this.offsetY + endY * this.cellSize + this.cellSize / 2;
        beam.clear();

        // Outer crimson plasma glow
        beam.lineStyle(
          this.cellSize * 0.36 * (1 - t * 0.4),
          0xef4444,
          alpha * 0.5
        );
        beam.beginPath();
        beam.moveTo(sx, sy);
        beam.lineTo(ex, ey);
        beam.strokePath();

        // Mid intense red beam
        beam.lineStyle(
          this.cellSize * 0.16 * (1 - t * 0.3),
          0xf87171,
          alpha * 0.9
        );
        beam.beginPath();
        beam.moveTo(sx, sy);
        beam.lineTo(ex, ey);
        beam.strokePath();

        // White-hot core
        beam.lineStyle(Math.max(2, this.cellSize * 0.06), 0xfef2f2, alpha);
        beam.beginPath();
        beam.moveTo(sx, sy);
        beam.lineTo(ex, ey);
        beam.strokePath();

        beam.fillStyle(hitPlayer ? 0xfbbf24 : 0xef4444, alpha);
        beam.fillCircle(
          ex,
          ey,
          this.cellSize * (hitPlayer ? 0.38 : 0.22) * (0.6 + t * 0.5)
        );
      },
      onComplete: () => beam.destroy(),
    });
  }

  public async animateBlockedMove(
    x: number,
    y: number,
    attemptedX: number,
    attemptedY: number,
    facing: Direction,
    reason: 'boundary' | 'wall'
  ): Promise<void> {
    if (!this.player) return;

    const warn = this.add.graphics().setDepth(28);
    if (reason === 'wall') {
      const wx = this.offsetX + attemptedX * this.cellSize;
      const wy = this.offsetY + attemptedY * this.cellSize;
      warn.lineStyle(2.5, 0xf59e0b, 0.95);
      warn.fillStyle(0xf59e0b, 0.3);
      warn.fillRoundedRect(
        wx + 2,
        wy + 2,
        this.cellSize - 4,
        this.cellSize - 4,
        4
      );
      warn.strokeRoundedRect(
        wx + 2,
        wy + 2,
        this.cellSize - 4,
        this.cellSize - 4,
        4
      );
    } else {
      const cx = this.offsetX + x * this.cellSize;
      const cy = this.offsetY + y * this.cellSize;
      warn.lineStyle(3, 0xef4444, 0.95);
      if (facing === 'east') {
        warn.strokeLineShape(
          new Phaser.Geom.Line(
            cx + this.cellSize,
            cy - 4,
            cx + this.cellSize,
            cy + this.cellSize + 4
          )
        );
      } else if (facing === 'west') {
        warn.strokeLineShape(
          new Phaser.Geom.Line(cx, cy - 4, cx, cy + this.cellSize + 4)
        );
      } else if (facing === 'north') {
        warn.strokeLineShape(
          new Phaser.Geom.Line(cx - 4, cy, cx + this.cellSize + 4, cy)
        );
      } else {
        warn.strokeLineShape(
          new Phaser.Geom.Line(
            cx - 4,
            cy + this.cellSize,
            cx + this.cellSize + 4,
            cy + this.cellSize
          )
        );
      }
    }

    this.tweens.add({
      targets: warn,
      alpha: 0,
      duration: 320,
      onComplete: () => warn.destroy(),
    });

    await this.player.animateBlocked(facing, this.cellSize);
  }

  public async animateLaser(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    facing: Direction,
    hitEnemyId?: string,
    damage?: number,
    destroyed?: boolean
  ): Promise<void> {
    if (this.player) {
      this.player.setFacing(facing, true);
    }

    const dx = facing === 'east' ? 1 : facing === 'west' ? -1 : 0;
    const dy = facing === 'south' ? 1 : facing === 'north' ? -1 : 0;
    const beam = this.add.graphics().setDepth(32);

    if (hitEnemyId && damage !== undefined) {
      const enemyObj = this.enemies.get(hitEnemyId);
      if (enemyObj) {
        const nextHp = Math.max(0, enemyObj.health - damage);
        enemyObj.takeDamage(damage, nextHp, Boolean(destroyed));
        if (destroyed) {
          this.scorchMarks.push({ x: endX, y: endY });
          this.drawDecals();
        }
      }
    }

    return new Promise((resolve) => {
      this.tweens.addCounter({
        from: 0,
        to: 1,
        duration: 280,
        ease: 'Sine.easeOut',
        onUpdate: (tween) => {
          const t = tween.getValue() ?? 0;
          const alpha = 1 - t;
          const startPixelX =
            this.offsetX +
            startX * this.cellSize +
            this.cellSize / 2 +
            dx * (this.cellSize * 0.38);
          const startPixelY =
            this.offsetY +
            startY * this.cellSize +
            this.cellSize / 2 +
            dy * (this.cellSize * 0.38);
          const endPixelX =
            this.offsetX + endX * this.cellSize + this.cellSize / 2;
          const endPixelY =
            this.offsetY + endY * this.cellSize + this.cellSize / 2;

          beam.clear();

          beam.lineStyle(
            this.cellSize * 0.34 * (1 - t * 0.4),
            0x0ea5e9,
            alpha * 0.45
          );
          beam.beginPath();
          beam.moveTo(startPixelX, startPixelY);
          beam.lineTo(endPixelX, endPixelY);
          beam.strokePath();

          beam.lineStyle(
            this.cellSize * 0.16 * (1 - t * 0.3),
            0x38bdf8,
            alpha * 0.85
          );
          beam.beginPath();
          beam.moveTo(startPixelX, startPixelY);
          beam.lineTo(endPixelX, endPixelY);
          beam.strokePath();

          beam.lineStyle(Math.max(2, this.cellSize * 0.06), 0xe0f2fe, alpha);
          beam.beginPath();
          beam.moveTo(startPixelX, startPixelY);
          beam.lineTo(endPixelX, endPixelY);
          beam.strokePath();

          beam.fillStyle(0x7dd3fc, alpha * 0.9);
          beam.fillCircle(
            startPixelX,
            startPixelY,
            this.cellSize * 0.2 * (1 - t * 0.5)
          );

          beam.fillStyle(hitEnemyId ? 0xfbbf24 : 0x38bdf8, alpha);
          beam.fillCircle(
            endPixelX,
            endPixelY,
            this.cellSize * (hitEnemyId ? 0.36 : 0.22) * (0.6 + t * 0.6)
          );
        },
        onComplete: () => {
          beam.destroy();
          resolve();
        },
      });
    });
  }

  public async animateShockwave(
    centerX: number,
    centerY: number,
    radiusCells: number,
    hitResults: Array<{
      enemyId: string;
      damage: number;
      destroyed: boolean;
      remainingHealth: number;
    }>
  ): Promise<void> {
    // Apply damage popups and impact flashes on affected enemies
    for (const hit of hitResults) {
      const enemyObj = this.enemies.get(hit.enemyId);
      if (enemyObj) {
        enemyObj.takeDamage(hit.damage, hit.remainingHealth, hit.destroyed);
        if (hit.destroyed) {
          this.scorchMarks.push({
            x: enemyObj.gridPos.x,
            y: enemyObj.gridPos.y,
          });
          this.drawDecals();
        }
      }
    }

    const pulseGfx = this.add.graphics().setDepth(33);
    this.cameras.main.shake(140, 0.0025);

    return new Promise((resolve) => {
      this.tweens.addCounter({
        from: 0,
        to: 1,
        duration: 420,
        ease: 'Cubic.easeOut',
        onUpdate: (tween) => {
          const t = tween.getValue() ?? 0;
          const alpha = 1 - t;
          const cx =
            this.offsetX + centerX * this.cellSize + this.cellSize / 2;
          const cy =
            this.offsetY + centerY * this.cellSize + this.cellSize / 2;
          const maxPixelR = (radiusCells + 0.35) * this.cellSize;
          const currentR =
            this.cellSize * 0.3 + (maxPixelR - this.cellSize * 0.3) * t;

          pulseGfx.clear();

          // Soft circular energy field fill
          pulseGfx.fillStyle(0x38bdf8, alpha * 0.16);
          pulseGfx.fillCircle(cx, cy, currentR);

          // Secondary inner harmonic wave
          if (t > 0.15) {
            const innerR = currentR * 0.68;
            pulseGfx.lineStyle(Math.max(1.5, 2.5 * alpha), 0x7dd3fc, alpha * 0.65);
            pulseGfx.strokeCircle(cx, cy, innerR);
          }

          // Primary expanding shockwave ring
          pulseGfx.lineStyle(Math.max(2, 4.5 * alpha), 0x38bdf8, alpha * 0.95);
          pulseGfx.strokeCircle(cx, cy, currentR);

          // Bright white-cyan leading edge
          pulseGfx.lineStyle(Math.max(1, 2 * alpha), 0xe0f2fe, alpha);
          pulseGfx.strokeCircle(cx, cy, currentR);

          // Impact rings on hit enemies
          for (const hit of hitResults) {
            const enemyObj = this.enemies.get(hit.enemyId);
            if (enemyObj) {
              const ex =
                this.offsetX +
                enemyObj.gridPos.x * this.cellSize +
                this.cellSize / 2;
              const ey =
                this.offsetY +
                enemyObj.gridPos.y * this.cellSize +
                this.cellSize / 2;
              pulseGfx.lineStyle(2.5 * alpha, 0xfbbf24, alpha * 0.9);
              pulseGfx.strokeCircle(
                ex,
                ey,
                this.cellSize * (0.28 + 0.42 * t)
              );
            }
          }
        },
        onComplete: () => {
          pulseGfx.destroy();
          resolve();
        },
      });
    });
  }

  public spawnBombVisual(bomb: BombState): void {
    const pixelX = this.offsetX + bomb.x * this.cellSize + this.cellSize / 2;
    const pixelY = this.offsetY + bomb.y * this.cellSize + this.cellSize / 2;

    const bombGfx = this.add.graphics();
    const countText = this.add
      .text(0, 0, String(bomb.countdown), {
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: `${Math.max(10, Math.floor(this.cellSize * 0.34))}px`,
        fontStyle: 'bold',
        color: '#fef08a',
      })
      .setOrigin(0.5, 0.5);

    const container = this.add
      .container(pixelX, pixelY, [bombGfx, countText])
      .setDepth(15);

    const vis: ActiveBombVisual = {
      container,
      bombGfx,
      countText,
      owner: bomb.owner,
      x: bomb.x,
      y: bomb.y,
      blastRadius: bomb.blastRadius,
      countdown: bomb.countdown,
    };

    this.activeBombs.set(bomb.id, vis);
    this.drawBombGraphic(vis);

    this.tweens.add({
      targets: countText,
      scaleX: { from: 1.18, to: 0.92 },
      scaleY: { from: 1.18, to: 0.92 },
      duration: 320,
      yoyo: true,
      repeat: -1,
    });
  }

  public updateBombCountdownVisual(bombId: string, countdown: number): void {
    const vis = this.activeBombs.get(bombId);
    if (!vis) return;
    vis.countdown = countdown;
    vis.countText.setText(String(countdown));
    vis.countText.setColor(countdown <= 1 ? '#f87171' : '#fb923c');
    this.drawBombGraphic(vis);
  }

  private drawBombGraphic(vis: ActiveBombVisual): void {
    const { bombGfx, countText, blastRadius, countdown, owner } = vis;
    bombGfx.clear();
    countText.setFontSize(Math.max(10, Math.floor(this.cellSize * 0.34)));

    const r = this.cellSize * 0.32;
    const spanCells = blastRadius * 2 + 1;
    const spanPx = spanCells * this.cellSize;
    const isEnemyBomb = owner !== 'player';
    const primaryColor = isEnemyBomb ? 0xef4444 : 0xf59e0b;

    // Blast radius warning perimeter (3x3 area)
    bombGfx.lineStyle(
      countdown <= 1 ? 1.8 : 1.2,
      primaryColor,
      countdown <= 1 ? 0.65 : 0.38
    );
    bombGfx.fillStyle(primaryColor, countdown <= 1 ? 0.14 : 0.08);
    bombGfx.fillRect(-spanPx / 2, -spanPx / 2, spanPx, spanPx);
    bombGfx.strokeRect(-spanPx / 2, -spanPx / 2, spanPx, spanPx);

    // Outer pulsing ring
    const pulseScale = countdown === 3 ? 1.1 : countdown === 2 ? 1.24 : 1.38;
    bombGfx.lineStyle(1.5, 0xef4444, 0.9);
    bombGfx.strokeCircle(0, 0, r * pulseScale);

    // Mine casing
    bombGfx.fillStyle(0x1e293b, 1);
    bombGfx.lineStyle(1.5, primaryColor, 1);
    bombGfx.fillCircle(0, 0, r * 0.82);
    bombGfx.strokeCircle(0, 0, r * 0.82);

    bombGfx.fillStyle(isEnemyBomb ? 0xb91c1c : 0xd97706, 0.9);
    bombGfx.fillCircle(0, 0, r * 0.52);
  }

  public animateBombExplosion(
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
  ): void {
    const bombVis = this.activeBombs.get(bombId);
    if (bombVis) {
      bombVis.container.destroy();
      this.activeBombs.delete(bombId);
    }

    this.scorchMarks.push({ x, y });
    this.drawDecals();

    for (const hit of hitResults) {
      const enemyObj = this.enemies.get(hit.enemyId);
      if (enemyObj) {
        enemyObj.takeDamage(hit.damage, hit.remainingHealth, hit.destroyed);
        if (hit.destroyed) {
          this.scorchMarks.push({
            x: enemyObj.gridPos.x,
            y: enemyObj.gridPos.y,
          });
          this.drawDecals();
        }
      }
    }

    const blastGfx = this.add.graphics().setDepth(34);

    this.cameras.main.shake(180, 0.004);

    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 460,
      ease: 'Cubic.easeOut',
      onUpdate: (tween) => {
        const t = tween.getValue() ?? 0;
        const alpha = 1 - t;
        const centerX = this.offsetX + x * this.cellSize + this.cellSize / 2;
        const centerY = this.offsetY + y * this.cellSize + this.cellSize / 2;
        const maxRadius = this.cellSize * (blastRadius + 0.55);
        const r =
          this.cellSize * 0.25 + (maxRadius - this.cellSize * 0.25) * t;

        blastGfx.clear();
        blastGfx.lineStyle(3.5 * alpha, 0xf97316, alpha);
        blastGfx.strokeCircle(centerX, centerY, r);

        blastGfx.fillStyle(0xef4444, alpha * 0.42);
        blastGfx.fillCircle(centerX, centerY, r * 0.85);

        blastGfx.fillStyle(0xfef08a, alpha * 0.75);
        blastGfx.fillCircle(centerX, centerY, r * 0.45 * (1 - t * 0.5));
      },
      onComplete: () => blastGfx.destroy(),
    });
  }

  private calculateMetrics(width: number, height: number): void {
    const minDim = Math.min(width, height);
    // In normal 3-panel mode, reserve comfortable dashboard padding;
    // In maximized/fullscreen mode, use tight padding so the 15x15 grid expands to fill available space
    const padding = this.isMaximizedMode
      ? Math.max(20, Math.min(26, Math.floor(minDim * 0.028)))
      : Math.max(30, Math.min(48, Math.floor(minDim * 0.068)));

    const availableW = Math.max(180, width - padding * 2);
    const availableH = Math.max(180, height - padding * 2);

    const rawCellSize = Math.min(availableW, availableH) / this.GRID_SIZE;
    this.cellSize = Math.max(12, Math.floor(rawCellSize * 2) / 2);

    const totalBoardSize = this.cellSize * this.GRID_SIZE;
    this.offsetX = Math.round((width - totalBoardSize) / 2);
    this.offsetY = Math.round((height - totalBoardSize) / 2);
  }

  private createCoordinateLabels(): void {
    this.xCoordLabels.forEach((l) => l.destroy());
    this.yCoordLabels.forEach((l) => l.destroy());
    this.xCoordLabels = [];
    this.yCoordLabels = [];

    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: '10px',
      color: '#64748b',
    };

    for (let i = 0; i < this.GRID_SIZE; i++) {
      const xLbl = this.add
        .text(0, 0, i.toString().padStart(2, '0'), style)
        .setOrigin(0.5, 1)
        .setDepth(15);
      const yLbl = this.add
        .text(0, 0, i.toString().padStart(2, '0'), style)
        .setOrigin(1, 0.5)
        .setDepth(15);

      this.xCoordLabels.push(xLbl);
      this.yCoordLabels.push(yLbl);
    }

    this.positionCoordinateLabels();
  }

  private positionCoordinateLabels(): void {
    const fontSize = Math.max(
      8,
      Math.min(14, Math.floor(this.cellSize * 0.25))
    );
    const topGap = Math.max(6, Math.min(11, Math.floor(this.cellSize * 0.2)));
    const leftGap = Math.max(8, Math.min(13, Math.floor(this.cellSize * 0.22)));

    for (let i = 0; i < this.GRID_SIZE; i++) {
      const xLabel = this.xCoordLabels[i];
      const yLabel = this.yCoordLabels[i];

      if (xLabel && yLabel) {
        xLabel.setFontSize(fontSize);
        yLabel.setFontSize(fontSize);

        xLabel.setPosition(
          this.offsetX + i * this.cellSize + this.cellSize / 2,
          this.offsetY - topGap
        );
        yLabel.setPosition(
          this.offsetX - leftGap,
          this.offsetY + i * this.cellSize + this.cellSize / 2
        );
      }
    }
  }

  private highlightActiveCoordinates(): void {
    const px = this.player ? this.player.gridPos.x : -1;
    const py = this.player ? this.player.gridPos.y : -1;
    const hx = this.hoveredCell ? this.hoveredCell.x : -1;
    const hy = this.hoveredCell ? this.hoveredCell.y : -1;

    for (let i = 0; i < this.GRID_SIZE; i++) {
      const xLbl = this.xCoordLabels[i];
      const yLbl = this.yCoordLabels[i];
      if (xLbl) {
        if (i === hx || i === px) {
          xLbl.setColor(i === px ? '#38bdf8' : '#94a3b8');
          xLbl.setFontStyle('bold');
        } else {
          xLbl.setColor('#475569');
          xLbl.setFontStyle('normal');
        }
      }
      if (yLbl) {
        if (i === hy || i === py) {
          yLbl.setColor(i === py ? '#38bdf8' : '#94a3b8');
          yLbl.setFontStyle('bold');
        } else {
          yLbl.setColor('#475569');
          yLbl.setFontStyle('normal');
        }
      }
    }
  }

  private drawArenaEnvironment(): void {
    this.bgGraphics.clear();

    const boardSize = this.cellSize * this.GRID_SIZE;
    const framePad = Math.max(6, Math.floor(this.cellSize * 0.16));

    this.bgGraphics.fillStyle(0x050811, 1);
    this.bgGraphics.fillRoundedRect(
      this.offsetX - framePad * 1.6,
      this.offsetY - framePad * 1.6,
      boardSize + framePad * 3.2,
      boardSize + framePad * 3.2,
      8
    );

    this.bgGraphics.lineStyle(1.5, 0x1e293b, 0.9);
    this.bgGraphics.strokeRoundedRect(
      this.offsetX - framePad * 1.6,
      this.offsetY - framePad * 1.6,
      boardSize + framePad * 3.2,
      boardSize + framePad * 3.2,
      8
    );

    this.bgGraphics.fillStyle(0x090e1a, 1);
    this.bgGraphics.fillRect(this.offsetX, this.offsetY, boardSize, boardSize);

    const tileInset = Math.max(1.5, this.cellSize * 0.06);
    for (let row = 0; row < this.GRID_SIZE; row++) {
      for (let col = 0; col < this.GRID_SIZE; col++) {
        const x = this.offsetX + col * this.cellSize;
        const y = this.offsetY + row * this.cellSize;

        const isAlt = (row + col) % 2 === 0;
        this.bgGraphics.fillStyle(isAlt ? 0x0d1526 : 0x0a101d, 0.92);
        this.bgGraphics.fillRect(
          x + tileInset,
          y + tileInset,
          this.cellSize - tileInset * 2,
          this.cellSize - tileInset * 2
        );

        if (
          row === 0 ||
          row === this.GRID_SIZE - 1 ||
          col === 0 ||
          col === this.GRID_SIZE - 1
        ) {
          this.bgGraphics.fillStyle(0x1e293b, 0.85);
          this.bgGraphics.fillRect(
            x + 3,
            y + 3,
            this.cellSize - 6,
            this.cellSize - 6
          );
          this.bgGraphics.fillStyle(0x0b1220, 1);
          this.bgGraphics.fillRect(
            x + 5,
            y + 5,
            this.cellSize - 10,
            this.cellSize - 10
          );
        }
      }
    }

    const centerPixelX = this.offsetX + 7.5 * this.cellSize;
    const centerPixelY = this.offsetY + 7.5 * this.cellSize;

    this.bgGraphics.lineStyle(1.5, 0x0ea5e9, 0.16);
    this.bgGraphics.strokeCircle(
      centerPixelX,
      centerPixelY,
      this.cellSize * 3.2
    );
    this.bgGraphics.lineStyle(1, 0x38bdf8, 0.12);
    this.bgGraphics.strokeCircle(
      centerPixelX,
      centerPixelY,
      this.cellSize * 2.1
    );
    this.bgGraphics.fillStyle(0x0ea5e9, 0.03);
    this.bgGraphics.fillCircle(centerPixelX, centerPixelY, this.cellSize * 2.1);

    const rOuter = this.cellSize * 3.45;
    const rInner = this.cellSize * 2.85;
    this.bgGraphics.lineStyle(1.5, 0x0ea5e9, 0.22);
    this.bgGraphics.beginPath();
    this.bgGraphics.moveTo(centerPixelX - rOuter, centerPixelY);
    this.bgGraphics.lineTo(centerPixelX - rInner, centerPixelY);
    this.bgGraphics.moveTo(centerPixelX + rInner, centerPixelY);
    this.bgGraphics.lineTo(centerPixelX + rOuter, centerPixelY);
    this.bgGraphics.moveTo(centerPixelX, centerPixelY - rOuter);
    this.bgGraphics.lineTo(centerPixelX, centerPixelY - rInner);
    this.bgGraphics.moveTo(centerPixelX, centerPixelY + rInner);
    this.bgGraphics.lineTo(centerPixelX, centerPixelY + rOuter);
    this.bgGraphics.strokePath();

    this.bgGraphics.lineStyle(1, 0x1e293b, 0.55);
    this.bgGraphics.beginPath();
    for (let i = 0; i <= this.GRID_SIZE; i++) {
      const posX = this.offsetX + i * this.cellSize;
      const posY = this.offsetY + i * this.cellSize;

      this.bgGraphics.moveTo(posX, this.offsetY);
      this.bgGraphics.lineTo(posX, this.offsetY + boardSize);

      this.bgGraphics.moveTo(this.offsetX, posY);
      this.bgGraphics.lineTo(this.offsetX + boardSize, posY);
    }
    this.bgGraphics.strokePath();

    this.bgGraphics.lineStyle(1, 0x0ea5e9, 0.26);
    this.bgGraphics.beginPath();
    for (let i = 5; i < this.GRID_SIZE; i += 5) {
      const posX = this.offsetX + i * this.cellSize;
      const posY = this.offsetY + i * this.cellSize;

      this.bgGraphics.moveTo(posX, this.offsetY);
      this.bgGraphics.lineTo(posX, this.offsetY + boardSize);

      this.bgGraphics.moveTo(this.offsetX, posY);
      this.bgGraphics.lineTo(this.offsetX + boardSize, posY);
    }
    this.bgGraphics.strokePath();

    for (let r = 5; r < this.GRID_SIZE; r += 5) {
      for (let c = 5; c < this.GRID_SIZE; c += 5) {
        const nx = this.offsetX + c * this.cellSize;
        const ny = this.offsetY + r * this.cellSize;
        this.bgGraphics.fillStyle(0x38bdf8, 0.55);
        this.bgGraphics.fillCircle(nx, ny, 2.2);
      }
    }

    this.bgGraphics.lineStyle(2, 0x0284c7, 0.85);
    this.bgGraphics.strokeRect(this.offsetX, this.offsetY, boardSize, boardSize);

    const bracketLen = Math.max(14, this.cellSize * 0.65);
    const pad = 5;
    this.bgGraphics.lineStyle(2.5, 0x38bdf8, 0.95);
    this.bgGraphics.beginPath();

    this.bgGraphics.moveTo(this.offsetX - pad, this.offsetY - pad + bracketLen);
    this.bgGraphics.lineTo(this.offsetX - pad, this.offsetY - pad);
    this.bgGraphics.lineTo(this.offsetX - pad + bracketLen, this.offsetY - pad);

    this.bgGraphics.moveTo(
      this.offsetX + boardSize + pad - bracketLen,
      this.offsetY - pad
    );
    this.bgGraphics.lineTo(this.offsetX + boardSize + pad, this.offsetY - pad);
    this.bgGraphics.lineTo(
      this.offsetX + boardSize + pad,
      this.offsetY - pad + bracketLen
    );

    this.bgGraphics.moveTo(
      this.offsetX - pad,
      this.offsetY + boardSize + pad - bracketLen
    );
    this.bgGraphics.lineTo(this.offsetX - pad, this.offsetY + boardSize + pad);
    this.bgGraphics.lineTo(
      this.offsetX - pad + bracketLen,
      this.offsetY + boardSize + pad
    );

    this.bgGraphics.moveTo(
      this.offsetX + boardSize + pad - bracketLen,
      this.offsetY + boardSize + pad
    );
    this.bgGraphics.lineTo(
      this.offsetX + boardSize + pad,
      this.offsetY + boardSize + pad
    );
    this.bgGraphics.lineTo(
      this.offsetX + boardSize + pad,
      this.offsetY + boardSize + pad - bracketLen
    );
    this.bgGraphics.strokePath();

    const corners = [
      { x: this.offsetX - pad, y: this.offsetY - pad },
      { x: this.offsetX + boardSize + pad, y: this.offsetY - pad },
      { x: this.offsetX - pad, y: this.offsetY + boardSize + pad },
      { x: this.offsetX + boardSize + pad, y: this.offsetY + boardSize + pad },
    ];
    for (const pt of corners) {
      this.bgGraphics.fillStyle(0x38bdf8, 1);
      this.bgGraphics.fillCircle(pt.x, pt.y, 3);
    }
  }

  private drawWalls(): void {
    if (!this.wallGraphics) return;
    this.wallGraphics.clear();

    for (const wall of this.walls) {
      const wx = this.offsetX + wall.x * this.cellSize;
      const wy = this.offsetY + wall.y * this.cellSize;
      const pad = Math.max(2, this.cellSize * 0.08);
      const w = this.cellSize - pad * 2;
      const h = this.cellSize - pad * 2;

      this.wallGraphics.fillStyle(0x020617, 0.85);
      this.wallGraphics.fillRoundedRect(wx + pad + 2, wy + pad + 2, w, h, 4);

      this.wallGraphics.fillStyle(0x1e293b, 1);
      this.wallGraphics.lineStyle(1.5, 0x475569, 1);
      this.wallGraphics.fillRoundedRect(wx + pad, wy + pad, w, h, 4);
      this.wallGraphics.strokeRoundedRect(wx + pad, wy + pad, w, h, 4);

      const innerPad = pad + this.cellSize * 0.14;
      const iw = this.cellSize - innerPad * 2;
      const ih = this.cellSize - innerPad * 2;
      this.wallGraphics.fillStyle(0x0f172a, 1);
      this.wallGraphics.lineStyle(1, 0x0ea5e9, 0.65);
      this.wallGraphics.fillRoundedRect(
        wx + innerPad,
        wy + innerPad,
        iw,
        ih,
        2
      );
      this.wallGraphics.strokeRoundedRect(
        wx + innerPad,
        wy + innerPad,
        iw,
        ih,
        2
      );

      this.wallGraphics.fillStyle(0x38bdf8, 0.75);
      this.wallGraphics.fillCircle(
        wx + this.cellSize / 2,
        wy + this.cellSize / 2,
        this.cellSize * 0.09
      );
    }
  }

  private drawDecals(): void {
    if (!this.decalGraphics) return;
    this.decalGraphics.clear();

    for (const mark of this.scorchMarks) {
      const cx = this.offsetX + mark.x * this.cellSize + this.cellSize / 2;
      const cy = this.offsetY + mark.y * this.cellSize + this.cellSize / 2;
      this.decalGraphics.fillStyle(0x020617, 0.75);
      this.decalGraphics.fillCircle(cx, cy, this.cellSize * 0.36);
      this.decalGraphics.lineStyle(1, 0x334155, 0.45);
      this.decalGraphics.strokeCircle(cx, cy, this.cellSize * 0.38);
    }
  }

  private drawHoverReticle(): void {
    this.hoverGraphics.clear();
    if (!this.hoveredCell) return;

    const x = this.offsetX + this.hoveredCell.x * this.cellSize;
    const y = this.offsetY + this.hoveredCell.y * this.cellSize;

    this.hoverGraphics.fillStyle(0x38bdf8, 0.09);
    this.hoverGraphics.fillRect(
      x + 1,
      y + 1,
      this.cellSize - 2,
      this.cellSize - 2
    );

    this.hoverGraphics.lineStyle(1.2, 0x38bdf8, 0.75);
    this.hoverGraphics.strokeRect(
      x + 1,
      y + 1,
      this.cellSize - 2,
      this.cellSize - 2
    );
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    if (!gameSize || gameSize.width <= 0 || gameSize.height <= 0) return;

    if (this.cameras && this.cameras.main) {
      this.cameras.main.setViewport(0, 0, gameSize.width, gameSize.height);
      this.cameras.main.setSize(gameSize.width, gameSize.height);
      this.cameras.main.setZoom(1);
    }

    this.calculateMetrics(gameSize.width, gameSize.height);
    this.positionCoordinateLabels();
    this.drawArenaEnvironment();
    this.drawWalls();
    this.drawDecals();
    this.drawHoverReticle();
    this.highlightActiveCoordinates();

    if (this.player) {
      this.player.updateLayout(this.cellSize, this.offsetX, this.offsetY);
    }
    if (this.player2) {
      this.player2.updateLayout(this.cellSize, this.offsetX, this.offsetY);
    }
    this.enemies.forEach((enemy) => {
      enemy.updateLayout(this.cellSize, this.offsetX, this.offsetY);
    });
    this.activeBombs.forEach((bombVis) => {
      const px = this.offsetX + bombVis.x * this.cellSize + this.cellSize / 2;
      const py = this.offsetY + bombVis.y * this.cellSize + this.cellSize / 2;
      bombVis.container.setPosition(px, py);
      this.drawBombGraphic(bombVis);
    });
  }

  // ===========================================================================
  // LOCAL HOT-SEAT PvP VIEW IMPLEMENTATION
  // ===========================================================================
  private getPvPRobot(playerId: PvPPlayerId): Player | null {
    return playerId === 'P1' ? this.player : this.player2;
  }

  public initPvPArena(snapshot: PvPBattleSnapshot): void {
    if (!this.scene || !this.bgGraphics) return;

    // Hide all single-player AI enemies
    this.enemies.forEach((enemy) => {
      enemy.resetTo(
        enemy.gridPos.x,
        enemy.gridPos.y,
        enemy.facing,
        'DEFEATED',
        0,
        enemy.maxHealth,
        false,
        this.cellSize,
        this.offsetX,
        this.offsetY
      );
    });

    for (const [, bombVis] of this.activeBombs) {
      bombVis.container.destroy();
    }
    this.activeBombs.clear();
    this.scorchMarks = [];

    if (this.decalGraphics) this.decalGraphics.clear();
    if (this.warningGraphics) this.warningGraphics.clear();
    if (this.fxGraphics) this.fxGraphics.clear();

    this.walls = snapshot.walls.map((w) => ({ ...w }));
    this.drawWalls();

    if (this.player) {
      this.player.name = snapshot.p1.name;
      this.player.maxHealth = snapshot.p1.maxHealth;
      this.player.resetTo(
        snapshot.p1.x,
        snapshot.p1.y,
        snapshot.p1.facing,
        snapshot.p1.health,
        this.cellSize,
        this.offsetX,
        this.offsetY
      );
    }

    if (!this.player2) {
      this.player2 = new Player(
        this,
        snapshot.p2.x,
        snapshot.p2.y,
        this.cellSize,
        this.offsetX,
        this.offsetY,
        snapshot.p2.name,
        'crimson',
        snapshot.p2.facing
      );
    } else {
      this.player2.name = snapshot.p2.name;
      this.player2.maxHealth = snapshot.p2.maxHealth;
      this.player2.resetTo(
        snapshot.p2.x,
        snapshot.p2.y,
        snapshot.p2.facing,
        snapshot.p2.health,
        this.cellSize,
        this.offsetX,
        this.offsetY
      );
    }

    this.highlightActiveCoordinates();
  }

  public syncPvPState(snapshot: PvPBattleSnapshot): void {
    if (!this.player) return;
    this.player.name = snapshot.p1.name;
    this.player.health = snapshot.p1.health;
    this.player.maxHealth = snapshot.p1.maxHealth;
    this.player.gridPos = { x: snapshot.p1.x, y: snapshot.p1.y };
    this.player.setFacing(snapshot.p1.facing, false);
    this.player.updateLayout(this.cellSize, this.offsetX, this.offsetY);

    if (this.player2) {
      this.player2.name = snapshot.p2.name;
      this.player2.health = snapshot.p2.health;
      this.player2.maxHealth = snapshot.p2.maxHealth;
      this.player2.gridPos = { x: snapshot.p2.x, y: snapshot.p2.y };
      this.player2.setFacing(snapshot.p2.facing, false);
      this.player2.updateLayout(this.cellSize, this.offsetX, this.offsetY);
    }
  }

  public updatePvPRealtimeVisuals(snapshot: PvPBattleSnapshot): void {
    if (this.player) {
      this.player.updateInvulnerabilityVisual(
        snapshot.p1.invulnerableRemainingMs
      );
    }
    if (this.player2) {
      this.player2.updateInvulnerabilityVisual(
        snapshot.p2.invulnerableRemainingMs
      );
    }
  }

  public animatePvPMove(
    playerId: PvPPlayerId,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    facing: Direction
  ): void {
    const robot = this.getPvPRobot(playerId);
    if (!robot) return;

    const trailColor = playerId === 'P2' ? 0xf43f5e : 0x38bdf8;
    const trail = this.add.graphics().setDepth(4);
    const tx = this.offsetX + fromX * this.cellSize;
    const ty = this.offsetY + fromY * this.cellSize;
    trail.fillStyle(trailColor, 0.22);
    trail.fillRoundedRect(
      tx + 4,
      ty + 4,
      this.cellSize - 8,
      this.cellSize - 8,
      4
    );
    trail.lineStyle(1, trailColor, 0.5);
    trail.strokeRoundedRect(
      tx + 4,
      ty + 4,
      this.cellSize - 8,
      this.cellSize - 8,
      4
    );

    this.tweens.add({
      targets: trail,
      alpha: 0,
      duration: 450,
      ease: 'Sine.easeOut',
      onComplete: () => trail.destroy(),
    });

    void robot.moveTo(
      toX,
      toY,
      facing,
      this.cellSize,
      this.offsetX,
      this.offsetY
    );
    this.highlightActiveCoordinates();
  }

  public animatePvPBlockedMove(
    playerId: PvPPlayerId,
    _x: number,
    _y: number,
    attemptedX: number,
    attemptedY: number,
    facing: Direction,
    reason: 'boundary' | 'wall' | 'robot'
  ): void {
    const robot = this.getPvPRobot(playerId);
    if (!robot) return;

    if (reason === 'wall' || reason === 'robot') {
      const warn = this.add.graphics().setDepth(28);
      const wx = this.offsetX + attemptedX * this.cellSize;
      const wy = this.offsetY + attemptedY * this.cellSize;
      warn.lineStyle(2, 0xf59e0b, 0.9);
      warn.fillStyle(0xf59e0b, 0.25);
      warn.fillRoundedRect(
        wx + 2,
        wy + 2,
        this.cellSize - 4,
        this.cellSize - 4,
        4
      );
      warn.strokeRoundedRect(
        wx + 2,
        wy + 2,
        this.cellSize - 4,
        this.cellSize - 4,
        4
      );
      this.tweens.add({
        targets: warn,
        alpha: 0,
        duration: 300,
        onComplete: () => warn.destroy(),
      });
    }

    void robot.animateBlocked(facing, this.cellSize);
  }

  public animatePvPLaser(
    attackerId: PvPPlayerId,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    facing: Direction,
    hitOpponent: boolean
  ): void {
    const robot = this.getPvPRobot(attackerId);
    if (robot) {
      robot.setFacing(facing, true);
    }

    const dx = facing === 'east' ? 1 : facing === 'west' ? -1 : 0;
    const dy = facing === 'south' ? 1 : facing === 'north' ? -1 : 0;
    const isP2 = attackerId === 'P2';
    const outerColor = isP2 ? 0xe11d48 : 0x0ea5e9;
    const midColor = isP2 ? 0xfb7185 : 0x38bdf8;
    const coreColor = isP2 ? 0xffe4e6 : 0xe0f2fe;

    const beam = this.add.graphics().setDepth(32);

    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 280,
      ease: 'Sine.easeOut',
      onUpdate: (tween) => {
        const t = tween.getValue() ?? 0;
        const alpha = 1 - t;
        const startPixelX =
          this.offsetX +
          startX * this.cellSize +
          this.cellSize / 2 +
          dx * (this.cellSize * 0.38);
        const startPixelY =
          this.offsetY +
          startY * this.cellSize +
          this.cellSize / 2 +
          dy * (this.cellSize * 0.38);
        const endPixelX =
          this.offsetX + endX * this.cellSize + this.cellSize / 2;
        const endPixelY =
          this.offsetY + endY * this.cellSize + this.cellSize / 2;

        beam.clear();

        beam.lineStyle(
          this.cellSize * 0.34 * (1 - t * 0.4),
          outerColor,
          alpha * 0.45
        );
        beam.beginPath();
        beam.moveTo(startPixelX, startPixelY);
        beam.lineTo(endPixelX, endPixelY);
        beam.strokePath();

        beam.lineStyle(
          this.cellSize * 0.16 * (1 - t * 0.3),
          midColor,
          alpha * 0.85
        );
        beam.beginPath();
        beam.moveTo(startPixelX, startPixelY);
        beam.lineTo(endPixelX, endPixelY);
        beam.strokePath();

        beam.lineStyle(Math.max(2, this.cellSize * 0.06), coreColor, alpha);
        beam.beginPath();
        beam.moveTo(startPixelX, startPixelY);
        beam.lineTo(endPixelX, endPixelY);
        beam.strokePath();

        beam.fillStyle(hitOpponent ? 0xfbbf24 : midColor, alpha);
        beam.fillCircle(
          endPixelX,
          endPixelY,
          this.cellSize * (hitOpponent ? 0.36 : 0.22) * (0.6 + t * 0.6)
        );
      },
      onComplete: () => beam.destroy(),
    });
  }

  public animatePvPShockwave(
    attackerId: PvPPlayerId,
    centerX: number,
    centerY: number,
    radiusCells: number,
    hitOpponent: boolean,
    oppX: number,
    oppY: number
  ): void {
    const isP2 = attackerId === 'P2';
    const ringColor = isP2 ? 0xf43f5e : 0x38bdf8;
    const innerColor = isP2 ? 0xfda4af : 0x7dd3fc;
    const pulseGfx = this.add.graphics().setDepth(33);
    this.cameras.main.shake(140, 0.0025);

    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 420,
      ease: 'Cubic.easeOut',
      onUpdate: (tween) => {
        const t = tween.getValue() ?? 0;
        const alpha = 1 - t;
        const cx =
          this.offsetX + centerX * this.cellSize + this.cellSize / 2;
        const cy =
          this.offsetY + centerY * this.cellSize + this.cellSize / 2;
        const maxPixelR = (radiusCells + 0.35) * this.cellSize;
        const currentR =
          this.cellSize * 0.3 + (maxPixelR - this.cellSize * 0.3) * t;

        pulseGfx.clear();
        pulseGfx.fillStyle(ringColor, alpha * 0.16);
        pulseGfx.fillCircle(cx, cy, currentR);

        if (t > 0.15) {
          pulseGfx.lineStyle(
            Math.max(1.5, 2.5 * alpha),
            innerColor,
            alpha * 0.65
          );
          pulseGfx.strokeCircle(cx, cy, currentR * 0.68);
        }

        pulseGfx.lineStyle(Math.max(2, 4.5 * alpha), ringColor, alpha * 0.95);
        pulseGfx.strokeCircle(cx, cy, currentR);

        if (hitOpponent) {
          const ex =
            this.offsetX + oppX * this.cellSize + this.cellSize / 2;
          const ey =
            this.offsetY + oppY * this.cellSize + this.cellSize / 2;
          pulseGfx.lineStyle(2.5 * alpha, 0xfbbf24, alpha * 0.9);
          pulseGfx.strokeCircle(ex, ey, this.cellSize * (0.28 + 0.42 * t));
        }
      },
      onComplete: () => pulseGfx.destroy(),
    });
  }

  public animatePvPPlayerDamaged(
    targetId: PvPPlayerId,
    damage: number,
    remainingHealth: number,
    defeated: boolean
  ): void {
    const robot = this.getPvPRobot(targetId);
    if (!robot) return;
    robot.takeDamage(
      damage,
      remainingHealth,
      undefined,
      defeated,
      this.cellSize,
      this.offsetX,
      this.offsetY
    );
    if (defeated) {
      this.scorchMarks.push({ x: robot.gridPos.x, y: robot.gridPos.y });
      this.drawDecals();
    }
  }

  public animatePvPBombExplosion(
    bombId: string,
    x: number,
    y: number,
    blastRadius: number
  ): void {
    this.animateBombExplosion(bombId, x, y, blastRadius, []);
  }
}
