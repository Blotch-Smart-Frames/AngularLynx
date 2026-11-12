// cspell:words tellurion slerp lerp
import * as THREE from 'three';
import { BODIES, type BodyId, PLANETS } from '../sky/bodies';
import { longitude, moonLongitude } from '../sky/ephemeris';
import {
  type Body3D,
  type Clock,
  type Maps,
  buildBody,
  rockyMaterial,
} from './bodies-3d';
import {
  RING_INNER,
  RING_OUTER,
  armGroup,
  brassMaterial,
  calendarRing,
  collarHeight,
  columnGroup,
  roomEnvironment,
} from './brass';
import { GALACTIC_CENTER, GALACTIC_POLE, axisFrame, spinAngle } from './frames';
import {
  SKY_FRAGMENT,
  SKY_VERTEX,
  STAR_FRAGMENT,
  STAR_VERTEX,
} from './shaders';

/** A body's place on screen, in layout pixels from the canvas's corner. */
export type Label = {
  readonly id: BodyId;
  readonly x: number;
  readonly y: number;
  /** Its radius on screen. */
  readonly r: number;
};

/** Where the camera is: what it looks at, from which way, how far. */
type Pose = { target: THREE.Vector3; dir: THREE.Vector3; dist: number };

/** The flight in to a planet and back out, in milliseconds. */
const FLIGHT_MS = 1400;
/** The view over the whole orrery: how high, how far, what it looks at. */
const SYSTEM_ELEVATION = 0.52;
const SYSTEM_DISTANCE = 13.2;
/** The outermost arm, plus room for its planet and its name. */
const SYSTEM_REACH = PLANETS[PLANETS.length - 1]!.arm + 0.55;
const SYSTEM_TARGET = new THREE.Vector3(0, -0.25, 0);
/** How close the camera comes to each body, in its radii. */
const CLOSE: Partial<Record<BodyId, number>> = { sun: 6, saturn: 8.4 };
const CLOSE_DEFAULT = 5;
/** The Moon's orbit around the Earth, on the orrery. */
const MOON_ARM = 0.34;
const MOON_RADIUS = 0.04;
/**
 * Over the whole machine the planets are drawn larger than in close, as
 * an orrery's are, so they read on a phone; they shrink to their own size
 * as the camera flies in.
 */
const MODEL_SCALE = 1.55;
/**
 * Where most of the Earth's city lights are, as longitude ranges (degrees
 * east): Europe and Africa's north, South and East Asia, the Americas.
 */
const CITY_LONGITUDES: readonly [number, number][] = [
  [-10, 45],
  [70, 145],
  [-125, -70],
];
/** Taps within this of a planet (layout pixels) pick it. */
const PICK_SLOP = 22;

const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/**
 * The orrery, drawn with three.js in a `<canvas>`. Every body's surface is
 * its own shader (see shaders.ts); the arms are brass reflecting a room.
 * The scene knows nothing of Angular: the component above it sets the
 * date, the focus and the drags, and hears back where the planets are on
 * screen, for their labels.
 */
export class OrreryScene {
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(46, 1, 0.01, 200);
  readonly #clock: Clock = { value: 0 };
  readonly #bodies = new Map<BodyId, Body3D>();
  readonly #arms = new Map<BodyId, THREE.Group>();
  readonly #orbits = new Map<BodyId, THREE.LineLoop>();
  readonly #brass: THREE.MeshStandardMaterial[] = [];
  /** The column and the calendar ring: the machine's fixed parts. */
  readonly #machine: THREE.Object3D[] = [];
  readonly #lines: THREE.LineBasicMaterial;
  readonly #moon: THREE.Group;
  readonly #moonGlobe: THREE.Mesh;
  readonly #moonArm: THREE.Group;
  readonly #stars: THREE.ShaderMaterial;
  readonly #onLabels: (labels: Label[]) => void;
  readonly #resize: ResizeObserver;

