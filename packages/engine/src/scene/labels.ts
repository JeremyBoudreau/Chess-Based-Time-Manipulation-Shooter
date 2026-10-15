import {
  CanvasTexture,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  type Vector3,
} from "three";
import { easeOutCubic, smoothstep } from "./coords";
import { PALETTE } from "./palette";

const MAX_PIPS = 12;
const PIP_WIDTH = 16;
const PIP_HEIGHT = 20;
const PIP_GAP = 6;
const PIP_CANVAS_WIDTH = 288;
const PIP_CANVAS_HEIGHT = 32;
/** World height of the pip strip; width follows the canvas aspect. */
const PIP_WORLD_HEIGHT = 0.085;

interface CanvasSprite {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly material: SpriteMaterial;
  readonly sprite: Sprite;
  readonly texture: CanvasTexture;
}

const createCanvasSprite = (width: number, height: number): CanvasSprite => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("labels: 2D canvas context unavailable");
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const material = new SpriteMaterial({
    depthWrite: false,
    fog: false,
    map: texture,
    toneMapped: false,
    transparent: true,
  });
  const sprite = new Sprite(material);
  sprite.renderOrder = 10;
  return { canvas, context, material, sprite, texture };
};

const disposeCanvasSprite = (target: CanvasSprite) => {
  target.sprite.removeFromParent();
  target.material.dispose();
  target.texture.dispose();
};

/**
 * Shotgun-King-style HP pips floating over a piece. The canvas is only redrawn when the HP
 * actually changes, so steady-state frames cost nothing but a sprite draw.
 */
export class HpPips {
  private readonly target = createCanvasSprite(
    PIP_CANVAS_WIDTH,
    PIP_CANVAS_HEIGHT
  );
  private hp = -1;
  private maxHp = -1;

  constructor() {
    const aspect = PIP_CANVAS_WIDTH / PIP_CANVAS_HEIGHT;
    this.target.sprite.scale.set(
      PIP_WORLD_HEIGHT * aspect,
      PIP_WORLD_HEIGHT,
      1
    );
  }

  get sprite(): Sprite {
    return this.target.sprite;
  }

  update(hp: number, maxHp: number): void {
    if (hp === this.hp && maxHp === this.maxHp) {
      return;
    }
    this.hp = hp;
    this.maxHp = maxHp;
    this.redraw();
  }

  private redraw(): void {
    const { context, texture } = this.target;
    const total = Math.min(MAX_PIPS, Math.max(0, Math.round(this.maxHp)));
    const remaining = Math.min(total, Math.max(0, Math.ceil(this.hp)));
    context.clearRect(0, 0, PIP_CANVAS_WIDTH, PIP_CANVAS_HEIGHT);
    const stripWidth = total * PIP_WIDTH + Math.max(0, total - 1) * PIP_GAP;
    const left = (PIP_CANVAS_WIDTH - stripWidth) / 2;
    const top = (PIP_CANVAS_HEIGHT - PIP_HEIGHT) / 2;
    const slant = 4;
    for (let index = 0; index < total; index += 1) {
      const x = left + index * (PIP_WIDTH + PIP_GAP);
      context.beginPath();
      context.moveTo(x + slant, top);
      context.lineTo(x + PIP_WIDTH + slant, top);
      context.lineTo(x + PIP_WIDTH - slant, top + PIP_HEIGHT);
      context.lineTo(x - slant, top + PIP_HEIGHT);
      context.closePath();
      if (index < remaining) {
        context.fillStyle = PALETTE.red;
        context.fill();
        context.lineWidth = 2;
        context.strokeStyle = "rgba(10, 12, 14, 0.55)";
        context.stroke();
      } else {
        context.fillStyle = "rgba(10, 12, 14, 0.2)";
        context.fill();
      }
    }
    texture.needsUpdate = true;
  }

  dispose(): void {
    disposeCanvasSprite(this.target);
  }
}

const NUMBER_CANVAS_WIDTH = 160;
const NUMBER_CANVAS_HEIGHT = 96;
const NUMBER_WORLD_HEIGHT = 0.24;
/** Real seconds a damage number lives. */
const NUMBER_LIFETIME = 1;
const NUMBER_RISE = 0.45;

const roundedRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.closePath();
};

/**
 * A floating damage readout ("1", "3", ...) (cream digits on a red rounded box) that rises and fades over
 * about a second of REAL time, so it stays readable even while game time is frozen. Hits that land
 * on the same piece in quick succession merge into one growing number instead of stacking.
 */
export class DamageNumber {
  readonly pieceId: string;
  /** Game time of the most recent merged hit (merging is decided in game time). */
  lastHitGameTime: number;
  private readonly target = createCanvasSprite(
    NUMBER_CANVAS_WIDTH,
    NUMBER_CANVAS_HEIGHT
  );
  private readonly anchor: Vector3;
  private age = 0;
  private popAge = 0;
  private value = 0;

  constructor(
    pieceId: string,
    anchor: Vector3,
    value: number,
    gameTime: number
  ) {
    this.pieceId = pieceId;
    this.anchor = anchor.clone();
    this.lastHitGameTime = gameTime;
    this.add(value, gameTime);
  }

  get sprite(): Sprite {
    return this.target.sprite;
  }

  get finished(): boolean {
    return this.age >= NUMBER_LIFETIME;
  }

  /** Merge another hit into this number and re-pop it. */
  add(value: number, gameTime: number): void {
    this.value += value;
    this.lastHitGameTime = gameTime;
    this.age = Math.min(this.age, 0.2);
    this.popAge = 0;
    this.redraw();
  }

  update(realDt: number): void {
    this.age += realDt;
    this.popAge += realDt;
    const t = Math.min(1, this.age / NUMBER_LIFETIME);
    const pop = 1 + 0.45 * (1 - smoothstep(0, 0.16, this.popAge));
    const { sprite, material } = this.target;
    sprite.position.set(
      this.anchor.x,
      this.anchor.y + NUMBER_RISE * easeOutCubic(t),
      this.anchor.z
    );
    const aspect = NUMBER_CANVAS_WIDTH / NUMBER_CANVAS_HEIGHT;
    sprite.scale.set(
      NUMBER_WORLD_HEIGHT * aspect * pop,
      NUMBER_WORLD_HEIGHT * pop,
      1
    );
    material.opacity = 1 - smoothstep(0.55, 1, t);
  }

  private redraw(): void {
    const { context, texture } = this.target;
    const text = String(Math.round(this.value));
    context.clearRect(0, 0, NUMBER_CANVAS_WIDTH, NUMBER_CANVAS_HEIGHT);
    context.font = "800 62px system-ui, 'Segoe UI', Roboto, sans-serif";
    const textWidth = context.measureText(text).width;
    const boxWidth = Math.min(NUMBER_CANVAS_WIDTH - 8, textWidth + 40);
    const boxHeight = 72;
    const x = (NUMBER_CANVAS_WIDTH - boxWidth) / 2;
    const y = (NUMBER_CANVAS_HEIGHT - boxHeight) / 2;
    roundedRect(context, x, y, boxWidth, boxHeight, 14);
    context.fillStyle = PALETTE.red;
    context.fill();
    context.fillStyle = PALETTE.cream;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      text,
      NUMBER_CANVAS_WIDTH / 2,
      NUMBER_CANVAS_HEIGHT / 2 + 3
    );
    texture.needsUpdate = true;
  }

  dispose(): void {
    disposeCanvasSprite(this.target);
  }
}
