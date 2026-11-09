import { Location } from '@angular/common';
import {
  Component,
  type ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  ImagePickerError,
  LYNX_ELEMENTS,
  LynxClipboard,
  type ListScrollDetail,
  LynxImagePicker,
  LynxSystemInfo,
} from '@blotch/angular-lynx';
import { UiIcon } from '../../components/ui/icon';
import { toast } from '../../components/ui/toast';
import { type Letter, sameDay } from '../data/letters';
import { dayHeading, postmarkDay } from '../post/format';
import { Postmark, REACTIONS, Stamp } from '../post/marks';
import { ChatState, PAGE } from '../state/chat-state';
import { LetterView } from './letter';

/** How long older letters take to arrive, as if fetched from a server. */
const FETCH_MS = 450;

/**
 * The rows that aren't letters have fixed heights, so where the first
 * letter sits is known exactly: older letters arriving above it can then
 * put it back where it was (see `older`).
 */
const HEIGHTS = { start: 64, loading: 64, day: 80 } as const;

type Row =
  | { readonly kind: 'start'; readonly key: string }
  | { readonly kind: 'loading'; readonly key: string }
  | { readonly kind: 'day'; readonly key: string; readonly at: number }
  | {
      readonly kind: 'letter';
      readonly key: string;
      readonly letter: Letter;
      readonly startsRun: boolean;
    }
  | { readonly kind: 'writing'; readonly key: string };

/**
 * A conversation: the letters between the person and one contact, newest at
 * the bottom, in a virtualized `<list>`. It opens on the newest letter and
 * fetches older ones a page at a time as the person scrolls up, holding the
 * letters on screen where they are while the page arrives above them.
 *
 * Below the letters, the composer: a postcard (photo) button, the field and
 * Send, kept above the on-screen keyboard. Above them, while replying, the
 * letter being answered.
 */
