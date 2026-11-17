import { Colors } from '../constants/colors';
import { useFavouritesStore } from '../store/favourites';
import { Icons, SVGIcon } from './SVGIcon';

interface Props {
  name: string;
  size?: number;
  className?: string;
}

export function FavouriteButton({ name, size = 20, className }: Props) {
  const isFavourite = useFavouritesStore(state => !!state.favourites[name]);
  const toggle = useFavouritesStore(state => state.toggle);

  return (
    // catchtap, not bindtap: inside a row, a tap on the heart mustn't also
    // reach the row and open the detail, as a nested Pressable keeps it in
    // React Native.
    <view
      className={className}
      hit-slop="8px"
      catchtap={() => toggle(name)}
      accessibility-element
      accessibility-label={isFavourite ? 'Remove from favorites' : 'Add to favorites'}
    >
      <SVGIcon
        size={size}
        icon={isFavourite ? Icons.heartSolid : Icons.heart}
        color={isFavourite ? '#E53935' : Colors.textSecondary}
      />
    </view>
  );
}
