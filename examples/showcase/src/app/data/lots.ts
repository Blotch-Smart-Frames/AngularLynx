import { CUTS, GEMS, type Cut, type Gem } from './gems';
import { seedOf, seeded } from './random';

export type Lot = {
  readonly id: string;
  /** The lot number on its parcel paper. */
  readonly number: string;
  readonly gemId: string;
  readonly carat: number;
  readonly cut: Cut;
  readonly clarity: string;
  /** Illustrative, in USD. */
  readonly price: number;
};

const CLARITY = ['Eye clean', 'Loupe clean', 'Lightly included', 'Eye clean'];

/**
 * Forty lots across the ten stones: a parcel of each. Carats skew small, as a
 * real parcel does, and the price follows the stone's price per carat with a
 * premium for size. Illustrative throughout.
 */
const makeLots = (appraisal: number): readonly Lot[] => {
  const random = seeded(seedOf(`lots-${appraisal}`));
  const lots: Lot[] = [];
  GEMS.forEach((gem: Gem, index) => {
    for (let i = 0; i < 4; i++) {
      const carat = Math.round((0.4 + random() ** 2 * 5.6) * 100) / 100;
      const sizePremium = 1 + Math.max(0, carat - 1) * 0.18;
      const quality = 0.7 + random() * 0.6;
      lots.push({
        id: `${gem.id}-${i}`,
        number: `${String(index + 1).padStart(2, '0')}${String(i + 1).padStart(2, '0')}`,
        gemId: gem.id,
        carat,
        cut: i === 0 ? gem.cut : CUTS[Math.floor(random() * CUTS.length)]!.id,
        clarity: CLARITY[Math.floor(random() * CLARITY.length)]!,
        price: Math.round(gem.pricePerCarat * carat * sizePremium * quality),
      });
    }
  });
  // Mixed, so the collection isn't ten rows of four.
  return lots
    .map((lot) => ({ lot, key: random() }))
    .sort((a, b) => a.key - b.key)
    .map(({ lot }) => lot);
};

/** The lots after `appraisal` re-appraisals: pulling to refresh re-prices them. */
export const lotsAt = (appraisal: number): readonly Lot[] =>
  makeLots(appraisal);
