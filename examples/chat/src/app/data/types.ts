/**
 * The correspondence's shapes. Contacts and their letters are invented for
 * the app; times are made relative to now when the app starts, so the
 * conversations are always current.
 */

/** The drawn picture on a contact's stamp (see stamp.ts). */
export type StampMotif =
  | 'gull'
  | 'tram'
  | 'lemon'
  | 'mountain'
  | 'kettle'
  | 'fern'
  | 'heart'
  | 'sun'
  | 'tick'
  | 'star'
  | 'drop'
  | 'flower';

export type Contact = {
  readonly id: string;
  /** The name the letters are addressed to. */
  readonly name: string;
  /** Where the letters go: the city on the envelope and the postmark. */
  readonly city: string;
  readonly country: string;
  /** The contact's postage stamp, which stands in for an avatar. */
  readonly stamp: {
    /** The stamp's ink, as rgba(). */
    readonly color: string;
    readonly motif: StampMotif;
    /** The denomination printed in its corner, such as '45'. */
    readonly value: string;
  };
};

/** Who wrote a line: the person using the app, or the contact. */
export type Author = 'me' | 'them';

/**
 * One day's exchange in a conversation's history: a few letters back and
 * forth, written as a scene. `daysAgo` places it in time (0 is today); the
 * lines are spread over that day in order.
 */
export type Episode = {
  readonly daysAgo: number;
  /** The hour of the day the exchange starts, 0 to 23. */
  readonly hour: number;
  readonly lines: readonly (readonly [Author, string])[];
};

/**
 * How a contact answers when the person writes: a bank of replies by what
 * the person's letter seemed to be. The simulation picks one at random from
 * the matching bank, falling back to `other`.
 */
export type ReplyBank = {
  /** The person asked something (their letter has a question mark). */
  readonly question: readonly string[];
  /** The person said hello (hi, hey, hello, morning…). */
  readonly greeting: readonly string[];
  /** The person thanked them. */
  readonly thanks: readonly string[];
  /** The person sent a photo. */
  readonly photo: readonly string[];
  /** Anything else. */
  readonly other: readonly string[];
};

/** A contact with everything the app shows of them. */
export type Correspondent = Contact & {
  /** Oldest first. */
  readonly history: readonly Episode[];
  readonly replies: ReplyBank;
};