  #width = 1;
  #height = 1;
  #time = Date.now();
  #positionsDirty = true;
  #labelsDirty = true;
  #azimuth = 0;
  /** What the view over the machine looks at: the planets' middle. */
  readonly #systemTarget = SYSTEM_TARGET.clone();
  /** Until the first drag, the view faces wherever the planets gather. */
  #aimed = false;
  #elevation = SYSTEM_ELEVATION;
  #focus: BodyId | null = null;
  #selected: BodyId | null = null;
  #from: Pose | null = null;
  #flightStart = 0;
  /** How far in the camera is: 0 over the orrery, 1 at a planet. */
  #closeness = 0;
  #spin = 0;
  #motion = true;
  #started = performance.now();

  constructor(
    canvas: HTMLCanvasElement,
    maps: Maps,
    onLabels: (labels: Label[]) => void,
  ) {
    this.#onLabels = onLabels;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    this.#renderer = renderer;

    const environment = roomEnvironment(renderer);
    const brass = brassMaterial(environment);
    this.#brass.push(brass);

    // The Sun lights the brass too: a warm point at the center.
    const sunlight = new THREE.PointLight('#fff0dc', 2.2, 0, 0);
    this.#scene.add(
      sunlight,
      new THREE.HemisphereLight('#3b3346', '#120c08', 0.25),
    );

    this.#scene.add(this.#sky());
    this.#stars = this.#starMaterial();
    this.#scene.add(new THREE.Points(this.#starGeometry(), this.#stars));

    const column = columnGroup(brass);
    const ring = calendarRing(brass, RING_INNER, RING_OUTER);
    ring.position.y = collarHeight(PLANETS.length) - 0.05;
    this.#brass.push(ring.material as THREE.MeshStandardMaterial);
    this.#machine.push(column, ring);
    this.#scene.add(column, ring);

