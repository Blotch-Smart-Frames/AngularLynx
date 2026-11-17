// The original's palette (constants/colors.ts and constants/pokemonTypes.ts).
// The screens draw with these values rather than the @blotch/ui theme's, so
// they look as the React Native app does.
export const Colors = {
  white: '#fff',
  backgroundScreen: '#F7F7F7',
  border: '#E3E3E3',
  textPrimary: '#1a1a1a',
  textSecondary: '#9E9E9E',
  typeFallback: '#ccc',
  tabBarActive: '#000000',
  tabBarInactive: '#424242',
  favourite: '#E53935',
} as const;

const TYPE_COLORS: Readonly<Record<string, string>> = {
  normal: '#A8A77A',
  fire: '#EE8130',
  water: '#6390F0',
  electric: '#F7D02C',
  grass: '#7AC74C',
  ice: '#96D9D6',
  fighting: '#C22E28',
  poison: '#A33EA1',
  ground: '#E2BF65',
  flying: '#A98FF3',
  psychic: '#F95587',
  bug: '#A6B91A',
  rock: '#B6A136',
  ghost: '#735797',
  dragon: '#6F35FC',
  dark: '#705746',
  steel: '#B7B7CE',
  fairy: '#D685AD',
};

export const typeColor = (name: string): string => TYPE_COLORS[name] ?? Colors.typeFallback;
