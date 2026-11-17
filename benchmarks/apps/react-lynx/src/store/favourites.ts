import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { lynxLocalStorage } from './storage';

type FavouritesStore = {
  favourites: Record<string, true>;
  toggle: (name: string) => void;
};

export const useFavouritesStore = create<FavouritesStore>()(
  persist(
    (set, get) => ({
      favourites: {},
      toggle: name => {
        const { favourites } = get();
        const next = { ...favourites };
        if (next[name]) {
          delete next[name];
        } else {
          next[name] = true;
        }
        set({ favourites: next });
      },
    }),
    {
      name: 'favourites',
      storage: createJSONStorage(() => lynxLocalStorage),
    },
  ),
);
