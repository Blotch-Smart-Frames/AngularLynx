import { useInfiniteQuery } from "@tanstack/react-query";

import { queryPokemon } from "../services/pokemon";

export const usePokemonList = (limit = 50) =>
  useInfiniteQuery({
    queryKey: ["pokemon", "list", limit],
    queryFn: ({ pageParam }) => queryPokemon(pageParam, limit),
    initialPageParam: 1,
    // The list endpoint has no more data once a page comes back short.
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < limit ? undefined : allPages.length + 1,
  });
