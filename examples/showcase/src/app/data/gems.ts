// cspell:words Mohs Baja Batalha Tanzanite Tsavo Paraíba Paraiba Padparadscha Ratnapura Sabaragamuwa Merelani Manyara Loliondo Arusha Muzo Boyacá Mogok Kunzite Nuristan Tsavorite Taita Taveta Sphene Titanite Malysheva Elbaite cuprian spodumene chrysoberyl grossular spessartine zoisite

/** A cut the stone can be shown in: the geometry the plate and the 3D stone share. */
export type Cut = 'brilliant' | 'oval' | 'cushion' | 'step';

export type CutInfo = {
  readonly id: Cut;
  readonly name: string;
};

export const CUTS: readonly CutInfo[] = [
  { id: 'brilliant', name: 'Round brilliant' },
  { id: 'oval', name: 'Oval brilliant' },
  { id: 'cushion', name: 'Cushion' },
  { id: 'step', name: 'Emerald step' },
];

export type Gem = {
  readonly id: string;
  readonly name: string;
  readonly species: string;
  readonly formula: string;
  /** The stone's color, which the whole app takes. */
  readonly color: string;
  /** For a color-change stone, its color under lamplight (the app's night scheme). */
  readonly nightColor?: string;
  /** Refractive index, the midpoint of the species' range. */
  readonly ior: number;
  /** Dispersion (B–G interval): how much fire the stone throws. */
  readonly dispersion: number;
  /** Mohs hardness, as a range. */
  readonly hardness: readonly [number, number];
  readonly origin: string;
  readonly locality: string;
  /** One true thing about the stone, for its sheet. */
  readonly note: string;
  /** The cut the stone is shown in until the visitor cuts it again. */
  readonly cut: Cut;
  /**
   * Illustrative: a plausible price per carat, in USD, for a fine stone. It
   * seeds the market's series and the lots' prices, and the app says so.
   */
  readonly pricePerCarat: number;
};

/**
 * Ten stones a jeweler would be proud to carry. Species, formula, refractive
 * index, dispersion, hardness and origin are reference gemology; the price per
 * carat is illustrative.
 */
