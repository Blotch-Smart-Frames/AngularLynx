import {
  Component,
  DestroyRef,
  type ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS, type LynxCanvasElement } from '@blotch/angular-lynx';
import * as THREE from 'three';
import { buildCut } from '../cut/cut-geometry';
import type { Cut, Gem } from '../data/gems';
import { seeded } from '../data/random';

// cspell:words metalness clearcoat PMREM lerp

/** The plan view spans 2.4 girdle units, with a margin around the girdle. */
const PLAN_UNITS = 2.4;
/** How far behind the stone its diagram lies, in world units. */
const PLAN_DEPTH = 1.7;
/** The pavilion mosaic sits just inside the shell, so every facet refracts it. */
const INNER_SCALE = 0.9;
/**
 * three.js's dispersion is unitless; a gem's (0.014 to 0.051, the B to G
 * interval) scaled by this throws fire a phone can see: sphene flares, a
 * tourmaline glints.
 */
const DISPERSION_GAIN = 260;

/**
 * The stone, drawn with WebGL2 in a `<canvas>`: on iOS through ANGLE on
 * Metal, on Android through the phone's GL ES, in the web preview through
 * the browser. A refractive, dispersive physical shell on the cut's geometry,
 * around an opaque mosaic of the same facets in the stone's tones: what a
 * real stone's pavilion does with light, the shell's refraction does to the
 * mosaic, and dispersion splits its edges into fire.
 */
@Component({
  selector: 'view[appStoneScene]',
  imports: [LYNX_ELEMENTS],
  template: `
    <canvas
      #canvas
      class="h-full w-full"
      accessibility-label="The stone, turning in the light"
    ></canvas>
  `,
})
export class StoneScene {
  readonly canvas = viewChild.required<ElementRef<LynxCanvasElement>>('canvas');

  readonly gem = input.required<Gem>();
  /** The stone's color under the current light (alexandrite changes). */
  readonly color = input.required<string>();
  readonly cut = input.required<Cut>();
  /** The dial's angle, in radians: the stone turns with it. */
  readonly spin = input(0);
  /** Idle motion: the stone's slow turn and the orbiting key light. */
  readonly animate = input(true);
  /** The color of the diagram's hairlines (the paper). */
  readonly paper = input('#f6f3ec');
  /** The plan view's width on screen, matching the plate's SVG map. */
  readonly planWidth = input(304);
  /** Whether there's WebGL here: Lynx Explorer has no canvas. */
  readonly ready = output<boolean>();

  #shell: THREE.Mesh | null = null;
  #mosaic: THREE.Mesh | null = null;
  #lines: THREE.LineSegments | null = null;
  #material: THREE.MeshPhysicalMaterial | null = null;
  readonly #targetColor = new THREE.Color();
  readonly #stoneColor = new THREE.Color();
  readonly #paperColor = new THREE.Color();

