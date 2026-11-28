// The reference app's lib/types, lib/mappers and lib/utils, with the sprite base pointed at the
// fixture server.
import { SPRITES } from './config';

export interface Pokemon {
  id: string;
  name: string;
  imageUrl: string | null;
}

export interface PokemonDetail {
  id: string;
  name: string;
  imageUrl: string | null;
  types: string[];
  height: number; // decimetres, as returned by the API
  weight: number; // hectograms, as returned by the API
  baseExperience: number;
  abilities: string[];
}

/** Every { name, url } pair the PokeAPI returns. */
export interface NamedAPIResource {
  name: string;
  url: string;
}

/** GET /pokemon?limit=&offset= - a page of references only (no images or stats). */
export interface PokemonListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: NamedAPIResource[];
}

/** The part of GET /pokemon/{id} that the app reads. */
export interface PokemonDetailDto {
  id: number;
  name: string;
  height: number;
  weight: number;
  base_experience: number;
  sprites: {
    front_default: string | null;
    other?: { 'official-artwork'?: { front_default: string | null } };
  };
  types: { slot: number; type: NamedAPIResource }[];
  abilities: { ability: NamedAPIResource; is_hidden: boolean; slot: number }[];
}

// List result urls look like ".../pokemon/132/": the last segment is the id.
export const idFromResourceUrl = (url: string): string => {
  const segments = url.split('/').filter(Boolean);
  return segments[segments.length - 1];
};

// The list endpoint returns only { name, url }, so the sprite is derived from the id rather than
// fetched per Pokémon.
export const mapPokemonSummary = (dto: NamedAPIResource): Pokemon => {
  const id = idFromResourceUrl(dto.url);
  return { id, name: dto.name, imageUrl: `${SPRITES}/${id}.png` };
};

// Favourites persist only ids; the row's detail fetch supplies the name.
export const pokemonFromId = (id: string): Pokemon => ({
  id,
  name: '',
  imageUrl: `${SPRITES}/${id}.png`,
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

export const TYPE_COLORS: Record<string, string> = {
  normal: '#A8A77A',
  fire: '#EE8130',
  water: '#6390F0',
  electric: '#F7D02C',
  grass: '#7AC74C',
  ice: '#96D9D6',
  fighting: '#C22E28',
  poison: '#A33EA1',
  ground: '#E2BF65',
  flying: '#A98FF3',
  psychic: '#F95587',
  bug: '#A6B91A',
  rock: '#B6A136',
  ghost: '#735797',
  dragon: '#6F35FC',
  dark: '#705746',
  steel: '#B7B7CE',
  fairy: '#D685AD',
};

export const typeColor = (name: string): string => TYPE_COLORS[name] ?? '#ccc';
