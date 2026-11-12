import { PLANETS } from '../sky/bodies';
import { longitude } from '../sky/ephemeris';

/**
 * The orrery seen from directly above, as an engraved plan: brass orbits
 * and arms, each planet a disc at its longitude for the moment shown. The
 * fallback where there's no canvas (Lynx Explorer), so it's plain SVG.
 * Colors are written out: `<svg>` can't read CSS variables.
 */
export const planSvg = (time: number, size: number): string => {
  const c = size / 2;
  const scale = (c - 12) / PLANETS[PLANETS.length - 1]!.arm;
  const parts: string[] = [
    `<circle cx="${c}" cy="${c}" r="${(0.46 * scale).toFixed(1)}" fill="#f2a43a"/>`,
  ];
  for (const planet of PLANETS) {
    const r = planet.arm * scale;
    const a = longitude(planet.id, time);
    const x = c + r * Math.cos(a);
    const y = c - r * Math.sin(a);
    parts.push(
      `<circle cx="${c}" cy="${c}" r="${r.toFixed(1)}" fill="none" stroke="#c49a4a" stroke-opacity="0.45" stroke-width="0.75"/>`,
      `<line x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#c49a4a" stroke-width="1"/>`,
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${Math.max(3, planet.radius * scale).toFixed(1)}" fill="${planColor[planet.id]}"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${parts.join('')}</svg>`;
};

const planColor: Record<string, string> = {
  mercury: '#9c958c',
  venus: '#e6d3a8',
  earth: '#4a7fc0',
  mars: '#c0643a',
  jupiter: '#d2b48c',
  saturn: '#e3cf9c',
  uranus: '#a9dbe0',
  neptune: '#4467d0',
};