  constructor() {
    const destroyRef = inject(DestroyRef);
    // The canvas has a size once it's laid out, after the first render.
    afterNextRender(() => {
      const stop = this.#start();
      destroyRef.onDestroy(stop);
    });

    // A recut swaps the geometry; the material and the loop carry on.
    effect(() => {
      const cut = this.cut();
      const shell = this.#shell;
      const mosaic = this.#mosaic;
      const lines = this.#lines;
      if (!shell || !mosaic || !lines) return;
      const built = buildCut(cut);
      shell.geometry.dispose();
      shell.geometry = stoneGeometry(built.positions);
      mosaic.geometry.dispose();
      mosaic.geometry = mosaicGeometry(built.positions, this.#stoneColor);
      lines.geometry.dispose();
      lines.geometry = planGeometry(built.planEdges);
    });

    // A new stone: its color eases over (the loop moves it toward the
    // target, in step with the plate's 600ms background transition); its
    // optics switch at once.
    effect(() => {
      const gem = this.gem();
      this.#targetColor.set(this.color());
      const material = this.#material;
      if (!material) return;
      material.ior = gem.ior;
      material.dispersion = gem.dispersion * DISPERSION_GAIN;
      material.needsUpdate = true;
    });

    effect(() => this.#paperColor.set(this.paper()));
  }

  #start(): () => void {
    const canvas = this.canvas().nativeElement;
    const domCanvas = canvas as unknown as HTMLCanvasElement;
    // null where there's no WebGL (Lynx Explorer): the plate shows the
    // diagram on its own.
    if (!canvas.getContext('webgl2')) {
      this.ready.emit(false);
      return () => {};
    }

    const renderer = new THREE.WebGLRenderer({
      canvas: domCanvas,
      antialias: true,
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    const scene = new THREE.Scene();
    this.#stoneColor.copy(this.#targetColor);
    scene.background = new THREE.Color().copy(this.#stoneColor);

    // A jeweler's lamp: hard points of light in a dark room, so every facet
    // throws a sharp flash and the dispersion has edges to split into fire.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(lampRoom(), 0.02).texture;
    scene.environment = environment;
    pmrem.dispose();

    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
    camera.position.set(0, 2.5, 5.6);
    const target = new THREE.Vector3(0, -0.1, 0);
    camera.lookAt(target);

    // A key light that orbits slowly, so the fire moves while the stone rests.
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2, 4, 3);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.9);
    rim.position.set(-3, 1.5, -2);
    scene.add(rim);

    const gem = this.gem();
    const built = buildCut(this.cut());

    // The mosaic: the same facets, opaque, in the stone's tones, with a few
    // paper-bright ones for the flashes a pavilion throws.
    const mosaic = new THREE.Mesh(
      mosaicGeometry(built.positions, this.#stoneColor),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.3,
        metalness: 0.05,
        envMapIntensity: 0.6,
        flatShading: true,
      }),
    );
    mosaic.scale.setScalar(INNER_SCALE);
    this.#mosaic = mosaic;

    const material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 1,
      thickness: 1.2,
      ior: gem.ior,
      dispersion: gem.dispersion * DISPERSION_GAIN,
      roughness: 0.02,
      metalness: 0,
      clearcoat: 0.25,
      clearcoatRoughness: 0.05,
      specularIntensity: 1,
      envMapIntensity: 1.2,
      attenuationColor: this.#stoneColor.clone(),
      attenuationDistance: 1.6,
      flatShading: true,
    });
    this.#material = material;
    const shell = new THREE.Mesh(stoneGeometry(built.positions), material);
    this.#shell = shell;

    // The stone turns as one: the shell around its mosaic.
    const stone = new THREE.Group();
    stone.add(mosaic, shell);
    stone.rotation.x = 0.42;
    stone.scale.setScalar(1.12);
    scene.add(stone);

    // The cut diagram, lying behind the stone and facing the camera, so it
    // projects like the plate's flat map and the stone refracts it. It's
    // opaque (a blend of paper and stone) because three.js leaves
    // transparent objects out of what a transmissive material sees.
    const lines = new THREE.LineSegments(
      planGeometry(built.planEdges),
      new THREE.LineBasicMaterial({ color: 0xffffff }),
    );
    const plan = new THREE.Group();
    plan.add(lines);
    plan.quaternion.copy(camera.quaternion);
    const toCamera = camera.position.clone().sub(target).normalize();
    plan.position.copy(target).addScaledVector(toCamera, -PLAN_DEPTH);
    scene.add(plan);
    this.#lines = lines;
    const planDistance = camera.position.distanceTo(plan.position);

