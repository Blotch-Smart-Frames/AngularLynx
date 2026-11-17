import ListEmpty from '@/components/ListEmpty';
import PokemonList from '@/components/PokemonList';
import TabScreenFrame from '@/components/TabScreenFrame';
import { usePokemonList } from '@/lib/hooks/usePokemonList';
import { reportFullyDrawn } from '@/modules/app-startup-module';
import { useEffect, useMemo } from 'react';

export default function Index() {
  const pokemon = usePokemonList();
  const data = useMemo(() => pokemon.data?.pages.flat(), [pokemon.data]);

  useEffect(() => {
    if (pokemon.isSuccess) {
      requestAnimationFrame(() => {
        reportFullyDrawn();
      });
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
