import { useEffect, useMemo } from '@lynx-js/react';

import ListEmpty from '../components/ListEmpty';
import PokemonList from '../components/PokemonList';
import TabScreenFrame from '../components/TabScreenFrame';
import { reportFullyDrawn } from '../lib/fullyDrawn';
import { usePokemonList } from '../lib/hooks/usePokemonList';

export default function Index() {
  const pokemon = usePokemonList();
  const data = useMemo(() => pokemon.data?.pages.flat(), [pokemon.data]);

  // The original reports TTFD from this effect inside requestAnimationFrame;
  // reportFullyDrawn() waits for the main thread to apply the commit instead
  // (lib/fullyDrawn.ts).
  useEffect(() => {
    if (pokemon.isSuccess) {
      reportFullyDrawn();
    }
  }, [pokemon.isSuccess]);

  return (
    <TabScreenFrame>
      <PokemonList
        data={data}
        headerText="Pokédex"
        onEndReached={() => {
          if (pokemon.hasNextPage && !pokemon.isFetchingNextPage) {
            pokemon.fetchNextPage();
          }
        }}
        isFetchingNextPage={pokemon.isFetchingNextPage}
        ListEmptyComponent={
          <ListEmpty
            isLoading={pokemon.isLoading}
            isError={pokemon.isError}
            emptyMessage="No Pokémon found"
          />
        }
      />
    </TabScreenFrame>
  );
}