    this.#lines = new THREE.LineBasicMaterial({
      color: '#d9b36a',
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });

    for (const body of BODIES) {
      const built = buildBody(body, maps, this.#clock);
      built.axis.quaternion.copy(axisFrame(body));
      this.#bodies.set(body.id, built);
      this.#scene.add(built.root);
    }
    PLANETS.forEach((planet, index) => {
      const arm = armGroup(
        index,
        planet.arm,
        planet.radius * MODEL_SCALE,
        brass,
      );
      this.#arms.set(planet.id, arm);
      this.#scene.add(arm);
      const orbit = this.#orbit(planet.arm);
      this.#orbits.set(planet.id, orbit);
      this.#scene.add(orbit);
    });

    // The Moon, on a little arm of the Earth's: an orrery with one is a
    // tellurion.
    this.#moon = new THREE.Group();
    this.#moonGlobe = new THREE.Mesh(
      new THREE.SphereGeometry(MOON_RADIUS, 32, 24),
      rockyMaterial(maps.moon, [0, 0, 0]),
    );
    this.#moon.add(this.#moonGlobe);
    this.#moonArm = new THREE.Group();
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, MOON_ARM, 10),
      brass,
    );
    rod.rotation.z = Math.PI / 2;
    rod.position.set(MOON_ARM / 2, -0.17, 0);
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.13, 10),
      brass,
    );
    post.position.set(MOON_ARM, -0.105, 0);
    this.#moonArm.add(rod, post);
    this.#bodies.get('earth')!.root.add(this.#moon, this.#moonArm);

    this.#resize = new ResizeObserver(([entry]) => {
      if (!entry) return;
      this.#setSize(entry.contentRect.width, entry.contentRect.height);
    });
    this.#resize.observe(canvas);
    this.#setSize(canvas.clientWidth, canvas.clientHeight);

    renderer.setAnimationLoop(() => this.#frame());
  }

  /**
   * The moment shown, as a JavaScript time.
   */
  setTime(time: number): void {
    if (time === this.#time) return;
    this.#time = time;
    this.#positionsDirty = true;
  }

  /**
   * Flies in to a body, or back out over the orrery with null.
   */
  setFocus(id: BodyId | null, animate: boolean): void {
    if (id === this.#focus) return;
    this.#from = this.#pose();
    this.#flightStart = animate ? performance.now() : -FLIGHT_MS;
    this.#focus = id;
    if (id) this.#selected = id;
    this.#spin = 0;
    this.#updateOrbits();
  }

  /**
   * Idle motion: the boiling Sun, the drifting bands, the twinkle.
   */
  setMotion(on: boolean): void {
    this.#motion = on;
  }

  /**
   * A drag over the orrery turns the view round it, and tips it.
   */
  orbit(dx: number, dy: number): void {
    this.#aimed = true;
    this.#azimuth -= dx * 0.008;
    this.#elevation = Math.min(
      1.2,
      Math.max(0.18, this.#elevation + dy * 0.004),
    );
    this.#labelsDirty = true;
  }

  /**
   * A drag at a planet turns the planet under the finger.
   */
  spin(dx: number): void {
    this.#spin += dx * 0.012;
  }

  /**
   * The body under a tap, if any, in layout pixels from the corner.
   */
  pick(x: number, y: number): BodyId | null {
    if (this.#focus) return null;
    let best: BodyId | null = null;
    let bestDistance = Infinity;
    for (const label of this.#labels()) {
      const d = Math.hypot(label.x - x, label.y - y);
      if (d < label.r + PICK_SLOP && d < bestDistance) {
        best = label.id;
        bestDistance = d;
      }
    }
    return best;
  }

  dispose(): void {
    this.#renderer.setAnimationLoop(null);
    this.#resize.disconnect();
    this.#scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
    });
    this.#renderer.dispose();
  }

  #setSize(width: number, height: number): void {
    if (!width || !height) return;
    this.#width = width;
    this.#height = height;
    this.#renderer.setSize(width, height, false);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
    this.#stars.uniforms['uPixelRatio']!.value = this.#renderer.getPixelRatio();
    this.#labelsDirty = true;
  }

  #frame(): void {
    const now = performance.now();
    if (this.#motion) this.#clock.value = (now - this.#started) / 1000;
    if (this.#positionsDirty) this.#place();

    // The flight: from where the camera was, toward the pose it's after.
    const progress = Math.min(1, (now - this.#flightStart) / FLIGHT_MS);
    const eased = easeInOut(progress);
    const goal = this.#goal();
    const pose =
      this.#from && progress < 1 ? this.#blend(this.#from, goal, eased) : goal;
    const wanted = this.#focus ? 1 : 0;
    this.#closeness = progress < 1 ? (this.#focus ? eased : 1 - eased) : wanted;
    this.#apply(pose);
    this.#fadeMachine();
    // How far round the Sun its corona reaches, as the camera sees it: the
    // stars fade inside that.
    const sun = this.#bodies.get('sun')!.body;
    this.#stars.uniforms['uGlare']!.value = Math.atan(
      (sun.radius * 2.9) / Math.max(this.#camera.position.length(), 1e-3),
    );
    this.#scaleModels();
    if (progress < 1) this.#labelsDirty = true;

    this.#turnGlobes();
    this.#renderer.render(this.#scene, this.#camera);

    if (this.#labelsDirty) {
      this.#labelsDirty = false;
      this.#onLabels(this.#closeness > 0.02 ? [] : this.#labels());
    }
  }

  /**
   * Puts every planet where it is at the moment shown.
   */
  #place(): void {
    this.#positionsDirty = false;
    this.#labelsDirty = true;
    for (const planet of PLANETS) {
      const angle = longitude(planet.id, this.#time);
      const built = this.#bodies.get(planet.id)!;
      built.root.position.set(
        planet.arm * Math.cos(angle),
        0,
        -planet.arm * Math.sin(angle),
      );
      this.#arms.get(planet.id)!.rotation.y = angle;
    }
    if (!this.#aimed) this.#aim();
    const moon = moonLongitude(this.#time);
    this.#moon.position.set(
      MOON_ARM * Math.cos(moon),
      0,
      -MOON_ARM * Math.sin(moon),
    );
    this.#moonArm.rotation.y = moon;
    // The Moon keeps one face to the Earth.
    this.#moonGlobe.rotation.y = moon + Math.PI;

    // Saturn's shader needs its center and pole for the rings' shadow.
    const saturn = this.#bodies.get('saturn')!;
    const uniforms = (saturn.globe.material as THREE.ShaderMaterial).uniforms;
    saturn.root.updateMatrixWorld();
    uniforms['uCenter']!.value.setFromMatrixPosition(saturn.root.matrixWorld);
    uniforms['uPole']!.value.set(0, 1, 0).applyQuaternion(
      saturn.axis.quaternion,
    );
  }

  /**
   * Turns the view to face the side of the Sun where most planets are,
   * from a little round from behind the Sun, so they're seen lit, nearly
   * full, and spread across the frame: on any date, the machine opens with
   * its planets in view rather than behind the Sun or in their own night.
   */
  #aim(): void {
    let x = 0;
    let z = 0;
    const middle = new THREE.Vector3();
    for (const planet of PLANETS) {
      const position = this.#bodies.get(planet.id)!.root.position;
      x += position.x / planet.arm;
      z += position.z / planet.arm;
      middle.add(position);
    }
    this.#azimuth = Math.atan2(-x, -z) + 0.6;
    // Lean the view toward where they gather, a little, so they sit in the
    // middle of the frame rather than all along its top.
    middle.multiplyScalar(0.3 / PLANETS.length);
    this.#systemTarget.set(middle.x, SYSTEM_TARGET.y, middle.z);
  }

  /**
   * Each body turns on its axis at its own rate, for the moment shown.
   */
  #turnGlobes(): void {
    for (const [id, built] of this.#bodies) {
      const extra = id === this.#focus ? this.#spin : 0;
      built.globe.rotation.y =
        spinAngle(id, built.body.rotationHours, this.#time) + extra;
    }
  }

  /**
   * The pose the camera is heading for.
   */
  #goal(): Pose {
    const id = this.#focus;
    if (!id) {
      const dir = new THREE.Vector3(
        Math.cos(this.#elevation) * Math.sin(this.#azimuth),
        Math.sin(this.#elevation),
        Math.cos(this.#elevation) * Math.cos(this.#azimuth),
      );
      // Back far enough that Neptune's arm fits across the canvas at any
      // angle, whatever shape the canvas is (a phone, the docs' preview).
      const halfWidth = Math.atan(
        Math.tan(THREE.MathUtils.degToRad(this.#camera.fov / 2)) *
          this.#camera.aspect,
      );
      const dist = Math.max(
        SYSTEM_DISTANCE,
        SYSTEM_REACH / Math.tan(halfWidth),
      );
      return { target: this.#systemTarget.clone(), dir, dist };
    }
    const built = this.#bodies.get(id)!;
    const target = built.root.getWorldPosition(new THREE.Vector3());
    // Three-quarters lit: from the Sun's side, swung round to show the
    // terminator (and the Earth's city lights beyond it).
    const toSun =
      id === 'sun'
        ? new THREE.Vector3(Math.sin(this.#azimuth), 0, Math.cos(this.#azimuth))
        : target.clone().negate().setY(0).normalize();
    const dir = toSun.applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      id === 'sun' ? 0 : this.#swing(id, toSun),
    );
    dir.y = 0.22;
    dir.normalize();
    if (id === 'saturn') {
      // Above the rings' plane whatever their tilt this year, so they read
      // as rings: the planet's pole leans the view.
      const pole = new THREE.Vector3(0, 1, 0).applyQuaternion(
        built.axis.quaternion,
      );
      // From the side the Sun lights, so the rings are seen lit.
      if (pole.dot(target) > 0) pole.negate();
      dir.addScaledVector(pole, -dir.dot(pole)).normalize();
      dir
        .multiplyScalar(Math.cos(0.5))
        .addScaledVector(pole, Math.sin(0.5))
        .normalize();
    }
    const dist = built.body.radius * (CLOSE[id] ?? CLOSE_DEFAULT);
    return { target, dir, dist };
  }

  /**
   * Which way round to swing from the Sun's side: toward the evening
   * terminator or the morning one. Either shows the body three-quarters
   * lit; for the Earth, the side whose night edge falls on a lit-up
   * continent (Europe and Africa, South and East Asia, the Americas) wins,
   * so its city lights show, wherever the dial has turned it.
   */
  #swing(id: BodyId, toSun: THREE.Vector3): number {
    if (id !== 'earth') return 1.0;
    const globe = this.#bodies.get('earth')!.globe;
    globe.updateMatrixWorld();
    const toLocal = new THREE.Quaternion()
      .setFromRotationMatrix(globe.matrixWorld)
      .invert();
    const up = new THREE.Vector3(0, 1, 0);
    const score = (sign: number) => {
      // A little past the terminator, on the night side the camera sees.
      const night = toSun
        .clone()
        .applyAxisAngle(up, sign * (Math.PI / 2 + 0.45))
        .applyQuaternion(toLocal);
      const lon = THREE.MathUtils.radToDeg(Math.atan2(-night.z, night.x));
      return CITY_LONGITUDES.some(([from, to]) => lon >= from && lon <= to)
        ? 1
        : 0;
    };
    return score(1) >= score(-1) ? 1.0 : -1.0;
  }

  /**
   * Between two poses: the direction swings, the distance zooms evenly.
   */
  #blend(a: Pose, b: Pose, t: number): Pose {
    const qa = new THREE.Quaternion();
    const qb = new THREE.Quaternion().setFromUnitVectors(a.dir, b.dir);
    const dir = a.dir.clone().applyQuaternion(qa.slerp(qb, t));
    const dist = Math.exp(Math.log(a.dist) * (1 - t) + Math.log(b.dist) * t);
    return { target: a.target.clone().lerp(b.target, t), dir, dist };
  }

  #pose(): Pose {
    const target = this.#cameraTarget.clone();
    const offset = this.#camera.position.clone().sub(target);
    return {
      target,
      dir: offset.clone().normalize(),
      dist: offset.length() || SYSTEM_DISTANCE,
    };
  }

  #cameraTarget = SYSTEM_TARGET.clone();

  #apply(pose: Pose): void {
    this.#cameraTarget.copy(pose.target);
    this.#camera.position
      .copy(pose.target)
      .addScaledVector(pose.dir, pose.dist);
    this.#camera.near = Math.max(0.005, pose.dist * 0.02);
    this.#camera.updateProjectionMatrix();
    this.#camera.lookAt(pose.target);
  }

  /**
   * In close, the brass and the orbits fall away and the world is real.
   */
  #fadeMachine(): void {
    const opacity = 1 - Math.min(1, this.#closeness / 0.6);
    for (const material of this.#brass) {
      material.transparent = opacity < 1;
      material.opacity = opacity;
      material.depthWrite = opacity > 0.5;
    }
    this.#lines.opacity = 0.34 * opacity;
    const visible = opacity > 0.01;
    for (const arm of this.#arms.values()) arm.visible = visible;
    for (const orbit of this.#orbits.values()) orbit.visible = visible;
    this.#moonArm.visible = visible;
    for (const part of this.#machine) part.visible = visible;
    // The Moon too: on the model it rides a few Earth-widths away, which
    // close up would loom like a second planet.
    this.#moon.visible = visible;
  }

  /**
   * The planets' model scale, and, close in, only the body flown to (with
   * the Earth's Moon): the others would loom over its shoulder at the
   * model's distances, which the real sky never shows.
   */
  #scaleModels(): void {
    const scale = MODEL_SCALE - (MODEL_SCALE - 1) * this.#closeness;
    for (const [id, built] of this.#bodies) {
      if (id !== 'sun') built.root.scale.setScalar(scale);
      built.root.visible = this.#closeness < 0.5 || id === this.#focus;
    }
    const saturn = this.#bodies.get('saturn')!;
    const uniforms = (saturn.globe.material as THREE.ShaderMaterial).uniforms;
    uniforms['uRadius']!.value = saturn.body.radius * scale;
  }

  /**
   * The chosen planet's orbit is a double rule; the others, single.
   */
  #updateOrbits(): void {
    for (const [id, orbit] of this.#orbits) {
      const twin = orbit.children[0];
      if (twin) twin.visible = id === this.#selected;
    }
  }

  #labels(): Label[] {
    const labels: Label[] = [];
    const point = new THREE.Vector3();
    const edge = new THREE.Vector3();
    const right = new THREE.Vector3().setFromMatrixColumn(
      this.#camera.matrixWorld,
      0,
    );
    this.#camera.updateMatrixWorld();
    for (const [id, built] of this.#bodies) {
      built.root.getWorldPosition(point);
      edge
        .copy(point)
        .addScaledVector(right, built.body.radius * built.root.scale.x);
      point.project(this.#camera);
      edge.project(this.#camera);
      if (point.z > 1) continue;
      const x = ((point.x + 1) / 2) * this.#width;
      const y = ((1 - point.y) / 2) * this.#height;
      const r = Math.abs(((edge.x + 1) / 2) * this.#width - x);
      labels.push({ id, x, y, r });
    }
    return labels;
  }

  #orbit(radius: number): THREE.LineLoop {
    const points: THREE.Vector3[] = [];
    const twinPoints: THREE.Vector3[] = [];
    for (let i = 0; i < 256; i++) {
      const a = (i / 256) * Math.PI * 2;
      points.push(
        new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius),
      );
      twinPoints.push(
        new THREE.Vector3(
          Math.cos(a) * (radius + 0.035),
          0,
          Math.sin(a) * (radius + 0.035),
        ),
      );
    }
    const loop = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      this.#lines,
    );
    const twin = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(twinPoints),
      this.#lines,
    );
    twin.visible = false;
    loop.add(twin);
    return loop;
  }

  #sky(): THREE.Mesh {
    const material = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      uniforms: {
        uGalacticPole: { value: GALACTIC_POLE },
        uGalacticCenter: { value: GALACTIC_CENTER },
      },
      side: THREE.BackSide,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
    sky.frustumCulled = false;
    sky.renderOrder = -2;
    return sky;
  }

  #starMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: {
        uTime: this.#clock,
        uPixelRatio: { value: 1 },
        uSun: { value: new THREE.Vector3() },
        uGlare: { value: 0 },
      },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
  }

  /**
   * Two thousand stars, thicker toward the Milky Way, a few bright ones,
   * colored from red giants to blue-white. Random but seeded, so the sky
   * is the same every launch.
   */
  #starGeometry(): THREE.BufferGeometry {
    let seed = 7;
    const random = () =>
      ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const count = 2000;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const tints = [
      [1.0, 0.72, 0.5],
      [1.0, 0.88, 0.72],
      [1.0, 0.97, 0.92],
      [0.85, 0.9, 1.0],
      [0.7, 0.8, 1.0],
    ];
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      // Half the stars hug the galactic plane.
      do {
        v.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
      } while (v.lengthSq() > 1 || v.lengthSq() < 0.01);
      v.normalize();
      if (i % 2 === 0) {
        v.addScaledVector(
          GALACTIC_POLE,
          -v.dot(GALACTIC_POLE) * 0.85,
        ).normalize();
      }
      positions.set([v.x, v.y, v.z], i * 3);
      const magnitude = random() ** 6;
      // Faint: a phone's sky shows pinpricks, and no star may rival a planet.
      sizes[i] = 0.9 + magnitude * 1.7;
      const tint = tints[Math.floor(random() * tints.length)]!;
      const brightness = 0.18 + magnitude * 0.9;
      colors.set(
        tint.map((c) => c * brightness),
        i * 3,
      );
      phases[i] = random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return geometry;
  }
}
