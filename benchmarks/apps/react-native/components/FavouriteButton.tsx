import { useFavouritesStore } from '@/store/favourites';
import { useCallback } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable } from 'react-native';
import { Colors } from '@/constants/colors';
import { SVGIcon } from './SVGIcon';
import HeartIcon from '@/assets/icons/heart.svg';
import HeartSolidIcon from '@/assets/icons/heart-solid.svg';

interface Props {
  name: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function FavouriteButton({ name, size = 20, style, testID }: Props) {
  const isFavourite = useFavouritesStore(state => !!state.favourites[name]);
  const toggle = useFavouritesStore(state => state.toggle);

  const onPress = useCallback(() => {
    toggle(name);
  }, [toggle, name]);

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={style}
      testID={testID}
      accessibilityLabel={isFavourite ? 'Remove from favorites' : 'Add to favorites'}
    >
      <SVGIcon
        size={size}
        icon={isFavourite ? HeartSolidIcon : HeartIcon}
        color={isFavourite ? '#E53935' : Colors.textSecondary}
      />
    </Pressable>
  );
}