    // The canvas's size is its layout's; the drawing buffer follows it, and
    // the diagram keeps its on-screen width.
    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      const pxPerUnit =
        height / (2 * planDistance * Math.tan((camera.fov * Math.PI) / 360));
      plan.scale.setScalar(this.planWidth() / PLAN_UNITS / pxPerUnit);
    });
    resize.observe(domCanvas);

    const clock = new THREE.Clock();
    let idle = 0;
    let orbit = 0;
    const lineColor = new THREE.Color();
    const lastMosaicColor = new THREE.Color().copy(this.#stoneColor);
    renderer.setAnimationLoop(() => {
      const delta = Math.min(clock.getDelta(), 0.1);
      if (this.animate()) {
        idle += delta * 0.12;
        orbit += delta * (Math.PI / 3);
        key.position.set(3 * Math.cos(orbit), 4, 3 * Math.sin(orbit));
      }
      stone.rotation.y = this.spin() + idle;

      // Ease the color toward the chosen stone's.
      const k = 1 - Math.exp(-delta * 6);
      this.#stoneColor.lerp(this.#targetColor, k);
      (scene.background as THREE.Color).copy(this.#stoneColor);
      material.attenuationColor.copy(this.#stoneColor);
      lineColor.copy(this.#stoneColor).lerp(this.#paperColor, 0.42);
      (lines.material as THREE.LineBasicMaterial).color.copy(lineColor);
      // The mosaic's facets follow too, once the color has moved enough to
      // see: recoloring every facet each frame would be wasted work.
      if (!lastMosaicColor.equals(this.#stoneColor)) {
        const moved =
          Math.abs(lastMosaicColor.r - this.#stoneColor.r) +
          Math.abs(lastMosaicColor.g - this.#stoneColor.g) +
          Math.abs(lastMosaicColor.b - this.#stoneColor.b);
        if (moved > 0.01 || this.#stoneColor.equals(this.#targetColor)) {
          tintMosaic(mosaic.geometry, this.#stoneColor);
          lastMosaicColor.copy(this.#stoneColor);
        }
      }

      renderer.render(scene, camera);
    });
    this.ready.emit(true);

    return () => {
      renderer.setAnimationLoop(null);
      resize.disconnect();
      shell.geometry.dispose();
      mosaic.geometry.dispose();
      (mosaic.material as THREE.Material).dispose();
      lines.geometry.dispose();
      (lines.material as THREE.Material).dispose();
      material.dispose();
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      this.#shell = null;
      this.#mosaic = null;
      this.#lines = null;
      this.#material = null;
    };
  }
}

/**
 * The room the stone reflects: gray walls that light every facet, one soft
 * lamp overhead, and a few hard points that each facet throws back as a
 * flash, as a jeweler's bench is lit. Colors above 1 are the lamps'
 * brightness; PMREM keeps them as light.
 */
const lampRoom = (): THREE.Scene => {
  const room = new THREE.Scene();
  room.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(20, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0x4a4a4a, side: THREE.BackSide }),
    ),
  );
  const lamp = (
    x: number,
    y: number,
    z: number,
    radius: number,
    brightness: number,
    color = 0xffffff,
  ) => {
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 24, 16),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(brightness),
      }),
    );
    bulb.position.set(x, y, z);
    room.add(bulb);
  };
  lamp(-2, 9, -4, 1.4, 6);
  lamp(6, 4, 5, 0.5, 60);
  lamp(-7, 3, 4, 0.45, 60);
  lamp(4, -1, -7, 0.5, 40);
  lamp(-5, 6, -6, 0.8, 24, 0xfff0d2);
  lamp(7, -5, 2, 0.4, 30, 0xd8ecff);
  return room;
};

const stoneGeometry = (positions: Float32Array): THREE.BufferGeometry => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
};

/**
 * Each facet's share of the light, fixed per facet so the pattern holds as
 * the stone turns: most facets sit between a deep and a bright tone of the
 * stone, and about one in eight flashes paper-white.
 */
const facetTones = (facets: number): Float32Array => {
  const random = seeded(7);
  const tones = new Float32Array(facets);
  for (let i = 0; i < facets; i++) {
    const roll = random();
    tones[i] = roll < 0.07 ? 2 : 0.35 + random() * 0.95;
  }
  return tones;
};

const TONES = facetTones(2048);

/**
 * The mosaic's geometry: the cut's triangles with a color per facet.
 */
const mosaicGeometry = (
  positions: Float32Array,
  color: THREE.Color,
): THREE.BufferGeometry => {
  const geometry = stoneGeometry(positions);
  geometry.setAttribute(
    'color',
    new THREE.BufferAttribute(new Float32Array(positions.length), 3),
  );
  tintMosaic(geometry, color);
  return geometry;
};

const paperTone = new THREE.Color(0xfff6e6);
const facetColor = new THREE.Color();

/**
 * Recolors the mosaic's facets from the stone's color.
 */
const tintMosaic = (
  geometry: THREE.BufferGeometry,
  color: THREE.Color,
): void => {
  const colors = geometry.getAttribute('color') as THREE.BufferAttribute;
  const facets = colors.count / 3;
  for (let facet = 0; facet < facets; facet++) {
    const tone = TONES[facet % TONES.length]!;
    if (tone === 2) {
      facetColor.copy(color).lerp(paperTone, 0.7);
    } else {
      facetColor.copy(color).multiplyScalar(tone);
    }
    for (let v = 0; v < 3; v++) {
      colors.setXYZ(facet * 3 + v, facetColor.r, facetColor.g, facetColor.b);
    }
  }
  colors.needsUpdate = true;
};

/**
 * The plan's edges as line pairs on the diagram's plane: x across, z down.
 */
const planGeometry = (
  edges: readonly (readonly [number, number, number, number])[],
): THREE.BufferGeometry => {
  const positions = new Float32Array(edges.length * 6);
  edges.forEach(([x1, z1, x2, z2], i) => {
    positions.set([x1, -z1, 0, x2, -z2, 0], i * 6);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
};
