import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

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
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
