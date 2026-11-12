import brushedBrass from '../../assets/materials/brushed-brass.jpg';
import mahogany from '../../assets/materials/mahogany.jpg';

/**
 * The case's rasters, as `background-image` values to bind on an element.
 * Bound rather than written in styles.css: a `url()` there drew
 * nothing on iOS, where the same file bound inline draws (see
 * investigations/lynx-vs-web-differences.md). The classes in styles.css
 * keep the bevels and the fallback colors.
 */
export const BRUSHED_BRASS = `url(${brushedBrass})`;
export const MAHOGANY = `url(${mahogany})`;
