import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  type Scene,
} from "three";
import { PALETTE } from "./palette";

/**
 * The SUPERHOT void: a bright cyan-white background, fog that swallows the far floor, a strong
 * sky/ground hemisphere fill and a single crisp shadow-casting key light.
 */
export class Environment {
  private readonly hemisphere: HemisphereLight;
  private readonly sun: DirectionalLight;
  private readonly scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
    scene.background = new Color(PALETTE.background);
    scene.fog = new Fog(PALETTE.fog, 9, 32);

    this.hemisphere = new HemisphereLight(PALETTE.sky, PALETTE.ground, 2.1);
    scene.add(this.hemisphere);

    this.sun = new DirectionalLight("#FFFFFF", 2.3);
    this.sun.position.set(-5, 12, -6);
    this.sun.target.position.set(0, 0, 0);
    this.sun.castShadow = true;
    const { shadow } = this.sun;
    shadow.mapSize.set(2048, 2048);
    shadow.camera.left = -8.5;
    shadow.camera.right = 8.5;
    shadow.camera.top = 8.5;
    shadow.camera.bottom = -8.5;
    shadow.camera.near = 2;
    shadow.camera.far = 32;
    shadow.bias = -0.0004;
    shadow.normalBias = 0.02;
    shadow.radius = 3;
    scene.add(this.sun, this.sun.target);
  }

  dispose(): void {
    this.sun.shadow.dispose();
    this.sun.dispose();
    this.hemisphere.dispose();
    this.scene.remove(this.sun, this.sun.target, this.hemisphere);
    this.scene.fog = null;
    this.scene.background = null;
  }
}
