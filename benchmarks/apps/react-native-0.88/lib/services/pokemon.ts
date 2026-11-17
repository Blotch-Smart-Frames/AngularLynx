import { apiClient } from "@/lib/apiClient";
import { mapPokemonDetail, mapPokemonSummary } from "@/lib/mappers/pokemon";
import type { Pokemon, PokemonDetail } from "@/lib/types/pokemon";
import type {
  PokemonDetailDto,
  PokemonListResponse,
} from "@/lib/types/pokemonDto";

export const queryPokemon = async (page = 1, limit = 50): Promise<Pokemon[]> => {
  const offset = (page - 1) * limit;
  const res = await apiClient.get<PokemonListResponse>("/pokemon", {
    params: { limit, offset },
  });
  return res.data.results.map(mapPokemonSummary);
};

export const queryPokemonById = async (id: string): Promise<PokemonDetail> => {
  const res = await apiClient.get<PokemonDetailDto>(`/pokemon/${id}`);
  return mapPokemonDetail(res.data);
};
