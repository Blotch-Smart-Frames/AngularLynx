import { useMemo } from '@lynx-js/react';
import { useShallow } from 'zustand/react/shallow';

import ListEmpty from '../components/ListEmpty';
import PokemonList from '../components/PokemonList';
import TabScreenFrame from '../components/TabScreenFrame';
import { pokemonFromId } from '../lib/mappers/pokemon';
import { useFavouritesStore } from '../store/favourites';

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
