import { typeColor } from '@/constants/pokemonTypes';
import { View } from 'react-native';

interface Props {
  name: string;
  size?: number;
}

export function PokemonTypeDot({ name, size = 20 }: Props) {
  return (
    <View
      accessibilityLabel={name}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: typeColor(name),
      }}
    />
  );
}