export const GEMS: readonly Gem[] = [
  {
    id: 'paraiba',
    name: 'Paraíba',
    species: 'Cuprian elbaite tourmaline',
    formula: 'Na(Li,Al)₃Al₆(BO₃)₃Si₆O₁₈(OH)₄ · Cu',
    color: '#17b4c6',
    ior: 1.635,
    dispersion: 0.017,
    hardness: [7, 7.5],
    origin: 'Batalha mine',
    locality: 'Paraíba, Brazil',
    note: 'Copper gives it a neon blue no other tourmaline has.',
    cut: 'oval',
    pricePerCarat: 24000,
  },
  {
    id: 'padparadscha',
    name: 'Padparadscha',
    species: 'Corundum, sapphire',
    formula: 'Al₂O₃ · Cr, Fe',
    color: '#ff8f72',
    ior: 1.766,
    dispersion: 0.018,
    hardness: [9, 9],
    origin: 'Ratnapura',
    locality: 'Sabaragamuwa, Sri Lanka',
    note: 'Named for the lotus blossom: pink and orange in one stone.',
    cut: 'cushion',
    pricePerCarat: 18000,
  },
  {
    id: 'tanzanite',
    name: 'Tanzanite',
    species: 'Zoisite',
    formula: 'Ca₂Al₃(SiO₄)(Si₂O₇)O(OH) · V',
    color: '#4b58d9',
    ior: 1.695,
    dispersion: 0.03,
    hardness: [6.5, 7],
    origin: 'Merelani Hills',
    locality: 'Manyara, Tanzania',
    note: 'Found in one place on Earth, a few square kilometers near Merelani.',
    cut: 'cushion',
    pricePerCarat: 1200,
  },
  {
    id: 'spessartine',
    name: 'Mandarin',
    species: 'Spessartine garnet',
    formula: 'Mn₃Al₂(SiO₄)₃',
    color: '#ff7a16',
    ior: 1.81,
    dispersion: 0.027,
    hardness: [7, 7.5],
    origin: 'Loliondo',
    locality: 'Arusha, Tanzania',
    note: 'Manganese orange. The 2007 Loliondo find put clean stones on every bench.',
    cut: 'brilliant',
    pricePerCarat: 900,
  },
  {
    id: 'emerald',
    name: 'Muzo',
    species: 'Beryl, emerald',
    formula: 'Be₃Al₂Si₆O₁₈ · Cr',
    color: '#1e9f66',
    ior: 1.58,
    dispersion: 0.014,
    hardness: [7.5, 8],
    origin: 'Muzo',
    locality: 'Boyacá, Colombia',
    note: 'Chromium green, with the garden of inclusions that proves it natural.',
    cut: 'step',
    pricePerCarat: 15000,
  },
  {
    id: 'ruby',
    name: 'Mogok',
    species: 'Corundum, ruby',
    formula: 'Al₂O₃ · Cr',
    color: '#d9103f',
    ior: 1.766,
    dispersion: 0.018,
    hardness: [9, 9],
    origin: 'Mogok',
    locality: 'Mandalay, Myanmar',
    note: 'Chromium red that fluoresces, so a Mogok stone glows in sunlight.',
    cut: 'cushion',
    pricePerCarat: 30000,
  },
  {
    id: 'kunzite',
    name: 'Kunzite',
    species: 'Spodumene',
    formula: 'LiAl(SiO₃)₂ · Mn',
    color: '#e79bd9',
    ior: 1.67,
    dispersion: 0.017,
    hardness: [6.5, 7],
    origin: 'Nuristan',
    locality: 'Nuristan, Afghanistan',
    note: 'Lilac pink that fades in strong light: an evening stone.',
    cut: 'step',
    pricePerCarat: 150,
  },
  {
    id: 'tsavorite',
    name: 'Tsavorite',
    species: 'Grossular garnet',
    formula: 'Ca₃Al₂(SiO₄)₃ · V, Cr',
    color: '#15a03c',
    ior: 1.74,
    dispersion: 0.028,
    hardness: [7, 7.5],
    origin: 'Tsavo',
    locality: 'Taita-Taveta, Kenya',
    note: 'Vanadium green garnet, found in 1967 and never treated.',
    cut: 'brilliant',
    pricePerCarat: 2500,
  },
  {
    id: 'sphene',
    name: 'Sphene',
    species: 'Titanite',
    formula: 'CaTiSiO₅',
    color: '#c8c122',
    ior: 1.95,
    dispersion: 0.051,
    hardness: [5, 5.5],
    origin: 'Baja California',
    locality: 'Baja California, Mexico',
    note: 'More fire than diamond, but soft: a collector’s stone.',
    cut: 'brilliant',
    pricePerCarat: 400,
  },
  {
    id: 'alexandrite',
    name: 'Alexandrite',
    species: 'Chrysoberyl',
    formula: 'BeAl₂O₄ · Cr',
    color: '#2f9d6b',
    nightColor: '#b4304d',
    ior: 1.745,
    dispersion: 0.015,
    hardness: [8.5, 8.5],
    origin: 'Malysheva',
    locality: 'Ural Mountains, Russia',
    note: 'Green by daylight, red by lamplight: the color change is the gem.',
    cut: 'cushion',
    pricePerCarat: 20000,
  },
];

export const gemById = (id: string): Gem =>
  GEMS.find((gem) => gem.id === id) ?? GEMS[0]!;

export const cutName = (cut: Cut): string =>
  CUTS.find((info) => info.id === cut)?.name ?? cut;

/** `#17b4c6` → `23, 180, 198`, the form the theme's `-rgb` twins take. */
export const rgbChannels = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};
