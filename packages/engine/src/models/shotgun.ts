import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  MeshStandardMaterial,
  Object3D,
  TorusGeometry,
} from "three";
import type { Disposables } from "../scene/disposables";
import { PALETTE } from "../scene/palette";

/** Barrel axis offsets (left, right) from the gun centre line. */
export const BARREL_X = [-0.026, 0.026] as const;
/** Barrel axis height above the hinge pin. */
export const BARREL_Y = 0.045;
const BARREL_LENGTH = 0.42;
const BARREL_RADIUS = 0.025;
const SHELL_RADIUS = 0.021;
const SHELL_LENGTH = 0.11;

/** The articulated parts the viewmodel animates. */
export interface ShotgunParts {
  /** Barrels + fore-end, pivoting about the hinge pin (rotation.x < 0 breaks the action open). */
  readonly hinge: Group;
  /** Muzzle anchors (left, right barrel) for the flash. */
  readonly muzzles: readonly [Object3D, Object3D];
  /** Whole gun, origin at the receiver centre, barrels pointing down -Z. */
  readonly root: Group;
  /** Two fresh shells living in hinge space; the reload slides them into the chambers. */
  readonly shells: readonly [Group, Group];
}

/**
 * A sawed-off double-barrel built from primitives: blued twin barrels with a rib, a stubby walnut
 * fore-end and pistol grip, exposed hammers, and two red buckshot shells for the reload.
 * Everything is tracked in `resources` so the viewmodel frees it in one call.
 */
export const buildShotgun = (resources: Disposables): ShotgunParts => {
  const track = <T extends { dispose: () => void }>(item: T) =>
    resources.track(item);
  const metal = track(
    // Smooth shading so the teal specular runs as a continuous stripe down the barrels.
    new MeshPhongMaterial({
      color: PALETTE.metal,
      shininess: 34,
      specular: PALETTE.metalSpecular,
    })
  );
  const walnut = track(
    new MeshStandardMaterial({
      color: PALETTE.walnut,
      flatShading: true,
      roughness: 0.62,
    })
  );
  const bore = track(new MeshBasicMaterial({ color: "#000000" }));
  const hull = track(
    new MeshStandardMaterial({ color: PALETTE.red, roughness: 0.45 })
  );
  const brass = track(
    new MeshStandardMaterial({
      color: PALETTE.shellBrass,
      metalness: 0.7,
      roughness: 0.32,
    })
  );

  const part = (
    geometry: BoxGeometry | CylinderGeometry | CircleGeometry | TorusGeometry,
    material: Material,
    position: readonly [number, number, number],
    rotationX = 0
  ) => {
    const mesh = new Mesh(track(geometry), material);
    mesh.position.set(...position);
    mesh.rotation.x = rotationX;
    return mesh;
  };

  const root = new Group();
  root.name = "shotgun";
  root.add(
    part(new BoxGeometry(0.094, 0.078, 0.14), metal, [0, 0, 0]),
    // Pistol grip raked back, with a metal butt cap.
    part(new BoxGeometry(0.064, 0.2, 0.08), walnut, [0, -0.1, 0.105], 0.5),
    part(new BoxGeometry(0.068, 0.026, 0.092), metal, [0, -0.19, 0.155], 0.5),
    // Exposed hammers.
    part(
      new BoxGeometry(0.014, 0.034, 0.026),
      metal,
      [-0.022, 0.05, 0.062],
      -0.5
    ),
    part(
      new BoxGeometry(0.014, 0.034, 0.026),
      metal,
      [0.022, 0.05, 0.062],
      -0.5
    ),
    // Trigger.
    part(new BoxGeometry(0.008, 0.032, 0.01), metal, [0, -0.052, 0.012], 0.3)
  );
  const guard = part(
    new TorusGeometry(0.03, 0.0055, 4, 10, Math.PI),
    metal,
    [0, -0.04, 0.012]
  );
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  root.add(guard);

  const hinge = new Group();
  hinge.name = "hinge";
  hinge.position.set(0, -0.022, -0.07);
  root.add(hinge);

  const barrelGeometry = track(
    new CylinderGeometry(BARREL_RADIUS, BARREL_RADIUS, BARREL_LENGTH, 12)
  );
  const bandGeometry = track(
    new CylinderGeometry(BARREL_RADIUS * 1.12, BARREL_RADIUS * 1.12, 0.024, 12)
  );
  const boreGeometry = track(new CircleGeometry(0.017, 10));
  const muzzles: Object3D[] = [];
  const alongBarrel = (mesh: Mesh, x: number, z: number) => {
    mesh.position.set(x, BARREL_Y, z);
    mesh.rotation.x = Math.PI / 2;
    return mesh;
  };
  for (const x of BARREL_X) {
    const muzzleBore = new Mesh(boreGeometry, bore);
    muzzleBore.position.set(x, BARREL_Y, -BARREL_LENGTH - 0.0015);
    muzzleBore.rotation.y = Math.PI;
    const breechBore = new Mesh(boreGeometry, bore);
    breechBore.position.set(x, BARREL_Y, 0.0015);
    const muzzle = new Object3D();
    muzzle.position.set(x, BARREL_Y, -BARREL_LENGTH - 0.05);
    hinge.add(
      alongBarrel(new Mesh(barrelGeometry, metal), x, -BARREL_LENGTH / 2),
      alongBarrel(new Mesh(bandGeometry, metal), x, -BARREL_LENGTH + 0.012),
      muzzleBore,
      breechBore,
      muzzle
    );
    muzzles.push(muzzle);
  }
  hinge.add(
    // Top rib between the barrels.
    part(new BoxGeometry(0.012, 0.01, BARREL_LENGTH - 0.02), metal, [
      0,
      BARREL_Y + BARREL_RADIUS + 0.002,
      -BARREL_LENGTH / 2,
    ]),
    // Walnut fore-end under the barrels.
    part(new BoxGeometry(0.07, 0.042, 0.2), walnut, [0, 0.008, -0.15]),
    // Hinge pin.
    part(new CylinderGeometry(0.012, 0.012, 0.1, 8), metal, [0, 0, 0])
  );
  const pin = hinge.children.at(-1);
  if (pin) {
    pin.rotation.z = Math.PI / 2;
  }

  const hullGeometry = track(
    new CylinderGeometry(SHELL_RADIUS, SHELL_RADIUS, SHELL_LENGTH, 10)
  );
  const rimGeometry = track(
    new CylinderGeometry(SHELL_RADIUS * 1.18, SHELL_RADIUS * 1.18, 0.014, 10)
  );
  const makeShell = () => {
    const shell = new Group();
    const body = new Mesh(hullGeometry, hull);
    body.rotation.x = Math.PI / 2;
    body.position.z = -SHELL_LENGTH / 2;
    const rim = new Mesh(rimGeometry, brass);
    rim.rotation.x = Math.PI / 2;
    rim.position.z = 0.007;
    shell.add(body, rim);
    shell.visible = false;
    hinge.add(shell);
    return shell;
  };

  const [left, right] = muzzles;
  if (!(left && right)) {
    throw new Error("shotgun: expected two muzzles");
  }
  return {
    hinge,
    muzzles: [left, right],
    root,
    shells: [makeShell(), makeShell()],
  };
};
