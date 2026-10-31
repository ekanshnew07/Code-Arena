import Phaser from 'phaser';
import {
  Direction,
  EnemyAIState,
  EnemyArchetype,
  GridPosition,
} from '../../types/game';

const DIRECTION_ANGLES: Record<Direction, number> = {
  east: 0,
  south: Math.PI / 2,
  west: Math.PI,
  north: -Math.PI / 2,
};

export class Enemy {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private bodyContainer: Phaser.GameObjects.Container;
  private aura: Phaser.GameObjects.Graphics;
  private chassis: Phaser.GameObjects.Graphics;
  private core: Phaser.GameObjects.Graphics;
  private stateRing: Phaser.GameObjects.Graphics;
  private hudGraphics: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private stateBadge: Phaser.GameObjects.Text;

  public id: string;
  public name: string;
  public archetype: EnemyArchetype;
  public aiState: EnemyAIState;
  public facing: Direction = 'west';
  public gridPos: GridPosition;
  public health: number;
  public maxHealth: number;
  public alive = true;
  public chargeProgress = 0;
  private currentCellSize: number;

  constructor(
    scene: Phaser.Scene,
    id: string,
    name: string,
    archetype: EnemyArchetype,
    initialState: EnemyAIState,
    gridX: number,
    gridY: number,
    maxHealth: number,
    cellSize: number,
    offsetX: number,
    offsetY: number
  ) {
    this.scene = scene;
    this.id = id;
    this.name = name;
    this.archetype = archetype;
    this.aiState = initialState;
    this.gridPos = { x: gridX, y: gridY };
    this.health = maxHealth;
    this.maxHealth = maxHealth;
    this.currentCellSize = cellSize;

    const pixelX = offsetX + gridX * cellSize + cellSize / 2;
    const pixelY = offsetY + gridY * cellSize + cellSize / 2;

    this.aura = this.scene.add.graphics();
    this.chassis = this.scene.add.graphics();
    this.core = this.scene.add.graphics();
    this.stateRing = this.scene.add.graphics();
    this.hudGraphics = this.scene.add.graphics();

    this.bodyContainer = this.scene.add.container(0, 0, [
      this.aura,
      this.chassis,
      this.core,
    ]);
    this.bodyContainer.setRotation(DIRECTION_ANGLES[this.facing]);

    this.label = this.scene.add
      .text(0, -cellSize * 0.54, name, {
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: `${Math.max(8, Math.floor(cellSize * 0.19))}px`,
        fontStyle: 'bold',
        color: '#fca5a5',
        backgroundColor: '#050914dd',
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5, 1);

    this.stateBadge = this.scene.add
      .text(0, cellSize * 0.44, initialState, {
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: `${Math.max(7, Math.floor(cellSize * 0.17))}px`,
        fontStyle: 'bold',
        color: '#f87171',
        backgroundColor: '#050914cc',
        padding: { x: 2, y: 0.5 },
      })
      .setOrigin(0.5, 0);

    this.container = this.scene.add.container(pixelX, pixelY, [
      this.stateRing,
      this.bodyContainer,
      this.hudGraphics,
      this.label,
      this.stateBadge,
    ]);
    this.container.setDepth(18);

    this.scene.tweens.add({
      targets: this.aura,
      alpha: { from: 0.55, to: 1 },
      scaleX: { from: 0.94, to: 1.06 },
      scaleY: { from: 0.94, to: 1.06 },
      duration: 950,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.draw(cellSize);
  }

  public draw(cellSize: number): void {
    this.currentCellSize = cellSize;
    this.aura.clear();
    this.chassis.clear();
    this.core.clear();
    this.hudGraphics.clear();

    if (!this.alive) {
      this.container.setVisible(false);
      return;
    }
    this.container.setVisible(true);

    const size = cellSize * 0.82;
    const half = size / 2;

    if (this.archetype === 'CHASER') {
      this.drawChaserBody(size, half);
    } else if (this.archetype === 'BOMBER') {
      this.drawBomberBody(size, half);
    } else {
      this.drawLaserShooterBody(size, half);
    }

    this.drawHudAndState(cellSize);
  }

  private drawChaserBody(size: number, half: number): void {
    // Fast crimson/rose melee predator with forward energy blades (pointing +X in local space)
    this.aura.fillStyle(0xf43f5e, 0.16);
    this.aura.fillCircle(0, 0, size * 0.6);
    this.aura.lineStyle(1.2, 0xfb7185, 0.45);
    this.aura.strokeCircle(0, 0, size * 0.56);

    // Swept forward-angled assault wings
    this.chassis.fillStyle(0x881337, 1);
    this.chassis.lineStyle(1.5, 0xf43f5e, 1);

    const bladePts = [
      { x: -half * 0.75, y: -half * 0.82 },
      { x: half * 0.95, y: -half * 0.38 },
      { x: half * 0.45, y: 0 },
      { x: half * 0.95, y: half * 0.38 },
      { x: -half * 0.75, y: half * 0.82 },
      { x: -half * 0.45, y: 0 },
    ];
    this.chassis.beginPath();
    this.chassis.moveTo(bladePts[0].x, bladePts[0].y);
    for (let i = 1; i < bladePts.length; i++) {
      this.chassis.lineTo(bladePts[i].x, bladePts[i].y);
    }
    this.chassis.closePath();
    this.chassis.fillPath();
    this.chassis.strokePath();

    // Glowing plasma melee claws at front (+X)
    this.core.fillStyle(0xfda4af, 1);
    this.core.fillTriangle(
      half * 0.5,
      -half * 0.45,
      half * 1.12,
      -half * 0.18,
      half * 0.5,
      -half * 0.12
    );
    this.core.fillTriangle(
      half * 0.5,
      half * 0.45,
      half * 1.12,
      half * 0.18,
      half * 0.5,
      half * 0.12
    );

    // Core eye
    this.core.fillStyle(0xe11d48, 1);
    this.core.fillCircle(0, 0, size * 0.18);
    this.core.fillStyle(0xffe4e6, 1);
    this.core.fillCircle(size * 0.05, 0, size * 0.07);
  }

  private drawBomberBody(size: number, half: number): void {
    // Heavy octagonal amber-crimson ordnance carrier
    this.aura.fillStyle(0xf97316, 0.16);
    this.aura.fillCircle(0, 0, size * 0.64);
    this.aura.lineStyle(1.2, 0xfb923c, 0.45);
    this.aura.strokeCircle(0, 0, size * 0.6);

    const pts = [
      { x: -half * 0.55, y: -half * 0.92 },
      { x: half * 0.55, y: -half * 0.92 },
      { x: half * 0.92, y: -half * 0.5 },
      { x: half * 0.92, y: half * 0.5 },
      { x: half * 0.55, y: half * 0.92 },
      { x: -half * 0.55, y: half * 0.92 },
      { x: -half * 0.92, y: half * 0.5 },
      { x: -half * 0.92, y: -half * 0.5 },
    ];
    this.chassis.fillStyle(0x7c2d12, 1);
    this.chassis.lineStyle(1.5, 0xf97316, 1);
    this.chassis.beginPath();
    this.chassis.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      this.chassis.lineTo(pts[i].x, pts[i].y);
    }
    this.chassis.closePath();
    this.chassis.fillPath();
    this.chassis.strokePath();

    // Twin dorsal bomb bay canisters
    this.core.fillStyle(0x1e293b, 1);
    this.core.lineStyle(1, 0xfbbf24, 0.9);
    this.core.fillCircle(-size * 0.12, -size * 0.2, size * 0.13);
    this.core.strokeCircle(-size * 0.12, -size * 0.2, size * 0.13);
    this.core.fillCircle(-size * 0.12, size * 0.2, size * 0.13);
    this.core.strokeCircle(-size * 0.12, size * 0.2, size * 0.13);

    // Central amber reactor core
    this.core.fillStyle(0xf59e0b, 1);
    this.core.fillCircle(size * 0.1, 0, size * 0.17);
    this.core.fillStyle(0xfef3c7, 1);
    this.core.fillCircle(size * 0.14, 0, size * 0.07);
  }

  private drawLaserShooterBody(size: number, half: number): void {
    // Precision crimson/red sniper platform with long forward rail cannon (+X in local space)
    this.aura.fillStyle(0xef4444, 0.16);
    this.aura.fillCircle(0, 0, size * 0.62);
    this.aura.lineStyle(1.2, 0xf87171, 0.45);
    this.aura.strokeCircle(0, 0, size * 0.58);

    // Stabilizer wings
    this.chassis.fillStyle(0x450a0a, 1);
    this.chassis.lineStyle(1.5, 0xef4444, 1);
    this.chassis.fillRoundedRect(
      -half * 0.72,
      -half * 0.88,
      size * 0.68,
      size * 0.88,
      4
    );
    this.chassis.strokeRoundedRect(
      -half * 0.72,
      -half * 0.88,
      size * 0.68,
      size * 0.88,
      4
    );

    // Long precision sniper barrel pointing +X
    this.core.fillStyle(0x1e293b, 1);
    this.core.lineStyle(1.2, 0xf87171, 0.95);
    this.core.fillRect(0, -size * 0.11, half * 1.15, size * 0.22);
    this.core.strokeRect(0, -size * 0.11, half * 1.15, size * 0.22);

    // Glowing muzzle tip
    this.core.fillStyle(0xfca5a5, 1);
    this.core.fillRect(half * 0.85, -size * 0.07, half * 0.3, size * 0.14);

    // Central targeting optic
    this.core.fillStyle(0xdc2626, 1);
    this.core.fillCircle(0, 0, size * 0.2);
    this.core.fillStyle(0xfef2f2, 1);
    this.core.fillCircle(size * 0.05, 0, size * 0.08);
  }

  public drawHudAndState(cellSize: number): void {
    this.hudGraphics.clear();
    this.stateRing.clear();

    if (!this.alive) return;

    const barW = cellSize * 0.76;
    const barH = Math.max(3.5, cellSize * 0.095);
    const barY = -cellSize * 0.5;
    const pct = Math.max(0, Math.min(1, this.health / this.maxHealth));

    this.hudGraphics.fillStyle(0x050914, 0.92);
    this.hudGraphics.lineStyle(1, 0x334155, 0.9);
    this.hudGraphics.fillRect(-barW / 2, barY, barW, barH);
    this.hudGraphics.strokeRect(-barW / 2, barY, barW, barH);

    const barColor =
      this.archetype === 'BOMBER'
        ? 0xf97316
        : this.archetype === 'CHASER'
        ? 0xf43f5e
        : 0xef4444;

    this.hudGraphics.fillStyle(barColor, 1);
    this.hudGraphics.fillRect(
      -barW / 2 + 1,
      barY + 1,
      (barW - 2) * pct,
      barH - 2
    );

    this.label.setText(`${this.name} [${this.health}]`);
    this.label.setY(barY - 2);
    this.label.setFontSize(Math.max(8, Math.floor(cellSize * 0.18)));

    // Show warning badge only when enemy is actively telegraphing an attack
    this.stateBadge.setY(cellSize * 0.42);
    this.stateBadge.setFontSize(Math.max(8, Math.floor(cellSize * 0.16)));

    if (
      this.aiState === 'CHARGE' ||
      this.aiState === 'FIRE' ||
      this.aiState === 'ATTACK'
    ) {
      const warnLabel =
        this.aiState === 'ATTACK' ? 'ATTACK!' : 'CHARGING!';
      this.stateBadge.setText(warnLabel);
      this.stateBadge.setVisible(true);
      this.stateBadge.setColor('#fef08a');
      this.stateBadge.setBackgroundColor('#7f1d1dee');
      const r = cellSize * (0.48 + (this.chargeProgress ?? 0) * 0.14);
      this.stateRing.lineStyle(2, 0xfbbf24, 0.9);
      this.stateRing.strokeCircle(0, 0, r);
    } else if (this.aiState === 'AIM' || this.aiState === 'PLACE_BOMB') {
      const warnLabel =
        this.aiState === 'AIM' ? 'LOCKING ON' : 'BOMB!';
      this.stateBadge.setText(warnLabel);
      this.stateBadge.setVisible(true);
      this.stateBadge.setColor('#fdba74');
      this.stateBadge.setBackgroundColor('#431407dd');
      this.stateRing.lineStyle(1.5, 0xf97316, 0.75);
      this.stateRing.strokeCircle(0, 0, cellSize * 0.48);
    } else {
      this.stateBadge.setVisible(false);
    }
  }

  public setFacing(facing: Direction, animate = true): void {
    this.facing = facing;
    const targetRot = DIRECTION_ANGLES[facing];
    if (!animate) {
      this.bodyContainer.setRotation(targetRot);
      return;
    }

    const currentRot = this.bodyContainer.rotation;
    const diff = Phaser.Math.Angle.Wrap(targetRot - currentRot);
    this.scene.tweens.add({
      targets: this.bodyContainer,
      rotation: currentRot + diff,
      duration: 130,
      ease: 'Sine.easeOut',
    });
  }

  public moveTo(
    gridX: number,
    gridY: number,
    facing: Direction,
    cellSize: number,
    offsetX: number,
    offsetY: number
  ): void {
    this.gridPos = { x: gridX, y: gridY };
    this.setFacing(facing, true);

    const targetX = offsetX + gridX * cellSize + cellSize / 2;
    const targetY = offsetY + gridY * cellSize + cellSize / 2;

    this.scene.tweens.add({
      targets: this.container,
      x: targetX,
      y: targetY,
      duration: 260,
      ease: 'Sine.easeInOut',
    });
  }

  public animateMeleeStrike(
    targetX: number,
    targetY: number,
    cellSize: number,
    offsetX: number,
    offsetY: number
  ): void {
    const origX = offsetX + this.gridPos.x * cellSize + cellSize / 2;
    const origY = offsetY + this.gridPos.y * cellSize + cellSize / 2;
    const destX = offsetX + targetX * cellSize + cellSize / 2;
    const destY = offsetY + targetY * cellSize + cellSize / 2;

    const lungeX = origX + (destX - origX) * 0.48;
    const lungeY = origY + (destY - origY) * 0.48;

    this.scene.tweens.add({
      targets: this.container,
      x: lungeX,
      y: lungeY,
      duration: 100,
      yoyo: true,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.container.setPosition(origX, origY);
      },
    });
  }

  public takeDamage(
    damage: number,
    newHealth: number,
    destroyed: boolean
  ): void {
    this.health = newHealth;
    this.alive = !destroyed;
    if (destroyed) {
      this.aiState = 'DEFEATED';
    }

    const dmgText = this.scene.add
      .text(
        this.container.x,
        this.container.y - this.currentCellSize * 0.4,
        `-${damage}`,
        {
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: `${Math.max(11, Math.floor(this.currentCellSize * 0.32))}px`,
          fontStyle: 'bold',
          color: '#fbbf24',
          stroke: '#000000',
          strokeThickness: 3,
        }
      )
      .setOrigin(0.5, 1)
      .setDepth(42);

    this.scene.tweens.add({
      targets: dmgText,
      y: dmgText.y - this.currentCellSize * 0.65,
      alpha: 0,
      duration: 650,
      ease: 'Cubic.easeOut',
      onComplete: () => dmgText.destroy(),
    });

    if (destroyed) {
      this.playDestructionEffect();
      this.draw(this.currentCellSize);
    } else {
      this.drawHudAndState(this.currentCellSize);
      this.scene.tweens.add({
        targets: this.bodyContainer,
        scaleX: 1.22,
        scaleY: 1.22,
        alpha: 0.4,
        duration: 85,
        yoyo: true,
        repeat: 1,
        onComplete: () => {
          this.bodyContainer.setScale(1);
          this.bodyContainer.setAlpha(1);
        },
      });
    }
  }

  private playDestructionEffect(): void {
    const px = this.container.x;
    const py = this.container.y;
    const fx = this.scene.add.graphics().setDepth(35);

    const radius = this.currentCellSize * 0.2;
    const maxRadius = this.currentCellSize * 1.1;

    this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 450,
      ease: 'Cubic.easeOut',
      onUpdate: (tween) => {
        const t = tween.getValue() ?? 0;
        const curR = radius + (maxRadius - radius) * t;
        fx.clear();
        fx.lineStyle(3.5 * (1 - t), 0xef4444, 1 - t);
        fx.strokeCircle(px, py, curR);
        fx.fillStyle(0xf97316, 0.55 * (1 - t));
        fx.fillCircle(px, py, curR * 0.65);
      },
      onComplete: () => fx.destroy(),
    });
  }

  public syncRealtimeState(
    aiState: EnemyAIState,
    facing: Direction,
    chargeProgress: number
  ): void {
    const stateChanged =
      this.aiState !== aiState ||
      Math.abs((this.chargeProgress ?? 0) - chargeProgress) > 0.04;
    this.aiState = aiState;
    this.chargeProgress = chargeProgress;
    if (this.facing !== facing) {
      this.setFacing(facing, true);
    }
    if (stateChanged) {
      this.drawHudAndState(this.currentCellSize);
    }
  }

  public resetTo(
    gridX: number,
    gridY: number,
    facing: Direction,
    aiState: EnemyAIState,
    health: number,
    maxHealth: number,
    alive: boolean,
    cellSize: number,
    offsetX: number,
    offsetY: number
  ): void {
    this.scene.tweens.killTweensOf(this.container);
    this.scene.tweens.killTweensOf(this.bodyContainer);
    this.gridPos = { x: gridX, y: gridY };
    this.facing = facing;
    this.aiState = aiState;
    this.health = health;
    this.maxHealth = maxHealth;
    this.alive = alive;
    this.chargeProgress = 0;
    this.bodyContainer.setScale(1);
    this.bodyContainer.setAlpha(1);
    this.setFacing(facing, false);
    this.updateLayout(cellSize, offsetX, offsetY);
  }

  public updateLayout(cellSize: number, offsetX: number, offsetY: number): void {
    this.scene.tweens.killTweensOf(this.container);
    const pixelX = offsetX + this.gridPos.x * cellSize + cellSize / 2;
    const pixelY = offsetY + this.gridPos.y * cellSize + cellSize / 2;
    this.container.setPosition(pixelX, pixelY);
    this.draw(cellSize);
  }

  public destroy(): void {
    this.container.destroy();
  }
}
