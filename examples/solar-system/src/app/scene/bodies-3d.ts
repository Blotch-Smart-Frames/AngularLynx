// cspell:words metalness
import * as THREE from 'three';
import type { Body } from '../sky/bodies';
import {
  BILLBOARD_VERTEX,
  BODY_VERTEX,
  CORONA_FRAGMENT,
  EARTH_FRAGMENT,
  GIANT_FRAGMENT,
  HALO_FRAGMENT,
  RING_FRAGMENT,
  RING_VERTEX,
  ROCKY_FRAGMENT,
  SUN_FRAGMENT,
} from './shaders';

/** The maps the rocky worlds wear; anything missing is drawn plain. */
export type Maps = {
  readonly earthDay: THREE.Texture;
  readonly earthNight: THREE.Texture;
  readonly earthClouds: THREE.Texture | null;
  readonly moon: THREE.Texture;
  readonly mars: THREE.Texture;
  readonly mercury: THREE.Texture;
};

/** Uniforms every frame moves: the clock, and Saturn's place for its rings. */
export type Clock = { value: number };

/** Light the night side gets from the stars and the planet's own glow. */
const AMBIENT = 0.012;

/**
 * Each giant's palette and weather. Colors are sRGB, from spacecraft
 * images (Juno, Cassini, Voyager 2) rather than the textbook orange.
 */
const GIANTS: Record<string, GiantLook> = {
  jupiter: {
    zone: '#efe4cf',
    belt: '#a66b45',
    accent: '#d9b48c',
    polar: '#7d7a74',
    bands: 26,
    contrast: 1,
    warp: 1.1,
    wind: 0.05,
    // The Great Red Spot: 22° south, about 16,000 km across.
    storm: [-22 * (Math.PI / 180), 1.2, 0.11, 1],
    stormColor: '#c0603a',
    haze: [0.05, 0.04, 0.03],
  },
  saturn: {
    zone: '#ecdcb6',
    belt: '#c4a36f',
    accent: '#e3cc9a',
    polar: '#9fa6a0',
    bands: 30,
    contrast: 0.55,
    warp: 0.6,
    wind: 0.04,
    storm: [0, 0, 0, 0],
    stormColor: '#ffffff',
    haze: [0.05, 0.045, 0.03],
  },
  uranus: {
    zone: '#bfe6ea',
    belt: '#9ccfd8',
    accent: '#d4f0f0',
    polar: '#d6f1f0',
    bands: 14,
    contrast: 0.22,
    warp: 0.4,
    wind: 0.02,
    storm: [0, 0, 0, 0],
    stormColor: '#ffffff',
    haze: [0.04, 0.07, 0.08],
  },
  neptune: {
    zone: '#4f78e0',
    belt: '#2c4fb8',
    accent: '#a8c4ff',
    polar: '#3b5fc8',
    bands: 16,
    contrast: 0.65,
    warp: 1.3,
    wind: 0.06,
    // A dark spot, as Voyager 2 saw in 1989 and Hubble has since.
    storm: [-20 * (Math.PI / 180), 2.4, 0.09, 0.9],
    stormColor: '#1d2f7a',
    haze: [0.03, 0.05, 0.12],
  },
  // Venus: thick sulfuric acid cloud, almost featureless to the eye, swept
  // around in four days by the super-rotation.
  venus: {
    zone: '#f2e3c2',
    belt: '#d8bf8e',
    accent: '#f8eed8',
    polar: '#e8d9b8',
    bands: 6,
    contrast: 0.45,
    warp: 2.4,
    wind: 0.03,
    storm: [0, 0, 0, 0],
    stormColor: '#ffffff',
    haze: [0.12, 0.1, 0.07],
  },
};

type GiantLook = {
  zone: string;
  belt: string;
  accent: string;
  polar: string;
  bands: number;
  contrast: number;
  warp: number;
  wind: number;
  /** Latitude and longitude (radians), size, strength. */
  storm: [number, number, number, number];
  stormColor: string;
  haze: [number, number, number];
};

const color = (hex: string) =>
  new THREE.Color().setStyle(hex, THREE.NoColorSpace);

/** One body: its axis (tilted, fixed), the turning globe, and extras. */
export type Body3D = {
  readonly body: Body;
  /** Moves with the body; holds the axis. */
  readonly root: THREE.Group;
  /** Tilted to the body's pole; doesn't turn. */
  readonly axis: THREE.Group;
  /** The globe, turning about the axis. */
  readonly globe: THREE.Mesh;
  readonly materials: THREE.Material[];
};

const SPHERE = new THREE.SphereGeometry(1, 96, 64);
const SMALL_SPHERE = new THREE.SphereGeometry(1, 48, 32);

