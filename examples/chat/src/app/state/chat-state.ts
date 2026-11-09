import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { LynxLocalStorage } from '@blotch/angular-lynx';
import { CORRESPONDENTS } from '../data/correspondents';
import { type Letter, type Photo, lettersOf } from '../data/letters';
import type { Correspondent, ReplyBank } from '../data/types';

/** Letters a thread shows at first, and how many each scroll up adds. */
export const PAGE = 30;

/** What's kept on the device, per correspondent. */
type Saved = {
  /** Letters written in the app (mine and the replies), photos left out. */
  readonly added: Record<string, readonly Letter[]>;
  /** Stamps stuck on letters, by letter id. */
  readonly reactions: Record<string, readonly string[]>;
  /** When each conversation was last read. */
  readonly readAt: Record<string, number>;
};

const KEY = 'chat.v1';

/** How long a contact takes to answer, as a person would. */
const DELIVERED_AFTER = 700;
const READ_AFTER = 1600;
const writingFor = (reply: string) => 1200 + Math.min(2400, reply.length * 45);

/**
 * The correspondence, shared by the inbox and every thread, and kept on the
 * device: each conversation's history (bundled) and what's been written
 * since, the stamps stuck on letters, and what's been read. It also plays
 * the contacts: when the person writes, the letter is delivered, read, and
 * answered after the contact has been "writing" for a while.
 */
@Injectable({ providedIn: 'root' })
export class ChatState {
  readonly #storage = inject(LynxLocalStorage);

