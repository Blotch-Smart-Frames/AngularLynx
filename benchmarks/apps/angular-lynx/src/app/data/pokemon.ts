import { SPRITE_BASE } from './config';

/** A row of the list: what the list endpoint gives, and the sprite's URL. */
export type Pokemon = {
  readonly id: string;
  readonly name: string;
  readonly imageUrl: string | null;
};

export type PokemonDetail = {
  readonly id: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly types: readonly string[];
  /** Decimetres, as the API returns it. */
  readonly height: number;
  /** Hectograms, as the API returns it. */
  readonly weight: number;
  readonly baseExperience: number;
  readonly abilities: readonly string[];
};

/** Every `{ name, url }` pair the PokeAPI returns. */
export type NamedApiResource = { readonly name: string; readonly url: string };

/** `GET /pokemon?limit=&offset=`: a page of references only. */
export type PokemonListResponse = {
  readonly count: number;
  readonly next: string | null;
  readonly previous: string | null;
  readonly results: readonly NamedApiResource[];
};

/** The part of `GET /pokemon/{id}` the app reads. */
export type PokemonDetailDto = {
  readonly id: number;
  readonly name: string;
  readonly height: number;
  readonly weight: number;
  readonly base_experience: number;
  readonly sprites: {
    readonly front_default: string | null;
    readonly other?: { readonly 'official-artwork'?: { readonly front_default: string | null } };
  };
  readonly types: readonly { readonly slot: number; readonly type: NamedApiResource }[];
  readonly abilities: readonly {
    readonly ability: NamedApiResource;
    readonly is_hidden: boolean;
    readonly slot: number;
  }[];
};

// A list result's url looks like ".../pokemon/132/": the last segment is the id.
const idFromResourceUrl = (url: string): string => {
  const segments = url.split('/').filter(Boolean);
  return segments[segments.length - 1];
};

// The list endpoint returns only { name, url }, so the sprite comes from the
// id rather than from fetching each Pokémon.
export const mapPokemonSummary = (dto: NamedApiResource): Pokemon => {
  const id = idFromResourceUrl(dto.url);
  return { id, name: dto.name, imageUrl: `${SPRITE_BASE}/${id}.png` };
};

// Favourites keep only ids; the row's detail fetch gives the name.
export const pokemonFromId = (id: string): Pokemon => ({
  id,
  name: '',
  imageUrl: `${SPRITE_BASE}/${id}.png`,
});

export const mapPokemonDetail = (dto: PokemonDetailDto): PokemonDetail => ({
  id: String(dto.id),
  name: dto.name,
  imageUrl: dto.sprites.other?.['official-artwork']?.front_default ?? dto.sprites.front_default,
  types: dto.types.map((t) => t.type.name),
  height: dto.height,
  weight: dto.weight,
  baseExperience: dto.base_experience,
  abilities: dto.abilities.map((a) => a.ability.name),
});

export const capitalize = (value: string): string =>
  value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);

/** `#001`: the Dex number, as the rows and the detail show it. */
export const dexNumber = (id: string): string => `#${id.padStart(3, '0')}`;
