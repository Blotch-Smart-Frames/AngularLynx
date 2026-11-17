/**
 * The corner radius for a shape nested `inset` px inside a shape whose corner
 * radius is `outerRadius`, so that the two corners share a center and the gap
 * between them stays the same width all the way round. Apple calls this
 * concentricity, and Liquid Glass relies on it: a button inset 8px in a glass
 * panel with 24px corners gets 16px corners.
 *
 * It never goes below 0: a shape inset further than the outer radius has
 * square corners. Capsules and circles need no helper, because a capsule
 * inset evenly inside a capsule is a capsule (`shape="capsule"`).
 *
 * ```ts
 * readonly innerRadius = computed(() => concentricRadius(this.radius(), 8));
 * ```
 */
export const concentricRadius = (outerRadius: number, inset: number): number =>
  Math.max(0, outerRadius - inset);
