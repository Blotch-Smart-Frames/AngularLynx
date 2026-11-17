/**
 * The Cleveland Museum of Art's Open Access API, as the app reads it, and
 * the shape the app keeps a work in.
 *
 * The API needs no key and answers any origin (CORS `*`), so the same
 * requests run in the native apps and the web preview. Every work it
 * returns here is CC0 with an image (`cc0=1&has_image=1`): the app shows
 * pictures, and only ones anyone may use.
 */

export const API = 'https://openaccess-api.clevelandart.org/api/artworks/';

/**
 * The fields a list asks for, so a page of 24 is about 50 KB rather than
 * 1 MB (a whole record carries its provenance, exhibitions and citations).
 * `fun_fact` can't be among them: asking for it answers HTTP 500.
 */
export const LIST_FIELDS = [
  'id',
  'title',
  'creators',
  'creation_date',
  'type',
  'department',
  'technique',
  'current_location',
  'images',
  'accession_number',
].join(',');

/** How many works a page of a list loads. */
export const PAGE_SIZE = 24;

type RawImage = { url: string; width: string; height: string };

/** A record as the API sends it (only the fields the app reads). */
export type RawArtwork = {
  id: number;
  title: string;
  creators?: { description: string }[] | null;
  creation_date?: string | null;
  type?: string | null;
  department?: string | null;
  technique?: string | null;
  current_location?: string | null;
  images?: { web?: RawImage | null; print?: RawImage | null } | null;
  accession_number?: string | null;
  did_you_know?: string | null;
  description?: string | null;
  culture?: string[] | null;
  measurements?: string | null;
  creditline?: string | null;
  url?: string | null;
};

export type RawPage = {
  info: { total: number };
  data: RawArtwork[];
};

export type Picture = { url: string; width: number; height: number };

/** A gallery, as the museum numbers and names it: "206", "American Landscape". */
export type Gallery = { number: string; name: string };

/** A work as a list shows it, and as Saved keeps it. */
export type Artwork = {
  id: number;
  title: string;
  /** The first creator's name, without their nationality and dates. */
  maker: string | null;
  /** What follows the name, such as "American, 1826–1900". */
  makerNote: string | null;
  date: string | null;
  type: string | null;
  department: string | null;
  technique: string | null;
  /** Where it hangs, while it's on view. */
  gallery: Gallery | null;
  image: Picture;
  /** The 3,400-pixel print image, for zooming in. */
  print: Picture | null;
  accession: string | null;
};

/** A work's whole record, for its own screen. */
export type ArtworkDetail = Artwork & {
  didYouKnow: string | null;
  description: string | null;
  culture: string | null;
  measurements: string | null;
  creditLine: string | null;
  /** The work's page on the museum's site, for sharing. */
  url: string | null;
};

/**
 * The API's text carries HTML (`<em>`, `<i>`, `<br>`) and entities.
 * `<text>` shows markup as it is, so it goes.
 */
export const plainText = (html: string | null | undefined): string | null => {
  if (!html) return null;
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, '’')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
  return text || null;
};

/** "206 American Landscape" → { number: "206", name: "American Landscape" }. */
export const parseGallery = (
  location: string | null | undefined,
): Gallery | null => {
  const match = location?.match(/^(\d+[A-Z]?)\s+(.+)$/);
  return match ? { number: match[1]!, name: match[2]! } : null;
};

/**
 * "Frederic Edwin Church (American, 1826–1900)" → name and note.
 */
const parseMaker = (
  description: string | undefined,
): { maker: string | null; makerNote: string | null } => {
  if (!description) return { maker: null, makerNote: null };
  const match = description.match(/^(.*?)\s*\((.*)\)\s*$/);
  return match
    ? { maker: match[1]!, makerNote: match[2]! }
    : { maker: description, makerNote: null };
};

const picture = (raw: RawImage | null | undefined): Picture | null =>
  raw?.url
    ? { url: raw.url, width: Number(raw.width), height: Number(raw.height) }
    : null;

/** A list record as the app keeps it, or null for one without a picture. */
export const toArtwork = (raw: RawArtwork): Artwork | null => {
  const image = picture(raw.images?.web);
  if (!image) return null;
  return {
    id: raw.id,
    title: plainText(raw.title) ?? 'Untitled',
    ...parseMaker(raw.creators?.[0]?.description),
    date: raw.creation_date ?? null,
    type: raw.type ?? null,
    department: raw.department ?? null,
    technique: raw.technique ?? null,
    gallery: parseGallery(raw.current_location),
    image,
    print: picture(raw.images?.print),
    accession: raw.accession_number ?? null,
  };
};

export const toDetail = (raw: RawArtwork): ArtworkDetail | null => {
  const artwork = toArtwork(raw);
  if (!artwork) return null;
  return {
    ...artwork,
    didYouKnow: plainText(raw.did_you_know),
    description: plainText(raw.description),
    culture: raw.culture?.filter(Boolean).join('; ') || null,
    measurements: plainText(raw.measurements),
    creditLine: plainText(raw.creditline),
    url: raw.url ?? null,
  };
};

/** The query string of a list request. */
export const listParams = (
  filters: Record<string, string | number>,
  skip: number,
): Record<string, string | number> => ({
  ...filters,
  has_image: 1,
  cc0: 1,
  skip,
  limit: PAGE_SIZE,
  fields: LIST_FIELDS,
});

/**
 * The museum's departments, the ones whose works the collection's search
 * opens on. Their names are the API's own, which its `department` filter
 * matches exactly.
 */
export const DEPARTMENTS = [
  'European Painting and Sculpture',
  'American Painting and Sculpture',
  'Modern European Painting and Sculpture',
  'Japanese Art',
  'Chinese Art',
  'Korean Art',
  'Indian and Southeast Asian Art',
  'Egyptian and Ancient Near Eastern Art',
  'Greek and Roman Art',
  'Medieval Art',
  'African Art',
  'Art of the Americas',
  'Decorative Art and Design',
  'Prints',
  'Drawings',
  'Photography',
] as const;
