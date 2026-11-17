import placeholder from '../assets/images/pokemon-logo.png';

interface Props {
  uri: string | null;
  size: number;
}

/**
 * expo-image with the Pokémon logo as its placeholder, both `contain`: Lynx's
 * `<image>` takes the same as `placeholder` and `mode="aspectFit"`.
 */
export function PokemonImage({ uri, size }: Props) {
  return (
    <image
      src={uri ?? ''}
      placeholder={placeholder}
      mode="aspectFit"
      style={{ width: `${size}px`, height: `${size}px` }}
    />
  );
}
