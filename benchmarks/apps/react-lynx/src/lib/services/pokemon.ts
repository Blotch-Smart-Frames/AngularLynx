import { apiGet } from '../apiClient';
import { mapPokemonDetail, mapPokemonSummary } from '../mappers/pokemon';
import type { Pokemon, PokemonDetail } from '../types/pokemon';
import type { PokemonDetailDto, PokemonListResponse } from '../types/pokemonDto';

export const queryPokemon = async (page = 1, limit = 50): Promise<Pokemon[]> => {
  const offset = (page - 1) * limit;
  const data = await apiGet<PokemonListResponse>('/pokemon', { limit, offset });
  return data.results.map(mapPokemonSummary);
};

export const queryPokemonById = async (id: string): Promise<PokemonDetail> => {
  const data = await apiGet<PokemonDetailDto>(`/pokemon/${id}`);
  return mapPokemonDetail(data);
};