@Component({
  selector: 'app-thread',
  imports: [LYNX_ELEMENTS, LetterView, Postmark, Stamp, UiIcon],
  host: { class: 'flex flex-1 flex-col bg-paper' },
  template: `
    @if (correspondent(); as c) {
      <!-- The header: back, the contact's stamp, name and city, or that
           they're writing. -->
      <view class="relative z-10 flex flex-col bg-paper pt-safe">
        <view class="flex h-[60px] flex-row items-center pr-4">
          <view
            class="flex h-11 w-11 items-center justify-center"
            (bindtap)="location.back()"
            accessibility-element="true"
            accessibility-traits="button"
            accessibility-label="Back to letters"
          >
            <ui-icon name="chevron-left" size="lg" class="text-ink" />
          </view>
          <app-stamp
            [color]="c.stamp.color"
            [motif]="c.stamp.motif"
            [value]="c.stamp.value"
            [size]="34"
          />
          <view class="ml-3 flex flex-1 flex-col">
            <text
              class="font-postal text-[22px] leading-[24px] tracking-[0.5px] text-ink"
              accessibility-traits="header"
              >{{ c.name }}</text
            >
            <text
              class="font-postal text-[12px] tracking-[2px]"
              [class.text-airmail-red]="writing()"
              [class.text-ink-muted]="!writing()"
              >{{ writing() ? 'WRITING TO YOU…' : c.city.toUpperCase() }}</text
            >
          </view>
        </view>
        <view
          class="h-px w-full"
          style="background-color: rgba(27, 39, 72, 0.2)"
        ></view>
      </view>

      <list
        #list
        class="flex-1"
        list-type="single"
        [attr.initial-scroll-index]="rows().length - 1"
        [upper-threshold-item-count]="4"
        [need-visible-item-info]="true"
        [scroll-event-throttle]="50"
        (bindscrolltoupper)="older()"
        (bindscroll)="scrolled($event)"
        (bindlayoutcomplete)="laidOut()"
        (bindscrollstatechange)="scrollState($event.detail.state)"
        accessibility-label="Letters"
      >
        @for (row of rows(); track row.key) {
          <list-item
            [attr.item-key]="row.key"
            [attr.reuse-identifier]="row.kind"
            [attr.estimated-main-axis-size-px]="estimate(row)"
          >
            @switch (row.kind) {
              @case ('start') {
                <view
                  class="flex flex-col items-center justify-end px-8 pb-2"
                  [style.height.px]="heights.start"
                >
                  <text
                    class="text-center font-postal text-[13px] tracking-[2px] text-ink-muted"
                    >THE FIRST LETTER BETWEEN YOU</text
                  >
                </view>
              }
              @case ('loading') {
                <view
                  class="flex flex-row items-center justify-center"
                  [style.height.px]="heights.loading"
                >
                  <app-postmark
                    top="SORTING"
                    middle="···"
                    [size]="40"
                    [plain]="true"
                  />
                  <text class="ml-2 text-[13px] text-ink-muted"
                    >Fetching older letters</text
                  >
                </view>
              }
              @case ('day') {
                <view
                  class="flex flex-row items-center justify-center"
                  [style.height.px]="heights.day"
                >
                  <app-postmark
                    [top]="c.city.toUpperCase()"
                    [middle]="dayLabel(row.at)"
                    [year]="yearOf(row.at)"
                    [size]="50"
                    [tilt]="-4"
                  />
                </view>
              }
              @case ('letter') {
                <app-letter
                  [letter]="row.letter"
                  [quoted]="quoted(row.letter)"
                  [contactName]="c.name"
                  [stamps]="chat.reactions(row.letter.id)"
                  [showReceipt]="row.letter.id === lastMine()"
                  [startsRun]="row.startsRun"
                  [width]="screenWidth()"
                  (reply)="replyTo.set(row.letter)"
                  (hold)="held.set(row.letter)"
                  (view)="viewing.set(row.letter)"
                />
              }
              @case ('writing') {
                <!-- A letter being written: three dots of ink, coming and
                     going, on a slip of onion skin. -->
                <view class="flex flex-row items-center px-4 pt-3 pb-1">
                  <view
                    class="flex flex-row items-center bg-letter px-3 py-3 shadow-letter"
                  >
                    @for (dot of [0, 1, 2]; track dot) {
                      <view
                        class="writing mx-[3px] h-[7px] w-[7px] rounded-full bg-postmark"
                        [style.animation-delay]="dot * 180 + 'ms'"
                      ></view>
                    }
                  </view>
                  <text
                    class="ml-2.5 font-postal text-[14px] tracking-[1.5px] text-postmark"
                    >{{ c.name.toUpperCase() }} IS WRITING</text
                  >
                </view>
              }
            }
          </list-item>
        }
      </list>

      <!-- The composer, above the keyboard when it's open. -->
      <view
        class="relative z-10 flex flex-col bg-paper"
        [style.padding-bottom]="composerBottom()"
      >
        <view
          class="h-px w-full"
          style="background-color: rgba(27, 39, 72, 0.2)"
        ></view>
        @if (replyTo(); as r) {
          <view class="flex flex-row items-center px-4 pt-2">
            <!-- The letter being answered, as a slip of onion skin. -->
            <view
              class="flex flex-1 flex-col border px-2.5 py-1.5"
              style="border-color: rgba(27, 39, 72, 0.2); background-color: rgba(250, 251, 252, 0.7)"
            >
              <text class="font-postal text-[12px] tracking-[1px] text-postmark"
                >REPLYING TO
                {{ r.from === 'me' ? 'YOURSELF' : c.name.toUpperCase() }}</text
              >
              <text
                class="text-[13px] text-ellipsis text-ink-muted"
                [text-maxline]="1"
                >{{ r.photo ? 'A postcard' : r.text }}</text
              >
            </view>
            <view
              class="flex h-9 w-9 items-center justify-center"
              (bindtap)="replyTo.set(null)"
              accessibility-element="true"
              accessibility-traits="button"
              accessibility-label="Don't reply to it"
            >
              <ui-icon name="x" size="sm" class="text-ink-muted" />
            </view>
          </view>
        }
        <view class="flex flex-row items-center px-2 py-2">
          <view
            class="flex h-11 w-11 items-center justify-center"
            (bindtap)="attach()"
            accessibility-element="true"
            accessibility-traits="button"
            accessibility-label="Send a photo as a postcard"
          >
            <ui-icon name="camera" size="md" class="text-ink" />
          </view>
          <view
            class="mx-1 flex h-11 flex-1 flex-row items-center bg-letter px-3 shadow-letter"
          >
            <input
              #field
              class="h-11 flex-1 text-[16px] text-ink"
              placeholder="Write a letter"
              placeholder-color="#54607c"
              style="-x-placeholder-color: #54607c"
              confirm-type="send"
              [value]="draft()"
              (bindinput)="draft.set($event.detail.value)"
              (bindconfirm)="send()"
              (bindkeyboardheightchange)="keyboard($event.detail.height)"
              accessibility-label="Your letter"
            />
          </view>
          <view
            class="flex h-11 w-11 items-center justify-center"
            [class.bg-airmail-red]="draft().trim()"
            (bindtap)="send()"
            accessibility-element="true"
            accessibility-traits="button"
            accessibility-label="Send"
          >
            <ui-icon
              name="send"
              size="md"
              [class.text-paper]="draft().trim()"
              [class.text-ink-muted]="!draft().trim()"
            />
          </view>
        </view>
      </view>

      @if (held(); as h) {
        <!-- Holding a letter: a sheet of stamps to stick on it, and what
             else can be done with it. -->
        <view
          class="absolute top-0 right-0 bottom-0 left-0 z-20 flex flex-col justify-end"
          style="background-color: rgba(27, 39, 72, 0.35)"
          (bindtap)="held.set(null)"
          accessibility-label="Close"
        >
          <view class="flex flex-col bg-paper px-4 pt-4 pb-safe-4">
            <!-- The held letter, lifted off the thread onto the sheet. -->
            <view
              class="mb-4 flex flex-col px-3.5 py-2.5 shadow-letter"
              [class.bg-letter-mine]="h.from === 'me'"
              [class.bg-letter]="h.from !== 'me'"
              style="transform: rotate(-1deg)"
            >
              <text
                class="text-[15px] leading-[20px] text-ellipsis text-ink"
                [text-maxline]="3"
                >{{ h.photo ? 'A postcard' : h.text }}</text
              >
            </view>
            <text class="font-postal text-[13px] tracking-[2px] text-postmark"
              >STICK A STAMP ON IT</text
            >
            <view class="mt-3 flex flex-row justify-between">
              @for (stamp of stamps; track stamp.id) {
                <view
                  class="flex flex-col items-center"
                  [style.transform]="
                    chat.reactions(h.id).includes(stamp.id)
                      ? 'translateY(-4px) rotate(-5deg)'
                      : 'none'
                  "
                  (bindtap)="react(h, stamp.id)"
                  accessibility-element="true"
                  accessibility-traits="button"
                  [attr.accessibility-label]="
                    (chat.reactions(h.id).includes(stamp.id)
                      ? 'Peel off '
                      : 'Stick ') + stamp.label
                  "
                >
                  <app-stamp
                    [color]="stamp.color"
                    [motif]="stamp.id"
                    [size]="40"
                  />
                  <text
                    class="mt-1 font-postal text-[11px] tracking-[1px]"
                    [class.text-airmail-red]="
                      chat.reactions(h.id).includes(stamp.id)
                    "
                    [class.text-ink-muted]="
                      !chat.reactions(h.id).includes(stamp.id)
                    "
                    >{{ stamp.label.toUpperCase() }}</text
                  >
                </view>
              }
            </view>
            <view class="mt-4 flex flex-row">
              <view
                class="mr-2 flex h-11 flex-1 flex-row items-center justify-center bg-letter shadow-letter"
                (bindtap)="replyTo.set(h); held.set(null)"
                accessibility-element="true"
                accessibility-traits="button"
              >
                <ui-icon name="reply" size="sm" class="text-ink" />
                <text
                  class="ml-2 font-postal text-[15px] tracking-[1px] text-ink"
                  >REPLY</text
                >
              </view>
              <view
                class="flex h-11 flex-1 flex-row items-center justify-center bg-letter shadow-letter"
                (bindtap)="copy(h)"
                accessibility-element="true"
                accessibility-traits="button"
              >
                <ui-icon name="copy" size="sm" class="text-ink" />
                <text
                  class="ml-2 font-postal text-[15px] tracking-[1px] text-ink"
                  >COPY</text
                >
              </view>
            </view>
          </view>
        </view>
      }

      @if (viewing()?.photo; as photo) {
        <!-- The postcard, full screen; tap to put it down. -->
        <view
          class="absolute top-0 right-0 bottom-0 left-0 z-20 flex items-center justify-center"
          style="background-color: rgba(10, 14, 26, 0.94)"
          (bindtap)="viewing.set(null)"
          accessibility-element="true"
          accessibility-label="The postcard. Tap to close."
        >
          <image
            class="h-full w-full"
            mode="aspectFit"
            [src]="photo.src"
          ></image>
        </view>
      }
    }
  `,
  styles: `
    @keyframes writing {
      from {
        opacity: 0.35;
      }
      to {
        opacity: 1;
      }
    }
    .writing {
      animation: writing 700ms ease-in-out infinite alternate;
    }
  `,
})
export class Thread {
  /** The correspondent's id, from the route (`letters/:id`). */
  readonly id = input.required<string>();

