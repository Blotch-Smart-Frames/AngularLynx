import type { Author, Correspondent } from './types';

/** A photo sent with a letter: a picked one, shown as a postcard. */
export type Photo = {
  readonly src: string;
  readonly width: number;
  readonly height: number;
};

/** Where a letter of mine has got to. */
export type Status = 'sent' | 'delivered' | 'read';

/** One letter in a conversation, as the thread shows it. */
export type Letter = {
  readonly id: string;
  readonly from: Author;
  readonly text: string;
  readonly photo?: Photo;
  /** When it was written, in ms since the epoch. */
  readonly at: number;
  /** The letter this one replies to, quoted above it. */
  readonly replyTo?: string;
  /** Only letters of mine written in the app have one. */
  readonly status?: Status;
};

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * Minutes between two lines of an exchange, from the line itself: a short
 * line follows fast, a long one took a while to write. Deterministic, so
 * the times are the same on every launch.
 */
const gap = (text: string, index: number): number =>
  1 + ((text.length * 7 + index * 13) % 9) + Math.floor(text.length / 60);

/**
 * A correspondent's history as letters, oldest first, placed in time
 * relative to `now`: each episode starts at its hour on its day and its
 * lines follow a few minutes apart. Today's exchange is moved earlier if it
 * would otherwise end in the future.
 */
export const lettersOf = (
  correspondent: Correspondent,
  now: number,
): Letter[] => {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const letters: Letter[] = [];
  correspondent.history.forEach((episode, episodeIndex) => {
    let at =
      midnight.getTime() - episode.daysAgo * DAY + episode.hour * 60 * MINUTE;
    const times = episode.lines.map(([, text], index) => {
      at += gap(text, index) * MINUTE;
      return at;
    });
    // Today's lines can't be later than now: shift the exchange back.
    const overshoot = Math.max(
      0,
      times[times.length - 1]! - (now - 4 * MINUTE),
    );
    episode.lines.forEach(([from, text], index) => {
      letters.push({
        id: `${correspondent.id}-${episodeIndex}-${index}`,
        from,
        text,
        at: times[index]! - overshoot,
      });
    });
  });
  return letters;
};

/** Whether two times fall on the same calendar day, where the phone is. */
export const sameDay = (a: number, b: number): boolean =>
  new Date(a).toDateString() === new Date(b).toDateString();
