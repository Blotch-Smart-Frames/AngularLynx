import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import PokemonList from '@/components/PokemonList';
import ListEmpty from '@/components/ListEmpty';
import TabScreenFrame from '@/components/TabScreenFrame';
import { useFavouritesStore } from '@/store/favourites';
import { pokemonFromId } from '@/lib/mappers/pokemon';

export default function Favourites() {
  const favouriteIds = useFavouritesStore(useShallow(state => Object.keys(state.favourites)));
  const favouritePokemon = useMemo(() => favouriteIds.map(pokemonFromId), [favouriteIds]);

  return (
    <TabScreenFrame>
      <PokemonList
        data={favouritePokemon}
        headerText="Favourites"
        ListEmptyComponent={
          <ListEmpty isLoading={false} isError={false} emptyMessage="No favourite Pokémon saved" />
        }
      />
    </TabScreenFrame>
  );
}
