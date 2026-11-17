import type { Pokemon, PokemonDetail } from "../types/pokemon";
import type {
  NamedAPIResource,
  PokemonDetailDto,
} from "../types/pokemonDto";
import { FIXTURE_ORIGIN } from "../fixtureOrigin";

export const SPRITE_BASE = `${FIXTURE_ORIGIN}/sprites/pokemon`;

// List result urls look like ".../pokemon/132/" — the last segment is the id.
export const idFromResourceUrl = (url: string): string => {
  const segments = url.split("/").filter(Boolean);
  return segments[segments.length - 1];
};

// The list endpoint only returns { name, url }, so derive the sprite from the id
// instead of fetching each Pokemon individually.
export const mapPokemonSummary = (dto: NamedAPIResource): Pokemon => {
  const id = idFromResourceUrl(dto.url);
  return {
    id,
    name: dto.name,
    imageUrl: `${SPRITE_BASE}/${id}.png`,
  };
};

// Favourites persist only ids; the row's detail fetch supplies the name.
export const pokemonFromId = (id: string): Pokemon => ({
  id,
  name: "",
  imageUrl: `${SPRITE_BASE}/${id}.png`,
});

export const mapPokemonDetail = (dto: PokemonDetailDto): PokemonDetail => ({
  id: String(dto.id),
  name: dto.name,
  imageUrl:
    dto.sprites.other?.["official-artwork"]?.front_default ??
    dto.sprites.front_default,
  types: dto.types.map((t) => t.type.name),
  height: dto.height,
  weight: dto.weight,
  baseExperience: dto.base_experience,
  abilities: dto.abilities.map((a) => a.ability.name),
});
