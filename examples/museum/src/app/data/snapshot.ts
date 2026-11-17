// cspell:disable -- the museum's own names and titles, as its API gives them.
import type { RawPage } from './artwork';

/**
 * The first page of what's on view, as the API answered on 2026-11-16: the
 * wall the app shows when it can't reach the museum, so the landing page
 * never shows an empty wall. The app says when it's showing this instead
 * of the museum's live answer. The pictures still come from the museum's
 * image server, which is separate from its API.
 */
export const SNAPSHOT: RawPage = {
  info: {
    total: 143,
  },
  data: [
    {
      id: 102578,
      title: 'Portrait of Dora Wheeler',
      creators: [
        {
          description: 'William Merritt Chase (American, 1849–1916)',
        },
      ],
      creation_date: '1882–83',
      type: 'Painting',
      department: 'American Painting and Sculpture',
      technique: 'oil on canvas',
      current_location: '208 American Gilded Age and Realism',
      accession_number: '1921.1239',
      images: {
        web: {
          url: 'https://openaccess-cdn.clevelandart.org/1921.1239/1921.1239_web.jpg',
          width: '939',
          height: '893',
        },
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1921.1239/1921.1239_print.jpg',
          width: '3400',
          height: '3254',
        },
      },
    },
    {
      id: 92937,
      title: "Stag at Sharkey's",
      creators: [
        {
          description: 'George Bellows (American, 1882–1925)',
        },
      ],
      creation_date: '1909',
      type: 'Painting',
      department: 'American Painting and Sculpture',
      technique: 'oil on canvas',
      current_location: '208 American Gilded Age and Realism',
      accession_number: '1922.1133',
      images: {
        web: {
          url: 'https://openaccess-cdn.clevelandart.org/1922.1133/1922.1133_web.jpg',
          width: '1194',
          height: '893',
        },
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1922.1133/1922.1133_print.jpg',
          width: '3400',
          height: '2542',
        },
      },
    },
    {
      id: 151904,
      title: 'The Biglin Brothers Turning the Stake',
      creators: [
        {
          description: 'Thomas Eakins (American, 1844–1916)',
        },
      ],
      creation_date: '1873',
      type: 'Painting',
      department: 'American Painting and Sculpture',
      technique: 'oil on canvas',
      current_location: '207 American Realism',
      accession_number: '1927.1984',
      images: {
        web: {
          url: 'https://openaccess-cdn.clevelandart.org/1927.1984/1927.1984_web.jpg',
          width: '1263',
          height: '835',
        },
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1927.1984/1927.1984_print.jpg',
          width: '3400',
          height: '2247',
        },
      },
    },
    {
      id: 110180,
      title: 'The Race Track (Death on a Pale Horse)',
      creators: [
        {
          description: 'Albert Pinkham Ryder (American, 1847–1917)',
        },
      ],
      creation_date: 'c. 1896–1908',
      type: 'Painting',
      department: 'American Painting and Sculpture',
      technique: 'oil on canvas',
      current_location: '207 American Realism',
      accession_number: '1928.8',
      images: {
        web: {
          url: 'https://openaccess-cdn.clevelandart.org/1928.8/1928.8_web.jpg',
          width: '900',
          height: '711',
        },
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1928.8/1928.8_print.jpg',
          width: '3400',
          height: '2685',
        },
      },
    },
    {
      id: 141639,
      title: 'Twilight in the Wilderness',
      creators: [
        {
          description: 'Frederic Edwin Church (American, 1826–1900)',
        },
      ],
      creation_date: '1860',
      type: 'Painting',
      department: 'American Painting and Sculpture',
      technique: 'oil on canvas',
      current_location: '206 American Landscape',
      accession_number: '1965.233',
      images: {
        web: {
          url: 'https://openaccess-cdn.clevelandart.org/1965.233/1965.233_web.jpg',
          width: '900',
          height: '562',
        },
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1965.233/1965.233_print.jpg',
          width: '3400',
          height: '2123',
        },
      },
    },
    {
      id: 135382,
      title: 'The Red Kerchief',
      creators: [
        {
          description: 'Claude Monet (French, 1840–1926)',
        },
      ],
      creation_date: 'c. 1868–73',
      type: 'Painting',
      department: 'Modern European Painting and Sculpture',
      technique: 'oil on fabric',
      current_location: '222 Impressionism & Post-Impressionism',
      accession_number: '1958.39',
      images: {
        web: {
          url: 'https://openaccess-cdn.clevelandart.org/1958.39/1958.39_web.jpg',
          width: '723',
          height: '900',
        },
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1958.39/1958.39_print.jpg',
          width: '2732',
          height: '3400',
        },
      },
    },
    {
      id: 138464,
      title: 'Cupid and Psyche',
      creators: [
        {
          description: 'Jacques-Louis David (French, 1748–1825)',
        },
      ],
      creation_date: '1817',
      type: 'Painting',
      department: 'Modern European Painting and Sculpture',
      technique: 'oil on canvas',
      current_location: '201 Neoclassical Painting & Sculpture',
      accession_number: '1962.37',
      images: {
        web: {
          url: 'https://openaccess-cdn.clevelandart.org/1962.37/1962.37_web.jpg',
          width: '1180',
          height: '893',
        },
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1962.37/1962.37_print.jpg',
          width: '3400',
          height: '2574',
        },
      },
    },
    {
      id: 127571,
      title: 'Portrait of a Man, Possibly Girolamo Rosati',
      creators: [
        {
          description: 'Lorenzo Lotto (Italian, 1480–1556)',
        },
      ],
      creation_date: '1533–34',
      type: 'Painting',
      department: 'European Painting and Sculpture',
      technique: 'oil on canvas',
      current_location: '118 Italian Renaissance',
      accession_number: '1950.250',
      images: {
        web: {
          url: 'https://openaccess-cdn.clevelandart.org/1950.250/1950.250_web.jpg',
          width: '824',
          height: '893',
        },
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1950.250/1950.250_print.jpg',
          width: '3139',
          height: '3400',
        },
      },
    },
    {
      id: 109245,
      title: 'Elizabeth Shewell West and Her Son, Raphael',
      creators: [
        {
          description:
            'Benjamin West (American, born The Thirteen Colonies, 1738–1820)',
        },
      ],
      creation_date: 'c. 1770',
      type: 'Painting',
      department: 'American Painting and Sculpture',
      technique: 'oil on canvas',
      current_location: '204 Colonial American',
      accession_number: '1927.393',
      images: {
        web: {
          url: 'https://openaccess-cdn.clevelandart.org/1927.393/1927.393_web.jpg',
          width: '890',
          height: '893',
        },
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1927.393/1927.393_print.jpg',
          width: '3387',
          height: '3400',
        },
      },
    },
    {
      id: 160885,
      title: 'Portrait of Tieleman Roosterman',
      creators: [
        {
          description: 'Frans Hals (Dutch, c. 1581–1666)',
        },
      ],
      creation_date: '1634',
      type: 'Painting',
      department: 'European Painting and Sculpture',
      technique: 'oil on canvas',
      current_location: '213 Dutch Painting',
      accession_number: '1999.173',
      images: {
        web: {
          url: 'https://openaccess-cdn.clevelandart.org/1999.173/1999.173_web.jpg',
          width: '664',
          height: '893',
        },
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1999.173/1999.173_print.jpg',
          width: '2529',
          height: '3400',
        },
      },
    },
    {
      id: 117032,
      title: 'The Sacrifice of Isaac',
      creators: [
        {
          description: 'Andrea del Sarto (Italian, 1486–1530)',
        },
      ],
      creation_date: 'c. 1527',
      type: 'Painting',
      department: 'European Painting and Sculpture',
      technique: 'oil on wood',
      current_location: '217 Italian Baroque',
      accession_number: '1937.577',
      images: {
        web: {
          url: 'https://openaccess-cdn.clevelandart.org/1937.577/1937.577_web.jpg',
          width: '697',
          height: '900',
        },
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1937.577/1937.577_print.jpg',
          width: '2633',
          height: '3400',
        },
      },
    },
    {
      id: 135428,
      title: 'Hunting near Hartenfels Castle',
      creators: [
        {
          description: 'Lucas Cranach the Elder (German, 1472–1553)',
        },
      ],
      creation_date: '1540',
      type: 'Painting',
      department: 'European Painting and Sculpture',
      technique: 'oil, originally on wood, transferred to masonite',
      current_location: '114 Late Northern Renaissance',
      accession_number: '1958.425',
      images: {
        web: {
          url: 'https://openaccess-cdn.clevelandart.org/1958.425/1958.425_web.jpg',
          width: '1263',
          height: '866',
        },
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1958.425/1958.425_print.jpg',
          width: '3400',
          height: '2332',
        },
      },
    },
    {
      id: 150389,
      title: 'The Holy Family on the Steps',
      creators: [
        {
          description: 'Nicolas Poussin (French, 1594–1665)',
        },
      ],
      creation_date: '1648',
      type: 'Painting',
      department: 'European Painting and Sculpture',
      technique: 'oil on canvas',
      current_location: '212 Baroque Painting and Sculpture',
      accession_number: '1981.18',
      images: {
        web: {
          url: 'https://openaccess-cdn.clevelandart.org/1981.18/1981.18_web.jpg',
          width: '1263',
          height: '867',
        },
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1981.18/1981.18_print.jpg',
          width: '3400',
          height: '2333',
        },
      },
    },
    {
      id: 148758,
      title: 'The Crucifixion of Saint Andrew',
      creators: [
        {
          description: 'Caravaggio (Italian, 1571–1610)',
        },
      ],
      creation_date: '1606–7',
      type: 'Painting',
      department: 'European Painting and Sculpture',
      technique: 'oil on canvas',
      current_location: '217 Italian Baroque',
      accession_number: '1976.2',
      images: {
        web: {
          url: 'https://openaccess-cdn.clevelandart.org/1976.2/1976.2_web.jpg',
          width: '678',
          height: '900',
        },
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1976.2/1976.2_print.jpg',
          width: '2563',
          height: '3400',
        },
      },
    },
    {
      id: 122351,
      title: 'The Burning of the Houses of Lords and Commons, 16 October 1834',
      creators: [
        {
          description: 'Joseph Mallord William Turner (British, 1775–1851)',
        },
      ],
      creation_date: '1835',
      type: 'Painting',
      department: 'Modern European Painting and Sculpture',
      technique: 'oil on canvas',
      current_location: '203B British Painting and Decorative Arts',
      accession_number: '1942.647',
      images: {
        web: {
          url: 'https://openaccess-cdn.clevelandart.org/1942.647/1942.647_web.jpg',
          width: '900',
          height: '668',
        },
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1942.647/1942.647_print.jpg',
          width: '3400',
          height: '2525',
        },
      },
    },
    {
      id: 136510,
      title: 'Water Lilies (Agapanthus)',
      creators: [
        {
          description: 'Claude Monet (French, 1840–1926)',
        },
      ],
      creation_date: 'c. 1915–26',
      type: 'Painting',
      department: 'Modern European Painting and Sculpture',
      technique: 'oil on canvas',
      current_location: '222 Impressionism & Post-Impressionism',
      accession_number: '1960.81',
      images: {
        web: {
          url: 'https://openaccess-cdn.clevelandart.org/1960.81/1960.81_web.jpg',
          width: '900',
          height: '419',
        },
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1960.81/1960.81_print.jpg',
          width: '3400',
          height: '1581',
        },
      },
    },
    {
      id: 155783,
      title: 'The Power of Music',
      creators: [
        {
          description: 'William Sidney Mount (American, 1807–1868)',
        },
      ],
      creation_date: '1847',
      type: 'Painting',
      department: 'American Painting and Sculpture',
      technique: 'oil on canvas',
      current_location: '207 American Realism',
      accession_number: '1991.110',
      images: {
        web: {
          url: 'https://openaccess-cdn.clevelandart.org/1991.110/1991.110_web.jpg',
          width: '1106',
          height: '893',
        },
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1991.110/1991.110_print.jpg',
          width: '3400',
          height: '2745',
        },
      },
    },
    {
      id: 156112,
      title: 'Tea Table',
      creators: [
        {
          description: 'Carlo Bugatti (Italian, 1856–1940)',
        },
      ],
      creation_date: 'c. 1907',
      type: 'Furniture and woodwork',
      department: 'Decorative Art and Design',
      technique:
        'inlaid wood (mahogany?), cast and gilded bronze mounts, inlays of ivory or bone, metal, and mother-of-pearl (marine mussels or pearl oysters)',
      current_location: '223 20th Century Avant-Garde',
      accession_number: '1991.45',
      images: {
        web: {
          url: 'https://openaccess-cdn.clevelandart.org/1991.45/1991.45_web.jpg',
          width: '723',
          height: '900',
        },
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1991.45/1991.45_print.jpg',
          width: '2732',
          height: '3400',
        },
      },
    },
    {
      id: 111811,
      title: 'Nataraja, Shiva as the Lord of Dance',
      creators: [],
      creation_date: '1000s',
      type: 'Sculpture',
      department: 'Indian and Southeast Asian Art',
      technique: 'Bronze',
      current_location: '244 Indian and Southeast Asian',
      accession_number: '1930.331',
      images: {
        web: {
          url: 'https://openaccess-cdn.clevelandart.org/1930.331/1930.331_web.jpg',
          width: '804',
          height: '900',
        },
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1930.331/1930.331_print.jpg',
          width: '3039',
          height: '3400',
        },
      },
    },
    {
      id: 155665,
      title:
        'Red-Figure Calyx-Krater (Mixing Vessel): Medea in Chariot (A); Telephos with Baby Orestes (B)',
      creators: [
        {
          description:
            'Policoro Painter (South Italian, Lucanian, active c. 400 BCE)',
        },
      ],
      creation_date: 'c. 400 BCE',
      type: 'Ceramic',
      department: 'Greek and Roman Art',
      technique: 'ceramic',
      current_location: '102D Pre-Roman',
      accession_number: '1991.1',
      images: {
        web: {
          url: 'https://openaccess-cdn.clevelandart.org/1991.1/1991.1_web.jpg',
          width: '811',
          height: '900',
        },
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1991.1/1991.1_print.jpg',
          width: '3064',
          height: '3400',
        },
      },
    },
    {
      id: 123985,
      title: 'The Wade Cup with Animated Script',
      creators: [],
      creation_date: '1200–1221',
      type: 'Metalwork',
      department: 'Islamic Art',
      technique: 'brass inlaid with silver',
      current_location: '116 Islamic',
      accession_number: '1944.485',
      images: {
        web: {
          url: 'https://openaccess-cdn.clevelandart.org/1944.485/1944.485_web.jpg',
          width: '900',
          height: '794',
        },
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1944.485/1944.485_print.jpg',
          width: '3400',
          height: '3000',
        },
      },
    },
    {
      id: 106841,
      title: 'Table Fountain',
      creators: [],
      creation_date: 'c. 1320–40',
      type: 'Metalwork',
      department: 'Medieval Art',
      technique: 'gilt-silver and translucent enamels',
      current_location: '109 Gothic Painting and Sculpture',
      accession_number: '1924.859',
      images: {
        web: {
          url: 'https://openaccess-cdn.clevelandart.org/1924.859/1924.859_web.jpg',
          width: '803',
          height: '900',
        },
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1924.859/1924.859_print.jpg',
          width: '3033',
          height: '3400',
        },
      },
    },
    {
      id: 98823,
      title: 'Amitabha Triad',
      creators: [],
      creation_date: '1400s',
      type: 'Sculpture',
      department: 'Korean Art',
      technique: 'bronze with traces of gilding',
      current_location: '236 Korean',
      accession_number: '1918.501',
      images: {
        web: {
          url: 'https://openaccess-cdn.clevelandart.org/1918.501/1918.501_web.jpg',
          width: '900',
          height: '653',
        },
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1918.501/1918.501_print.jpg',
          width: '3400',
          height: '2467',
        },
      },
    },
    {
      id: 135538,
      title:
        'Mourner from the Tomb of Philip the Bold, Duke of Burgundy (1364–1404)',
      creators: [
        {
          description: 'Claus de Werve (Netherlandish, 1380–1439)',
        },
      ],
      creation_date: '1404–10',
      type: 'Sculpture',
      department: 'Medieval Art',
      technique: 'vizille alabaster',
      current_location: '109 Gothic Painting and Sculpture',
      accession_number: '1958.66',
      images: {
        web: {
          url: 'https://openaccess-cdn.clevelandart.org/1958.66/1958.66_web.jpg',
          width: '773',
          height: '900',
        },
        print: {
          url: 'https://openaccess-cdn.clevelandart.org/1958.66/1958.66_print.jpg',
          width: '2921',
          height: '3400',
        },
      },
    },
  ],
};
