import { Injectable, computed, signal } from '@angular/core';

export type Album = {
  readonly id: number;
  readonly title: string;
  readonly artist: string;
  /** The cover, as a CSS gradient. */
  readonly cover: string;
};

const GRADIENTS = [
  'linear-gradient(135deg, #f97316, #db2777)',
  'linear-gradient(135deg, #22d3ee, #6366f1)',
  'linear-gradient(135deg, #a3e635, #059669)',
  'linear-gradient(135deg, #facc15, #ea580c)',
  'linear-gradient(135deg, #c084fc, #4f46e5)',
  'linear-gradient(135deg, #f472b6, #e11d48)',
];

const TITLES = [
  ['Low Tide', 'Harbor Lights'],
  ['Neon Atlas', 'The Parallels'],
  ['Green Room', 'Marlow'],
  ['Sunday Static', 'June & the Owls'],
  ['Night Swim', 'Velvet Coast'],
  ['First Light', 'Ada North'],
  ['Paper Moons', 'The Lanterns'],
  ['Slow Motion', 'Kite Season'],
  ['Copper Sky', 'Ada North'],
];

/** A shelf of albums to search, and to scroll under the dock. */
export const ALBUMS: readonly Album[] = TITLES.map(([title, artist], i) => ({
  id: i + 1,
  title,
  artist,
  cover: GRADIENTS[i % GRADIENTS.length],
}));

/** What the search screen suggests while the field is empty. */
export const SUGGESTIONS = ['Ada North', 'Night', 'Harbor', 'Moons'];

/**
 * The search, shared by the dock's field, which edits it, and the search
 * screen, which shows what it finds.
 */
@Injectable({ providedIn: 'root' })
export class Catalog {
  readonly query = signal('');
  /** What the keyboard's Search key last searched for. */
  readonly submitted = signal('');

  readonly results = computed(() => {
    const query = this.query().trim().toLowerCase();
    return query
      ? ALBUMS.filter((album) =>
          `${album.title} ${album.artist}`.toLowerCase().includes(query),
        )
      : [];
  });
}
