// cspell:words metalness PMREM texels
import * as THREE from 'three';
import { PLANETS } from '../sky/bodies';

/** Turned brass: the orrery's metal, lit by the room and by the Sun. */
export const brassMaterial = (
  environment: THREE.Texture,
): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({
    color: '#c49a4a',
    metalness: 1,
    roughness: 0.34,
    envMap: environment,
    envMapIntensity: 1.15,
  });

/**
 * The room the orrery stands in, for the brass to reflect: dark walls, a
 * tall warm window to one side and a dim lamp on the other. A metal shows
 * only what's around it, so this is what makes brass read as brass.
 */
export const roomEnvironment = (
  renderer: THREE.WebGLRenderer,
): THREE.Texture => {
  const room = new THREE.Scene();
  room.background = new THREE.Color('#0b0806');
  const panel = (
    color: string,
    intensity: number,
    w: number,
    h: number,
    at: THREE.Vector3,
  ) => {
    const material = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
    });
    material.color.multiplyScalar(intensity);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    mesh.position.copy(at);
    mesh.lookAt(0, 0, 0);
    room.add(mesh);
  };
  panel('#ffd9a8', 3.2, 3, 5, new THREE.Vector3(-6, 3, 2));
  panel('#ffb36b', 1.4, 2, 2, new THREE.Vector3(5, 2, -4));
  panel('#6d4a2e', 0.6, 14, 4, new THREE.Vector3(0, -5, 0));
  panel('#2a2018', 0.5, 12, 4, new THREE.Vector3(0, 6, 0));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();
  return texture;
};

/** Below the Sun, the column every arm turns on, and how far down. */
export const COLUMN_TOP = -0.44;
export const COLUMN_BOTTOM = -1.45;
/** Each arm's collar on the column: the first planet's highest. */
export const collarHeight = (index: number) => -0.66 - index * 0.07;

/**
 * One arm: a collar on the column, a rod out to the planet's distance, an
 * elbow, and a post up to the planet's cup. Built along +x; the scene turns
 * the group to the planet's longitude.
 */
export const armGroup = (
  index: number,
  length: number,
  radius: number,
  brass: THREE.Material,
): THREE.Group => {
  const group = new THREE.Group();
  const y = collarHeight(index);
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.11, 0.055, 40),
    brass,
  );
  collar.position.y = y;
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.032, length, 16),
    brass,
  );
  rod.rotation.z = Math.PI / 2;
  rod.position.set(length / 2, y, 0);
  const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.05, 20, 14), brass);
  elbow.position.set(length, y, 0);
  const postHeight = -radius * 1.02 - y;
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.026, 0.026, postHeight, 14),
    brass,
  );
  post.position.set(length, y + postHeight / 2, 0);
  // A little cup the planet sits in, as on a real orrery.
  const cup = new THREE.Mesh(
    new THREE.SphereGeometry(
      Math.max(0.03, radius * 0.38),
      20,
      8,
      0,
      Math.PI * 2,
      Math.PI * 0.62,
      Math.PI * 0.38,
    ),
    brass,
  );
  cup.position.set(length, -radius * 0.82, 0);
  group.add(collar, rod, elbow, post, cup);
  return group;
};

/** The column and its foot. */
export const columnGroup = (brass: THREE.Material): THREE.Group => {
  const group = new THREE.Group();
  const height = COLUMN_TOP - COLUMN_BOTTOM;
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.09, height, 32),
    brass,
  );
  column.position.y = COLUMN_BOTTOM + height / 2;
  const foot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.42, 0.08, 48),
    brass,
  );
  foot.position.y = COLUMN_BOTTOM - 0.02;
  const boss = new THREE.Mesh(
    new THREE.TorusGeometry(0.33, 0.025, 10, 64),
    brass,
  );
  boss.rotation.x = Math.PI / 2;
  boss.position.y = COLUMN_BOTTOM + 0.02;
  group.add(column, foot, boss);
  return group;
};

/**
 * The calendar ring around the whole machine: a flat band engraved with a
 * degree scale of heliocentric longitude, every degree, every fifth, every
 * thirtieth deeper. A real orrery's ring carries the months; here the arms
 * pointing at it read off where in the sky each planet is.
 */
export const calendarRing = (
  brass: THREE.MeshStandardMaterial,
  inner: number,
  outer: number,
): THREE.Mesh => {
  const segments = 360;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const [c, s] = [Math.cos(a), -Math.sin(a)];
    positions.push(c * inner, 0, s * inner, c * outer, 0, s * outer);
    uvs.push(i / segments, 0, i / segments, 1);
    if (i < segments) {
      const k = i * 2;
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = brass.clone();
  material.map = engravingTexture();
  material.side = THREE.DoubleSide;
  return new THREE.Mesh(geometry, material);
};

/**
 * The engraving as a texture: white where the brass is untouched, dark in
 * the cuts, so it multiplies into the metal's color. Drawn in code, since
 * there's no 2D canvas to draw it with.
 */
const engravingTexture = (): THREE.DataTexture => {
  const width = 2160;
  const height = 32;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const r = y / (height - 1);
    for (let x = 0; x < width; x++) {
      // Six texels to a degree: ticks a texel wide.
      const sub = x % 6;
      const degree = Math.floor(x / 6);
      const onTick = sub === 0;
      let cut = false;
      if (onTick) {
        if (degree % 30 === 0) cut = r > 0.12 && r < 0.9;
        else if (degree % 5 === 0) cut = r > 0.42 && r < 0.9;
        else cut = r > 0.62 && r < 0.9;
      }
      // Two rules run round the band.
      if (y === 30 || y === 2) cut = true;
      const value = cut ? 70 : 255;
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, width, height);
  texture.wrapS = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
};

/** The outermost arm's reach, plus room for the calendar ring. */
export const RING_INNER = PLANETS[PLANETS.length - 1]!.arm + 0.42;
export const RING_OUTER = RING_INNER + 0.32;
