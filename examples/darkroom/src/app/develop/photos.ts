// cspell:words Blaché Wilfredor Jebulon Rincon Rincón Gullmarsskogen Tertre tertre
import beechFerns from '../../assets/photos/beech-ferns.jpg';
import cardamomBuns from '../../assets/photos/cardamom-buns.jpg';
import fishingBoat from '../../assets/photos/fishing-boat.jpg';
import fishmonger from '../../assets/photos/fishmonger.jpg';
import frontenacDusk from '../../assets/photos/frontenac-dusk.jpg';
import placeDuTertre from '../../assets/photos/place-du-tertre.jpg';
import snowyBike from '../../assets/photos/snowy-bike.jpg';

/**
 * A roll to develop before the person picks a photo of their own. Every one
 * is CC0 (public domain dedication) from Wikimedia Commons, credited here and
 * in the app as a courtesy; each is scaled to 1440 pixels on its long side.
 * Chosen to test a look the way a lab's test roll would: skin, night lights
 * (for halation), foliage greens, a dusk sky, food, and a near-monochrome
 * snow scene.
 */
export type Photo = {
  readonly id: string;
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly title: string;
  readonly author: string;
  /** The photo's page on Wikimedia Commons. */
  readonly source: string;
  /** The look the roll starts it on: what it shows off best. */
  readonly look: string;
};

export const ROLL: readonly Photo[] = [
  {
    id: 'place-du-tertre',
    src: placeDuTertre,
    width: 1440,
    height: 810,
    title: 'Place du Tertre, Paris',
    author: 'Pierre Blaché',
    source:
      'https://commons.wikimedia.org/wiki/File:Restaurants,_Place_du_Tertre,_Paris_30_September_2019.jpg',
    look: 'ember',
  },
  {
    id: 'fishmonger',
    src: fishmonger,
    width: 1440,
    height: 988,
    title: 'Fishmonger, Margarita Island',
    author: 'Wilfredor',
    source: 'https://commons.wikimedia.org/wiki/File:Fishmonger_smiling.jpg',
    look: 'harbor',
  },
  {
    id: 'fishing-boat',
    src: fishingBoat,
    width: 1440,
    height: 848,
    title: 'Fishing boat, Rincón de la Victoria',
    author: 'Jebulon',
    source:
      'https://commons.wikimedia.org/wiki/File:Fishing_boats,_morning,_Beach,_Rincon_de_la_Victoria,_Andalusia,_Spain.jpg',
    look: 'signal',
  },
  {
    id: 'frontenac-dusk',
    src: frontenacDusk,
    width: 1440,
    height: 972,
    title: 'Château Frontenac at dusk, Quebec City',
    author: 'Wilfredor',
    source:
      'https://commons.wikimedia.org/wiki/File:Chateau_Frontenac_at_dusk_in_Quebec_City.jpg',
    look: 'crossed',
  },
  {
    id: 'beech-ferns',
    src: beechFerns,
    width: 1440,
    height: 960,
    title: 'Beech and ferns, Gullmarsskogen',
    author: 'W.carter',
    source:
      'https://commons.wikimedia.org/wiki/File:Beech_and_ferns_in_Gullmarsskogen.jpg',
    look: 'matte',
  },
  {
    id: 'cardamom-buns',
    src: cardamomBuns,
    width: 1440,
    height: 992,
    title: 'Cardamom buns',
    author: 'W.carter',
    source: 'https://commons.wikimedia.org/wiki/File:Cardamom_buns.jpg',
    look: 'harbor',
  },
  {
    id: 'snowy-bike',
    src: snowyBike,
    width: 1440,
    height: 962,
    title: 'Bike in the snow, Quebec City',
    author: 'Wilfredor',
    source:
      'https://commons.wikimedia.org/wiki/File:Bike_on_a_snowy_street_in_Quebec_City_at_night.jpg',
    look: 'pewter',
  },
];
