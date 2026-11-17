import { create } from 'zustand';

export type Tab = 'index' | 'favourites';

type Navigation = {
  tab: Tab;
  /** The Pokémon whose detail sheet is open (the original's /pokemon/:id). */
  detailId: string | null;
  setTab: (tab: Tab) => void;
  openDetail: (id: string) => void;
  closeDetail: () => void;
};

/**
 * The original's navigation (expo-router: a stack holding the tabs and the
 * detail form sheet) as state: ReactLynx has no router or navigator of its
 * own, and the app has two tabs and one sheet.
 */
export const useNavigation = create<Navigation>()(set => ({
  tab: 'index',
  detailId: null,
  setTab: tab => set({ tab }),
  openDetail: id => set({ detailId: id }),
  closeDetail: () => set({ detailId: null }),
}));
