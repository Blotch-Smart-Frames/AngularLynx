import { useQuery } from "@tanstack/react-query";

import { queryPokemonById } from "@/lib/services/pokemon";

export const usePokemon = (id: string) =>
  useQuery({
    queryKey: ["pokemon", "detail", id],
    queryFn: () => queryPokemonById(id),
    enabled: !!id,
  });
