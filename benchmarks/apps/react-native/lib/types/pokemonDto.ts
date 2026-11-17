// Shared building block: every { name, url } pair the PokeAPI returns.
export interface NamedAPIResource {
  name: string;
  url: string;
}

// GET /pokemon?limit=&offset= — a page of references only (no images/stats).
export interface PokemonListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: NamedAPIResource[];
}

// Subset of GET /pokemon/{id} that the app actually consumes.
export interface PokemonDetailDto {
  id: number;
  name: string;
  height: number; // decimetres
  weight: number; // hectograms
  base_experience: number;
  sprites: {
    front_default: string | null;
    other?: {
      "official-artwork"?: {
        front_default: string | null;
      };
    };
  };
  types: { slot: number; type: NamedAPIResource }[];
  abilities: { ability: NamedAPIResource; is_hidden: boolean; slot: number }[];
}
