import { typeColor } from '../constants/pokemonTypes';

export function PokemonTypeDot({ name }: { name: string }) {
  return (
    <view
      className="type-dot"
      accessibility-element
      accessibility-label={name}
      style={{ backgroundColor: typeColor(name) }}
    />
  );
}