  readonly correspondents = CORRESPONDENTS;
  /** Fixed at launch, so the bundled history doesn't drift as time passes. */
  readonly #now = Date.now();
  readonly #history = new Map(
    CORRESPONDENTS.map((c) => [c.id, lettersOf(c, this.#now)]),
  );

  readonly #added = signal<Record<string, readonly Letter[]>>({});
  readonly #reactions = signal<Record<string, readonly string[]>>({});
  readonly #readAt = signal<Record<string, number>>({});
  /** Who is writing a reply right now. */
  readonly #writing = signal<ReadonlySet<string>>(new Set());
  readonly #restored = signal(false);
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();

  constructor() {
    this.#restore();
    effect(() => {
      // Photos are megabytes, too many for key-value storage, and they're
      // still in the person's library: the letters that carried them go.
      const added = Object.fromEntries(
        Object.entries(this.#added()).map(([id, letters]) => [
          id,
          letters.filter((letter) => !letter.photo),
        ]),
      );
      const saved: Saved = {
        added,
        reactions: this.#reactions(),
        readAt: this.#readAt(),
      };
      if (!this.#restored()) return;
      this.#storage.setItem(KEY, saved).catch(() => {});
    });
    inject(DestroyRef).onDestroy(() => this.#timers.forEach(clearTimeout));
  }

  correspondent(id: string): Correspondent | undefined {
    return CORRESPONDENTS.find((c) => c.id === id);
  }

  /**
   * Every letter of a conversation, oldest first.
   */
  letters(id: string): Letter[] {
    return [...(this.#history.get(id) ?? []), ...(this.#added()[id] ?? [])];
  }

  /**
   * A signal of a conversation's letters, for a thread to show.
   */
  lettersOf(id: string) {
    return computed(() => {
      this.#added();
      return this.letters(id);
    });
  }

  reactions(letterId: string): readonly string[] {
    return this.#reactions()[letterId] ?? [];
  }

  isWriting(id: string): boolean {
    return this.#writing().has(id);
  }

  /**
   * Letters from the contact that came after the person last read the
   * conversation, or, if they never opened it here, after their last letter.
   */
  unread(id: string): number {
    const letters = this.letters(id);
    const readAt = this.#readAt()[id];
    if (readAt !== undefined) {
      return letters.filter((l) => l.from === 'them' && l.at > readAt).length;
    }
    let count = 0;
    for (
      let i = letters.length - 1;
      i >= 0 && letters[i]!.from === 'them';
      i--
    ) {
      count++;
    }
    return count;
  }

  /** The inbox: every conversation, the latest letter first. */
  readonly inbox = computed(() => {
    this.#added();
    this.#readAt();
    this.#writing();
    return CORRESPONDENTS.map((correspondent) => {
      const letters = this.letters(correspondent.id);
      return {
        correspondent,
        last: letters[letters.length - 1]!,
        unread: this.unread(correspondent.id),
        writing: this.isWriting(correspondent.id),
      };
    }).sort((a, b) => b.last.at - a.last.at);
  });

  markRead(id: string): void {
    this.#readAt.update((all) => ({ ...all, [id]: Date.now() }));
  }

  /**
   * Sticks a stamp on a letter, or peels it off if it's already there.
   */
  react(letterId: string, stamp: string): void {
    this.#reactions.update((all) => {
      const current = all[letterId] ?? [];
      const next = current.includes(stamp)
        ? current.filter((s) => s !== stamp)
        : [...current, stamp];
      return { ...all, [letterId]: next };
    });
  }

  /**
   * Sends a letter, and plays the rest: delivered, then read, then the
   * contact writing, then their reply.
   */
  send(
    id: string,
    text: string,
    options: { photo?: Photo; replyTo?: string } = {},
  ): void {
    const correspondent = this.correspondent(id);
    if (!correspondent) return;
    const letter: Letter = {
      id: `${id}-m${Date.now().toString(36)}`,
      from: 'me',
      text,
      at: Date.now(),
      status: 'sent',
      ...(options.photo ? { photo: options.photo } : {}),
      ...(options.replyTo ? { replyTo: options.replyTo } : {}),
    };
    this.#append(id, letter);
    this.#later(DELIVERED_AFTER, () =>
      this.#setStatus(id, letter.id, 'delivered'),
    );
    this.#later(READ_AFTER, () => {
      this.#setStatus(id, letter.id, 'read');
      const reply = pickReply(correspondent.replies, text, !!options.photo);
      this.#writing.update((set) => new Set(set).add(id));
      this.#later(writingFor(reply), () => {
        this.#writing.update((set) => {
          const next = new Set(set);
          next.delete(id);
          return next;
        });
        this.#append(id, {
          id: `${id}-r${Date.now().toString(36)}`,
          from: 'them',
          text: reply,
          at: Date.now(),
        });
      });
    });
  }

  #append(id: string, letter: Letter): void {
    this.#added.update((all) => ({
      ...all,
      [id]: [...(all[id] ?? []), letter],
    }));
  }

  #setStatus(id: string, letterId: string, status: Letter['status']): void {
    this.#added.update((all) => ({
      ...all,
      [id]: (all[id] ?? []).map((letter) =>
        letter.id === letterId ? { ...letter, status } : letter,
      ),
    }));
  }

  #later(ms: number, run: () => void): void {
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      run();
    }, ms);
    this.#timers.add(timer);
  }

  async #restore(): Promise<void> {
    try {
      const saved = await this.#storage.getItem<Saved>(KEY);
      if (saved) {
        this.#added.set(saved.added ?? {});
        this.#reactions.set(saved.reactions ?? {});
        this.#readAt.set(saved.readAt ?? {});
      }
    } catch {
      // Nothing saved, or no storage here (a test): start from the bundle.
    }
    this.#restored.set(true);
  }
}

/**
 * What the person's letter seems to be, to answer it in kind.
 */
const pickReply = (bank: ReplyBank, text: string, photo: boolean): string => {
  const lower = text.toLowerCase();
  const pool = photo
    ? bank.photo
    : text.includes('?')
      ? bank.question
      : /\b(thanks|thank you|thx|cheers)\b/.test(lower)
        ? bank.thanks
        : /^(hi|hey|hello|morning|good morning|evening|yo)\b/.test(lower)
          ? bank.greeting
          : bank.other;
  const options = pool.length ? pool : bank.other;
  return options[Math.floor(Math.random() * options.length)]!;
};
