// cspell:words obliquity
import * as THREE from 'three';
import { type Body, type BodyId } from '../sky/bodies';
import { daysSinceJ2000 } from '../sky/ephemeris';

const RAD = Math.PI / 180;
/** The tilt of Earth's equator to the ecliptic at J2000. */
const OBLIQUITY = 23.43928 * RAD;

/**
 * The scene's axes: the ecliptic plane is the floor (x, z), north is up
 * (y). An ecliptic vector (x toward the March equinox, z north) lands at
 * (x, z, -y), so longitudes run anticlockwise seen from above, as they do
 * in the sky.
 */
export const fromEcliptic = (x: number, y: number, z: number): THREE.Vector3 =>
  new THREE.Vector3(x, z, -y);

/** A direction on the sky (J2000 right ascension and declination). */
export const fromSky = (ra: number, dec: number): THREE.Vector3 => {
  const [a, d] = [ra * RAD, dec * RAD];
  const x = Math.cos(d) * Math.cos(a);
  const y = Math.cos(d) * Math.sin(a);
  const z = Math.sin(d);
  // Equatorial to ecliptic: a turn about the equinox by the obliquity.
  return fromEcliptic(
    x,
    Math.cos(OBLIQUITY) * y + Math.sin(OBLIQUITY) * z,
    -Math.sin(OBLIQUITY) * y + Math.cos(OBLIQUITY) * z,
  ).normalize();
};

/** The celestial north pole, in the scene. */
const CELESTIAL_POLE = fromSky(0, 90);

/**
 * A body's axis, as a rotation that takes its local frame (y its north pole,
 * x its prime meridian before it turns) into the scene. The meridian starts
 * at the node of its equator on Earth's, as the IAU's do.
 */
export const axisFrame = (body: Body): THREE.Quaternion => {
  const pole = fromSky(...body.pole);
  const node = new THREE.Vector3().crossVectors(CELESTIAL_POLE, pole);
  // The Earth's own pole is the celestial one: its node is the equinox.
  if (node.lengthSq() < 1e-8) node.set(1, 0, 0);
  node.normalize();
  const third = new THREE.Vector3().crossVectors(node, pole);
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(node, pole, third),
  );
};

/**
 * How far a body has turned at a moment (radians, eastward). The IAU's
 * formulas for the Sun, Mercury, Earth and Mars, whose maps have a prime
 * meridian to line up; the giants' surfaces are noise, so their rate is
 * enough. Earth's is sidereal time, so the right side of it is in daylight.
 */
export const spinAngle = (
  id: BodyId,
  rotationHours: number,
  time: number,
): number => {
  const d = daysSinceJ2000(time);
  switch (id) {
    case 'sun':
      return (84.176 + 14.1844 * d) * RAD;
    case 'mercury':
      return (329.5988 + 6.1385108 * d) * RAD;
    case 'earth':
      return (280.46061837 + 360.98564736629 * d) * RAD;
    case 'mars':
      return (176.63 + 350.89198226 * d) * RAD;
    default:
      return ((360 * 24 * d) / rotationHours) * RAD;
  }
};

/** Where the galaxy lies: its north pole and its center, in the scene. */
export const GALACTIC_POLE = fromSky(192.85948, 27.12825);
export const GALACTIC_CENTER = fromSky(266.405, -28.936);