export const buildBody = (body: Body, maps: Maps, clock: Clock): Body3D => {
  const root = new THREE.Group();
  root.name = body.id;
  const axis = new THREE.Group();
  root.add(axis);
  const materials: THREE.Material[] = [];

  const material = surfaceMaterial(body, maps, clock);
  materials.push(material);
  const globe = new THREE.Mesh(
    body.radius < 0.1 ? SMALL_SPHERE : SPHERE,
    material,
  );
  globe.scale.setScalar(body.radius);
  axis.add(globe);

  const halo = haloColor(body.id);
  if (halo) {
    const glow = new THREE.ShaderMaterial({
      vertexShader: BODY_VERTEX,
      fragmentShader: HALO_FRAGMENT,
      uniforms: {
        uColor: { value: new THREE.Vector3(...halo[0]) },
        uEdge: { value: Math.sqrt(1 - 1 / (halo[1] * halo[1])) },
      },
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    materials.push(glow);
    const shell = new THREE.Mesh(SMALL_SPHERE, glow);
    shell.scale.setScalar(body.radius * halo[1]);
    axis.add(shell);
  }

  if (body.id === 'sun') {
    // The corona: a camera-facing square four Sun-radii across.
    const size = 2.9;
    const corona = new THREE.ShaderMaterial({
      vertexShader: BILLBOARD_VERTEX,
      fragmentShader: CORONA_FRAGMENT,
      uniforms: {
        uTime: clock,
        uInner: { value: 1 / size },
        uStrength: { value: 0.7 },
      },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    materials.push(corona);
    const square = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), corona);
    square.scale.setScalar(body.radius * size);
    square.frustumCulled = false;
    root.add(square);
  }

  if (body.id === 'saturn') {
    const rings = ringMesh(body, material as THREE.ShaderMaterial);
    materials.push(rings.material as THREE.Material);
    axis.add(rings);
  }

  return { body, root, axis, globe, materials };
};

/**
 * Air glow color and the shell's size, by planet.
 */
const haloColor = (id: string): [[number, number, number], number] | null => {
  switch (id) {
    case 'earth':
      return [[0.25, 0.5, 1.2], 1.045];
    case 'venus':
      return [[0.9, 0.75, 0.45], 1.05];
    case 'mars':
      return [[0.7, 0.42, 0.28], 1.025];
    case 'jupiter':
      return [[0.14, 0.12, 0.08], 1.02];
    case 'saturn':
      return [[0.14, 0.12, 0.08], 1.02];
    case 'uranus':
      return [[0.07, 0.15, 0.17], 1.07];
    case 'neptune':
      return [[0.06, 0.1, 0.3], 1.07];
    default:
      return null;
  }
};

const surfaceMaterial = (
  body: Body,
  maps: Maps,
  clock: Clock,
): THREE.ShaderMaterial => {
  const ambient = { value: AMBIENT };
  switch (body.surface) {
    case 'sun':
      return new THREE.ShaderMaterial({
        vertexShader: BODY_VERTEX,
        fragmentShader: SUN_FRAGMENT,
        uniforms: { uTime: clock },
      });
    case 'earth':
      return new THREE.ShaderMaterial({
        vertexShader: BODY_VERTEX,
        fragmentShader: EARTH_FRAGMENT,
        uniforms: {
          uDay: { value: maps.earthDay },
          uNight: { value: maps.earthNight },
          uClouds: { value: maps.earthClouds ?? maps.earthNight },
          uHasClouds: { value: maps.earthClouds ? 1 : 0 },
          uTime: clock,
          uAmbient: ambient,
        },
      });
    case 'rocky':
      return rockyMaterial(
        body.id === 'mars' ? maps.mars : maps.mercury,
        body.id === 'mars' ? [0.5, 0.28, 0.18] : [0, 0, 0],
      );
    default: {
      const look = GIANTS[body.id]!;
      return new THREE.ShaderMaterial({
        vertexShader: BODY_VERTEX,
        fragmentShader: GIANT_FRAGMENT,
        uniforms: {
          uTime: clock,
          uZone: { value: color(look.zone) },
          uBelt: { value: color(look.belt) },
          uAccent: { value: color(look.accent) },
          uPolar: { value: color(look.polar) },
          uBands: { value: look.bands },
          uContrast: { value: look.contrast },
          uWarp: { value: look.warp },
          uWind: { value: look.wind },
          uStorm: { value: new THREE.Vector4(...look.storm) },
          uStormColor: { value: color(look.stormColor) },
          uHaze: { value: new THREE.Vector3(...look.haze) },
          uRings: { value: body.id === 'saturn' ? 1 : 0 },
          uCenter: { value: new THREE.Vector3() },
          uPole: { value: new THREE.Vector3(0, 1, 0) },
          uRadius: { value: body.radius },
          uAmbient: ambient,
        },
      });
    }
  }
};

export const rockyMaterial = (
  map: THREE.Texture,
  atmosphere: [number, number, number],
): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    vertexShader: BODY_VERTEX,
    fragmentShader: ROCKY_FRAGMENT,
    uniforms: {
      uMap: { value: map },
      uAtmosphere: { value: new THREE.Vector3(...atmosphere) },
      uAmbient: { value: AMBIENT },
    },
  });

/**
 * Saturn's rings, out to 2.3 Saturn radii, in the planet's equator. They
 * share their center, pole and radius uniforms with the planet's shader,
 * which needs them for the rings' shadow; the scene sets them each frame.
 */
const ringMesh = (body: Body, planet: THREE.ShaderMaterial): THREE.Mesh => {
  const geometry = new THREE.RingGeometry(
    body.radius * 1.2,
    body.radius * 2.3,
    192,
    1,
  );
  // RingGeometry lies in x-y; the equator is x-z.
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    vertexShader: RING_VERTEX,
    fragmentShader: RING_FRAGMENT,
    uniforms: {
      uCenter: planet.uniforms['uCenter']!,
      uPole: planet.uniforms['uPole']!,
      uRadius: planet.uniforms['uRadius']!,
      uPlanetRadius: { value: body.radius },
      uAmbient: { value: 0.02 },
    },
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });
  return new THREE.Mesh(geometry, material);
};
