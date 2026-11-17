import { memo, useState } from '@lynx-js/react';

import { usePokemon } from '../lib/hooks/usePokemon';
import type { Pokemon } from '../lib/types/pokemon';
import { capitalize } from '../lib/utils/capitalize';
import { useNavigation } from '../navigation';
import { FavouriteButton } from './FavouriteButton';
import { PokemonImage } from './PokemonImage';
import { PokemonTypeDot } from './PokemonTypeDot';

function PokemonItem({ pokemon, index }: { pokemon: Pokemon; index: number }) {
  const detail = usePokemon(pokemon.id);
  const openDetail = useNavigation(state => state.openDetail);
  // TouchableOpacity's press feedback (opacity 0.2 while pressed). Lynx's
  // :active pseudo-class isn't on by default, so the touch events set it.
  const [pressed, setPressed] = useState(false);

  return (
    <view
      className="card"
      style={pressed ? { opacity: 0.2 } : undefined}
      bindtouchstart={() => setPressed(true)}
      bindtouchend={() => setPressed(false)}
      bindtouchcancel={() => setPressed(false)}
      bindtap={() => openDetail(pokemon.id)}
    >
      <view className="card-image">
        <PokemonImage uri={pokemon.imageUrl} size={56} />
      </view>
      <view className="card-info">
        <text className="card-name" text-maxline="1">
          {index + 1}. {capitalize(pokemon.name || (detail.data?.name ?? ''))}
        </text>
        <text className="card-subtitle" text-maxline="1">
          #{pokemon.id.padStart(3, '0')}
        </text>
      </view>
      <view className="card-trailing">
        {detail.data && (
          <view className="type-dots">
            {detail.data.types.map(type => (
              <PokemonTypeDot key={type} name={type} />
            ))}
          </view>
        )}
        <FavouriteButton name={pokemon.id} size={20} />
      </view>
    </view>
  );
}

export default memo(PokemonItem);
