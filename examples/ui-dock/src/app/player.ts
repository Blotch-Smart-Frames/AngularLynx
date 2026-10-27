import { Injectable, signal } from '@angular/core';

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
];

/** A shelf of albums, enough to scroll under the dock. */
export const ALBUMS: readonly Album[] = Array.from({ length: 18 }, (_, i) => ({
  id: i + 1,
  title: TITLES[i % TITLES.length][0],
  artist: TITLES[i % TITLES.length][1],
  cover: GRADIENTS[i % GRADIENTS.length],
}));

/**
 * What's playing, shared by the screens, which start an album, and the
 * dock's accessory, which shows it.
 */
@Injectable({ providedIn: 'root' })
export class Player {
  readonly album = signal<Album | null>(ALBUMS[0]);
  readonly playing = signal(false);

  play(album: Album): void {
    this.album.set(album);
    this.playing.set(true);
  }

  toggle(): void {
    this.playing.set(!this.playing());
  }

  stop(): void {
    this.album.set(null);
    this.playing.set(false);
  }
}
