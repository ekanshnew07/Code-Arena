import Phaser from 'phaser';
import { Direction, GridPosition } from '../../types/game';

const DIRECTION_ANGLES: Record<Direction, number> = {
  east: 0,
  south: Math.PI / 2,
  west: Math.PI,
  north: -Math.PI / 2,
};

export type PlayerColorTheme = 'blue' | 'crimson';

export class Player {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private bodyContainer: Phaser.GameObjects.Container;
  private aura: Phaser.GameObjects.Graphics;
  private shieldGfx: Phaser.GameObjects.Graphics;
  private chassis: Phaser.GameObjects.Graphics;
  private turret: Phaser.GameObjects.Graphics;
  private hudGraphics: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;

  public name: string;
  public theme: PlayerColorTheme;
  public gridPos: GridPosition;
  public facing: Direction = 'east';
  public health = 100;
  public maxHealth = 100;
  private currentCellSize: number;
  private currentOffsetX: number;
  private currentOffsetY: number;
  private activeMoveTween: Phaser.Tweens.Tween | null = null;

  constructor(
    scene: Phaser.Scene,
    gridX: number,
    gridY: number,
    cellSize: number,
    offsetX: number,
    offsetY: number,
    name = 'UNIT-01',
    theme: PlayerColorTheme = 'blue',
    initialFacing: Direction = 'east'
  ) {
    this.scene = scene;
    this.name = name;
    this.theme = theme;
    this.facing = initialFacing;
    this.gridPos = { x: gridX, y: gridY };
    this.currentCellSize = cellSize;
    this.currentOffsetX = offsetX;
    this.currentOffsetY = offsetY;

    const pixelX = offsetX + gridX * cellSize + cellSize / 2;
    const pixelY = offsetY + gridY * cellSize + cellSize / 2;

    this.aura = this.scene.add.graphics();
    this.chassis = this.scene.add.graphics();
    this.turret = this.scene.add.graphics();
    this.shieldGfx = this.scene.add.graphics();
    this.hudGraphics = this.scene.add.graphics();

    this.bodyContainer = this.scene.add.container(0, 0, [
      this.aura,
      this.chassis,
      this.turret,
      this.shieldGfx,
    ]);
    this.bodyContainer.setRotation(DIRECTION_ANGLES[this.facing]);

    this.label = this.scene.add
      .text(0, -cellSize * 0.56, `${this.name} [100]`, {
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: `${Math.max(8, Math.floor(cellSize * 0.19))}px`,
        fontStyle: 'bold',
        color: theme === 'crimson' ? '#fda4af' : '#7dd3fc',
        backgroundColor: '#050914dd',
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5, 1);

    this.container = this.scene.add.container(pixelX, pixelY, [
      this.bodyContainer,
      this.hudGraphics,
      this.label,
    ]);
    this.container.setDepth(20);

    // Subtle idle hover pulse on aura
    this.scene.tweens.add({
      targets: this.aura,
      alpha: { from: 0.65, to: 1 },
      scaleX: { from: 0.96, to: 1.05 },
      scaleY: { from: 0.96, to: 1.05 },
      duration: 1100,
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
    this.turret.clear();
    this.hudGraphics.clear();

    const size = cellSize * 0.82;
    const half = size / 2;
    const isCrimson = this.theme === 'crimson';

    const glowPrimary = isCrimson ? 0xe11d48 : 0x0ea5e9;
    const glowBright = isCrimson ? 0xfb7185 : 0x38bdf8;
    const hullDark = isCrimson ? 0x4c0519 : 0x0c4a6e;
    const hullMid = isCrimson ? 0xbe123c : 0x0284c7;
    const accentLight = isCrimson ? 0xfda4af : 0x7dd3fc;
    const domeDark = isCrimson ? 0x9f1239 : 0x0369a1;
    const coreWhite = isCrimson ? 0xffe4e6 : 0xe0f2fe;

    // 1. Tactical holographic ground ring & thruster glow
    this.aura.fillStyle(glowPrimary, 0.16);
    this.aura.fillCircle(0, 0, size * 0.62);
    this.aura.lineStyle(1.2, glowBright, 0.45);
    this.aura.strokeCircle(0, 0, size * 0.58);

    // Rear thruster plasma glow (west side of local body)
    this.aura.fillStyle(glowBright, 0.45);
    this.aura.fillEllipse(-half * 0.88, -size * 0.18, size * 0.22, size * 0.12);
    this.aura.fillEllipse(-half * 0.88, size * 0.18, size * 0.22, size * 0.12);

    // 2. Heavy Armored Treads (Top & Bottom in local East-facing space)
    const treadL = size * 0.88;
    const treadThick = size * 0.2;
    this.chassis.fillStyle(0x09101d, 1);
    this.chassis.lineStyle(1, hullMid, 0.85);

    this.chassis.fillRoundedRect(-treadL / 2, -half, treadL, treadThick, 3);
    this.chassis.strokeRoundedRect(-treadL / 2, -half, treadL, treadThick, 3);
    this.chassis.fillRoundedRect(
      -treadL / 2,
      half - treadThick,
      treadL,
      treadThick,
      3
    );
    this.chassis.strokeRoundedRect(
      -treadL / 2,
      half - treadThick,
      treadL,
      treadThick,
      3
    );

    // Tread grouser ribs
    this.chassis.lineStyle(1, 0x1e293b, 0.9);
    for (let i = -3; i <= 3; i++) {
      const rx = i * (treadL * 0.12);
      this.chassis.moveTo(rx, -half + 1);
      this.chassis.lineTo(rx, -half + treadThick - 1);
      this.chassis.moveTo(rx, half - treadThick + 1);
      this.chassis.lineTo(rx, half - 1);
    }
    this.chassis.strokePath();

    // 3. Main Bevelled Hexagonal Mech Hull
    const hullW = size * 0.78;
    const hullH = size * 0.68;
    const hw = hullW / 2;
    const hh = hullH / 2;
    const bevel = size * 0.14;

    const hullPts = [
      { x: -hw + bevel, y: -hh },
      { x: hw - bevel * 0.6, y: -hh },
      { x: hw, y: -hh + bevel },
      { x: hw, y: hh - bevel },
      { x: hw - bevel * 0.6, y: hh },
      { x: -hw + bevel, y: hh },
      { x: -hw, y: hh - bevel * 0.8 },
      { x: -hw, y: -hh + bevel * 0.8 },
    ];

    this.chassis.fillStyle(hullDark, 1);
    this.chassis.lineStyle(1.5, glowBright, 1);
    this.chassis.beginPath();
    this.chassis.moveTo(hullPts[0].x, hullPts[0].y);
    for (let i = 1; i < hullPts.length; i++) {
      this.chassis.lineTo(hullPts[i].x, hullPts[i].y);
    }
    this.chassis.closePath();
    this.chassis.fillPath();
    this.chassis.strokePath();

    // Inner raised armor deck
    this.chassis.fillStyle(hullMid, 1);
    this.chassis.fillRoundedRect(
      -hw * 0.65,
      -hh * 0.68,
      hullW * 0.65,
      hullH * 0.68,
      3
    );

    // Shoulder weapon pods
    this.chassis.fillStyle(0x0f172a, 1);
    this.chassis.lineStyle(1, accentLight, 0.8);
    this.chassis.fillRect(-hw * 0.3, -hh * 0.92, size * 0.24, size * 0.12);
    this.chassis.strokeRect(-hw * 0.3, -hh * 0.92, size * 0.24, size * 0.12);
    this.chassis.fillRect(
      -hw * 0.3,
      hh * 0.92 - size * 0.12,
      size * 0.24,
      size * 0.12
    );
    this.chassis.strokeRect(
      -hw * 0.3,
      hh * 0.92 - size * 0.12,
      size * 0.24,
      size * 0.12
    );

    // 4. Twin Plasma Cannon Barrels & Central Turret Dome
    const barrelLen = half * 1.05;
    const barrelThick = size * 0.09;
    const barrelOffset = size * 0.13;

    this.turret.fillStyle(0x0f172a, 1);
    this.turret.lineStyle(1, glowBright, 0.9);
    this.turret.fillRect(
      0,
      -barrelOffset - barrelThick / 2,
      barrelLen,
      barrelThick
    );
    this.turret.strokeRect(
      0,
      -barrelOffset - barrelThick / 2,
      barrelLen,
      barrelThick
    );
    this.turret.fillRect(
      0,
      barrelOffset - barrelThick / 2,
      barrelLen,
      barrelThick
    );
    this.turret.strokeRect(
      0,
      barrelOffset - barrelThick / 2,
      barrelLen,
      barrelThick
    );

    this.turret.fillStyle(accentLight, 1);
    this.turret.fillRect(
      barrelLen * 0.72,
      -barrelOffset - barrelThick * 0.35,
      barrelLen * 0.28,
      barrelThick * 0.7
    );
    this.turret.fillRect(
      barrelLen * 0.72,
      barrelOffset - barrelThick * 0.35,
      barrelLen * 0.28,
      barrelThick * 0.7
    );

    this.turret.fillStyle(domeDark, 1);
    this.turret.lineStyle(1.5, accentLight, 1);
    this.turret.fillCircle(0, 0, size * 0.22);
    this.turret.strokeCircle(0, 0, size * 0.22);

    this.turret.fillStyle(glowBright, 1);
    this.turret.fillCircle(0, 0, size * 0.12);
    this.turret.fillStyle(coreWhite, 1);
    this.turret.fillCircle(size * 0.03, 0, size * 0.05);

    this.drawHud(cellSize);
  }

  public drawHud(cellSize: number): void {
    this.hudGraphics.clear();
    const barW = cellSize * 0.76;
    const barH = Math.max(3.5, cellSize * 0.095);
    const barY = -cellSize * 0.5;
    const pct = Math.max(0, Math.min(1, this.health / this.maxHealth));

    this.hudGraphics.fillStyle(0x050914, 0.92);
    this.hudGraphics.lineStyle(1, 0x1e293b, 0.95);
    this.hudGraphics.fillRect(-barW / 2, barY, barW, barH);
    this.hudGraphics.strokeRect(-barW / 2, barY, barW, barH);

    const healthyColor = this.theme === 'crimson' ? 0xf43f5e : 0x38bdf8;
    const barColor =
      pct > 0.5 ? healthyColor : pct > 0.25 ? 0xfbbf24 : 0xef4444;
    this.hudGraphics.fillStyle(barColor, 1);
    this.hudGraphics.fillRect(
      -barW / 2 + 1,
      barY + 1,
      (barW - 2) * pct,
      barH - 2
    );

    this.label.setText(`${this.name} [${this.health}]`);
    this.label.setColor(this.theme === 'crimson' ? '#fda4af' : '#7dd3fc');
    this.label.setY(barY - 2);
    this.label.setFontSize(Math.max(8, Math.floor(cellSize * 0.19)));
  }

  public updateInvulnerabilityVisual(remainingMs: number): void {
    this.shieldGfx.clear();
    if (remainingMs <= 0) {
      this.bodyContainer.setAlpha(this.health > 0 ? 1 : 0.45);
      return;
    }

    // Pulsing cyan deflector shield & brief invulnerability shimmer
    const pulse = 0.45 + 0.35 * Math.sin(remainingMs * 0.025);
    const r = this.currentCellSize * 0.48;
    this.shieldGfx.lineStyle(2, 0x7dd3fc, pulse);
    this.shieldGfx.fillStyle(0x38bdf8, pulse * 0.22);
    this.shieldGfx.fillCircle(0, 0, r);
    this.shieldGfx.strokeCircle(0, 0, r);
  }

  public takeDamage(
    damage: number,
    remainingHealth: number,
    knockbackTo: GridPosition | undefined,
    defeated: boolean,
    cellSize: number,
    offsetX: number,
    offsetY: number
  ): void {
    this.health = remainingHealth;
    this.drawHud(cellSize);

    // Floating damage text
    const dmgText = this.scene.add
      .text(
        this.container.x,
        this.container.y - cellSize * 0.45,
        `-${damage} HP`,
        {
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: `${Math.max(11, Math.floor(cellSize * 0.3))}px`,
          fontStyle: 'bold',
          color: '#f87171',
          stroke: '#000000',
          strokeThickness: 3,
        }
      )
      .setOrigin(0.5, 1)
      .setDepth(45);

    this.scene.tweens.add({
      targets: dmgText,
      y: dmgText.y - cellSize * 0.65,
      alpha: 0,
      duration: 750,
      ease: 'Cubic.easeOut',
      onComplete: () => dmgText.destroy(),
    });

    // Camera impact jolt
    this.scene.cameras.main.shake(140, 0.0045);

    // Knockback tween if knocked into an adjacent cell
    if (knockbackTo) {
      this.gridPos = { x: knockbackTo.x, y: knockbackTo.y };
      const targetX = offsetX + knockbackTo.x * cellSize + cellSize / 2;
      const targetY = offsetY + knockbackTo.y * cellSize + cellSize / 2;
      this.scene.tweens.add({
        targets: this.container,
        x: targetX,
        y: targetY,
        duration: 160,
        ease: 'Back.easeOut',
      });
    }

    // Hit flash
    this.scene.tweens.add({
      targets: this.bodyContainer,
      scaleX: 1.18,
      scaleY: 1.18,
      duration: 80,
      yoyo: true,
      repeat: 1,
      onComplete: () => {
        this.bodyContainer.setScale(1);
        if (defeated) {
          this.bodyContainer.setAlpha(0.45);
          this.playDefeatShockwave();
        }
      },
    });
  }

  private playDefeatShockwave(): void {
    const px = this.container.x;
    const py = this.container.y;
    const fx = this.scene.add.graphics().setDepth(38);
    const maxR = this.currentCellSize * 1.3;

    this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 520,
      ease: 'Cubic.easeOut',
      onUpdate: (tween) => {
        const t = tween.getValue() ?? 0;
        const r = this.currentCellSize * 0.2 + maxR * t;
        fx.clear();
        fx.lineStyle(3 * (1 - t), 0x38bdf8, 1 - t);
        fx.strokeCircle(px, py, r);
        fx.fillStyle(0xef4444, 0.45 * (1 - t));
        fx.fillCircle(px, py, r * 0.6);
      },
      onComplete: () => fx.destroy(),
    });
  }

  public setFacing(facing: Direction, animate = true): void {
    this.facing = facing;
    const targetRotation = DIRECTION_ANGLES[facing];
    if (!animate) {
      this.bodyContainer.setRotation(targetRotation);
      return;
    }

    const currentRot = this.bodyContainer.rotation;
    const diff = Phaser.Math.Angle.Wrap(targetRotation - currentRot);
    this.scene.tweens.add({
      targets: this.bodyContainer,
      rotation: currentRot + diff,
      duration: 120,
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
  ): Promise<void> {
    this.gridPos = { x: gridX, y: gridY };
    this.currentCellSize = cellSize;
    this.currentOffsetX = offsetX;
    this.currentOffsetY = offsetY;
    this.setFacing(facing, true);

    const targetX = offsetX + gridX * cellSize + cellSize / 2;
    const targetY = offsetY + gridY * cellSize + cellSize / 2;

    return new Promise((resolve) => {
      this.activeMoveTween = this.scene.tweens.add({
        targets: this.container,
        x: targetX,
        y: targetY,
        duration: 240,
        ease: 'Cubic.easeOut',
        onComplete: () => {
          this.activeMoveTween = null;
          resolve();
        },
      });
    });
  }

  public animateBlocked(facing: Direction, cellSize: number): Promise<void> {
    this.setFacing(facing, true);
    const dx = facing === 'east' ? 1 : facing === 'west' ? -1 : 0;
    const dy = facing === 'south' ? 1 : facing === 'north' ? -1 : 0;

    const origX = this.container.x;
    const origY = this.container.y;
    const nudge = cellSize * 0.18;

    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: this.container,
        x: origX + dx * nudge,
        y: origY + dy * nudge,
        duration: 90,
        yoyo: true,
        ease: 'Quad.easeOut',
        onComplete: () => {
          const restX =
            this.currentOffsetX +
            this.gridPos.x * this.currentCellSize +
            this.currentCellSize / 2;
          const restY =
            this.currentOffsetY +
            this.gridPos.y * this.currentCellSize +
            this.currentCellSize / 2;
          this.container.setPosition(restX, restY);
          resolve();
        },
      });
    });
  }

  public resetTo(
    gridX: number,
    gridY: number,
    facing: Direction,
    health: number,
    cellSize: number,
    offsetX: number,
    offsetY: number
  ): void {
    this.activeMoveTween = null;
    this.scene.tweens.killTweensOf(this.container);
    this.scene.tweens.killTweensOf(this.bodyContainer);
    this.gridPos = { x: gridX, y: gridY };
    this.health = health;
    this.bodyContainer.setAlpha(1);
    this.bodyContainer.setScale(1);
    this.shieldGfx.clear();
    this.setFacing(facing, false);
    this.updateLayout(cellSize, offsetX, offsetY);
  }

  public updateLayout(cellSize: number, offsetX: number, offsetY: number): void {
    this.currentCellSize = cellSize;
    this.currentOffsetX = offsetX;
    this.currentOffsetY = offsetY;
    const pixelX = offsetX + this.gridPos.x * cellSize + cellSize / 2;
    const pixelY = offsetY + this.gridPos.y * cellSize + cellSize / 2;
    if (this.activeMoveTween && this.activeMoveTween.isPlaying()) {
      this.activeMoveTween.updateTo('x', pixelX, true);
      this.activeMoveTween.updateTo('y', pixelY, true);
    } else {
      this.container.setPosition(pixelX, pixelY);
    }
    this.draw(cellSize);
  }

  public destroy(): void {
    this.container.destroy();
  }
}
