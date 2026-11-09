// The people and their letters are invented for the app.
// cspell:words Rivka Odette
import { JONAH } from './jonah';
import { MEI } from './mei';
import { ODETTE } from './odette';
import { RIVKA } from './rivka';
import { TOMAS } from './tomas';
import type { Correspondent } from './types';

/** Everyone the person writes to, in the order the app lists them. */
export const CORRESPONDENTS: readonly Correspondent[] = [
  RIVKA,
  ODETTE,
  TOMAS,
  MEI,
  JONAH,
];
