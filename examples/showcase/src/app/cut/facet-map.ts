import type { Cut } from '../data/gems';
import { buildCut, type PlanEdge } from './cut-geometry';

const cache = new Map<Cut, readonly PlanEdge[]>();

/** The crown's plan-view edges for a cut, built once per cut. */
export const planEdges = (cut: Cut): readonly PlanEdge[] => {
  let edges = cache.get(cut);
  if (!edges) {
    edges = buildCut(cut).planEdges;
    cache.set(cut, edges);
  }
  return edges;
};

/**
 * The cut diagram as an SVG string for `<svg content>`: the crown's facet
 * edges in one-pixel hairlines. It's what the plate shows where there's no
 * WebGL (Lynx Explorer), and what each lot's tile shows.
 */
export const facetMapSvg = (cut: Cut, size: number, stroke: string): string => {
  const scale = size / 2.4;
  const path = planEdges(cut)
    .map(
      ([x1, z1, x2, z2]) =>
        `M${(size / 2 + x1 * scale).toFixed(1)} ${(size / 2 + z1 * scale).toFixed(1)}L${(size / 2 + x2 * scale).toFixed(1)} ${(size / 2 + z2 * scale).toFixed(1)}`,
    )
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<path d="${path}" fill="none" stroke="${stroke}" stroke-width="1"/>` +
    `</svg>`
  );
};

/** The faceting machine's index gear: ninety-six teeth around the plate. */
export const INDEX_TEETH = 96;

/**
 * The index dial: a tick for each of the gear's teeth, longer every eighth,
 * where the figures sit.
 */
export const dialSvg = (size: number, stroke: string): string => {
  const c = size / 2;
  const outer = c - 1;
  let ticks = '';
  for (let i = 0; i < INDEX_TEETH; i++) {
    const angle = (i / INDEX_TEETH) * Math.PI * 2;
    const length = i % 8 === 0 ? 12 : i % 4 === 0 ? 7 : 4;
    const x1 = c + Math.cos(angle) * outer;
    const y1 = c + Math.sin(angle) * outer;
    const x2 = c + Math.cos(angle) * (outer - length);
    const y2 = c + Math.sin(angle) * (outer - length);
    ticks += `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<circle cx="${c}" cy="${c}" r="${outer}" fill="none" stroke="${stroke}" stroke-width="1"/>` +
    `<path d="${ticks}" fill="none" stroke="${stroke}" stroke-width="1"/>` +
    `</svg>`
  );
};

export type DialFigure = {
  readonly value: number;
  readonly x: number;
  readonly y: number;
  readonly rotate: string;
};

/**
 * Where the dial's figures go: every eighth tooth, inside the ticks, turned
 * to read along the rim as a gear's engraving does. `box` is each figure's
 * element size, which the position centers.
 */
export const dialFigures = (
  size: number,
  box: number,
): readonly DialFigure[] => {
  const c = size / 2;
  const radius = c - 24;
  return Array.from({ length: INDEX_TEETH / 8 }, (_, i) => {
    const angle = ((i * 8) / INDEX_TEETH) * Math.PI * 2;
    return {
      value: i * 8,
      x: c + Math.cos(angle) * radius - box / 2,
      y: c + Math.sin(angle) * radius - box / 2,
      rotate: `rotate(${((angle * 180) / Math.PI + 90).toFixed(1)}deg)`,
    };
  });
};