  protected readonly chat = inject(ChatState);
  protected readonly location = inject(Location);
  readonly #picker = inject(LynxImagePicker);
  readonly #clipboard = inject(LynxClipboard);
  readonly #system = inject(LynxSystemInfo);
  readonly list = viewChild<ElementRef>('list');

  /** The sheet of stamps a letter can be marked with. */
  protected readonly stamps = REACTIONS;
  protected readonly correspondent = computed(() =>
    this.chat.correspondent(this.id()),
  );
  protected readonly writing = computed(() => {
    this.chat.inbox();
    return this.chat.isWriting(this.id());
  });
  protected readonly screenWidth = signal(globalThis.innerWidth || 402);

  readonly #letters = computed(() => this.chat.lettersOf(this.id())());
  /** How many of the newest letters are loaded. */
  readonly #shown = signal(PAGE);
  readonly #fetching = signal(false);

  protected readonly rows = computed<Row[]>(() => {
    const letters = this.#letters();
    const shown = letters.slice(-this.#shown());
    const rows: Row[] = [];
    if (shown.length < letters.length) {
      rows.push({ kind: 'loading', key: 'loading' });
    } else {
      rows.push({ kind: 'start', key: 'start' });
    }
    shown.forEach((letter, index) => {
      const before = shown[index - 1];
      if (!before || !sameDay(before.at, letter.at)) {
        rows.push({
          kind: 'day',
          key: `day-${postmarkDay(letter.at)}-${new Date(letter.at).getFullYear()}`,
          at: letter.at,
        });
      }
      rows.push({
        kind: 'letter',
        key: letter.id,
        letter,
        startsRun:
          !before ||
          before.from !== letter.from ||
          !sameDay(before.at, letter.at),
      });
    });
    if (this.writing()) rows.push({ kind: 'writing', key: 'writing' });
    return rows;
  });

  /** The person's newest letter, which shows where it's got to. */
  protected readonly lastMine = computed(() => {
    const letters = this.#letters();
    for (let i = letters.length - 1; i >= 0; i--) {
      if (letters[i]!.from === 'me')
        return letters[i]!.status ? letters[i]!.id : null;
    }
    return null;
  });

  protected readonly draft = signal('');
  protected readonly replyTo = signal<Letter | null>(null);
  protected readonly held = signal<Letter | null>(null);
  protected readonly viewing = signal<Letter | null>(null);
  readonly #keyboard = signal(0);
  /**
   * Above the keyboard while it's open; otherwise clear of the home
   * indicator or the gesture bar (an inline env() is turned into pixels
   * where Lynx can't read it).
   */
  protected readonly composerBottom = computed(() =>
    this.#keyboard() ? `${this.#keyboard()}px` : 'env(safe-area-inset-bottom)',
  );

  protected readonly heights = HEIGHTS;
  /** How far the list is scrolled, from its scroll events. */
  #scrollTop = 0;

  constructor() {
    // Opening the thread reads it; so does every reply that arrives while
    // it's open.
    effect(() => {
      this.#letters();
      untracked(() => this.chat.markRead(this.id()));
    });

    // A new letter at the bottom (sent, or a reply) scrolls to it. The
    // first scroll, to open on the newest letter, waits for the list's
    // first layout (see laidOut): before it, a native list has no items to
    // scroll to, and `initial-scroll-index` is read before the rows exist.
    let count = 0;
    effect(() => {
      const total = this.#letters().length;
      const writing = this.writing();
      if (count && (total > count || writing)) {
        setTimeout(() => this.#toBottom(true));
      }
      count = total;
    });
    // Opening: put the newest letter at the bottom each frame while the
    // screen slides in and the list lays itself out (about 40 frames), until
    // the person starts scrolling.
    this.#retry(
      () => this.#opening && this.#openAtBottom(),
      40,
      () => (this.#opening = false),
    );
  }

  protected estimate(row: Row): number {
    switch (row.kind) {
      case 'day':
        return HEIGHTS.day;
      case 'loading':
        return HEIGHTS.loading;
      case 'start':
        return HEIGHTS.start;
      case 'letter':
        return row.letter.photo
          ? 260
          : 46 + Math.ceil(row.letter.text.length / 32) * 22;
      default:
        return 56;
    }
  }

  /**
   * The year on a day's postmark: none for today and yesterday.
   */
  protected yearOf(at: number): string {
    const label = dayHeading(at);
    return label === 'TODAY' || label === 'YESTERDAY'
      ? ''
      : String(new Date(at).getFullYear());
  }

  protected dayLabel(at: number): string {
    return dayHeading(at);
  }

  protected quoted(letter: Letter): Letter | undefined {
    if (!letter.replyTo) return undefined;
    return this.#letters().find((l) => l.id === letter.replyTo);
  }

  protected scrolled(event: { detail: ListScrollDetail }): void {
    this.#scrollTop = event.detail.scrollTop;
    // The web preview sends no scroll state: a scroll the person made
    // (eventSource 2) also ends the opening.
    if (event.detail.eventSource === 2 && Math.abs(event.detail.deltaY) > 2) {
      this.#opening = false;
    }
  }

  /**
   * Fetches a page of older letters, when there are any, and keeps the
   * letters on screen where they are while the page arrives above them.
   *
   * The list can't do that by itself: on the web its scroll position stays
   * put, so the new page slides into view, and a native list keeps its
   * offset the same way. So before the page lands, note where the first
   * letter is on screen: the rows above it have fixed heights, so its top is
   * their sum less the scroll. Once the page has rendered, scroll that
   * letter back to the same place, before the screen next updates.
   */
  protected older(): void {
    if (this.#fetching()) return;
    if (this.#shown() >= this.#letters().length) return;
    this.#fetching.set(true);
    setTimeout(() => {
      const before = this.rows();
      const first = before.findIndex((row) => row.kind === 'letter');
      const above = before
        .slice(0, first)
        .reduce((sum, row) => sum + this.estimate(row), 0);
      const onScreen = above - this.#scrollTop;
      const key = before[first]?.key;
      this.#shown.update((shown) => shown + PAGE);
      this.#fetching.set(false);
      this.#restore = { key, onScreen };
      // A native list says when it has laid the page out (laidOut). The
      // web preview's doesn't, so try each frame for a few: the first try
      // that lands puts the letter back, the rest repeat it.
      this.#retry(
        () => this.#scrollBack(),
        6,
        () => (this.#restore = null),
      );
    }, FETCH_MS);
  }

  /** Where to put the letter that was first, once the page is laid out. */
  #restore: { key: string | undefined; onScreen: number } | null = null;

  /** Until the thread has opened on its newest letter. */
  #opening = true;

  protected laidOut(): void {
    if (this.#opening) this.#openAtBottom();
    if (this.#restore && this.#system.platform !== 'web') {
      this.#scrollBack();
      this.#restore = null;
    }
  }

  #openAtBottom(): void {
    if (this.list()) this.#toBottom(false);
  }

  /**
   * The person took hold of the list: stop placing it for them.
   */
  protected scrollState(state: number): void {
    if (state === 2) this.#opening = false;
  }

  /**
   * Runs `step` each frame for a few frames: the web preview's list ignores
   * scrolls until its new items are in the page, which takes a frame or two
   * and sends no event to say so.
   */
  #retry(step: () => unknown, frames: number, done: () => void): void {
    let tries = 0;
    const tick = () => {
      step();
      if (++tries < frames) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
  }

  #scrollBack(): void {
    const restore = this.#restore;
    if (!restore) return;
    const position = this.rows().findIndex((row) => row.key === restore.key);
    if (position < 0) return;
    this.list()?.nativeElement.invoke?.('scrollToPosition', {
      position,
      alignTo: 'top',
      // Past the letter's top by as much as it was below the screen's.
      offset: -restore.onScreen,
      smooth: false,
    });
  }

  protected send(): void {
    const text = this.draft().trim();
    if (!text) return;
    this.chat.send(this.id(), text, { replyTo: this.replyTo()?.id });
    this.draft.set('');
    this.replyTo.set(null);
  }

  /**
   * Picks a photo and sends it as a postcard.
   */
  protected async attach(): Promise<void> {
    try {
      const picked = await this.#picker.pick({
        maxDimension: 1600,
        quality: 0.85,
      });
      if (!picked) return;
      const src = URL.createObjectURL(picked.blob);
      const size = await imageSize(src);
      this.chat.send(this.id(), this.draft().trim(), {
        photo: { src, ...size },
        replyTo: this.replyTo()?.id,
      });
      this.draft.set('');
      this.replyTo.set(null);
    } catch (error) {
      toast({
        title:
          error instanceof ImagePickerError && error.code === 'unavailable'
            ? 'No photo library here'
            : "Couldn't attach that photo",
        description:
          error instanceof ImagePickerError && error.code === 'unavailable'
            ? 'Lynx Explorer has no photo picker. Try the web preview or the app.'
            : undefined,
      });
    }
  }

  protected react(letter: Letter, stamp: string): void {
    this.chat.react(letter.id, stamp);
    this.held.set(null);
  }

  protected async copy(letter: Letter): Promise<void> {
    this.held.set(null);
    await this.#clipboard.setString(letter.text).catch(() => {});
  }

  protected noop(): void {}

  /**
   * The keyboard opened, moved or closed. iOS reports points from the
   * window's bottom, which is what the layout uses; Android reports
   * physical pixels.
   */
  protected keyboard(height: number): void {
    const layout =
      this.#system.platform === 'Android'
        ? height / (this.#system.pixelRatio || 1)
        : height;
    this.#keyboard.set(Math.max(0, Math.round(layout)));
    setTimeout(() => this.#toBottom(true));
  }

  #toBottom(smooth: boolean): void {
    const last = this.rows().length - 1;
    if (last < 0) return;
    // The web preview's list ignores alignTo and scrolls to the item's
    // top, which the end of the content clamps to the bottom anyway.
    this.list()?.nativeElement.invoke?.('scrollToPosition', {
      position: last,
      alignTo: 'bottom',
      smooth,
    });
  }
}

const imageSize = (src: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 4, height: 3 });
    image.src = src;
  });
