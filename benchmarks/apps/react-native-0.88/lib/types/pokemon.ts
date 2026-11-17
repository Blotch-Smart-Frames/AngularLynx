export type Pokemon = {
  id: string;
  name: string;
  imageUrl: string | null;
};

export type PokemonDetail = {
  id: string;
  name: string;
  imageUrl: string | null;
  types: string[];
  height: number; // decimetres, as returned by the API
  weight: number; // hectograms, as returned by the API
  baseExperience: number;
  abilities: string[];
};
