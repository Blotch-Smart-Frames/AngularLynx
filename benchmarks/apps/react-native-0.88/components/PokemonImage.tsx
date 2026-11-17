import placeholder from '@/assets/images/pokemon-logo.png';
import { Image } from 'expo-image';

interface Props {
  uri: string | null;
  size: number;
}

export function PokemonImage({ uri, size }: Props) {
  return (
    <Image
      source={uri}
      placeholder={placeholder}
      placeholderContentFit="contain"
      style={{ width: size, height: size }}
      contentFit="contain"
    />
  );
}
