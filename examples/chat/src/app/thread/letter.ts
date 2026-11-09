import {
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxGestureDetector,
  PanGesture,
} from '@blotch/angular-lynx';
import { UiIcon } from '../../components/ui/icon';
import type { Letter } from '../data/letters';
import { letterTime } from '../post/format';
import {
  AIRMAIL_RED,
  POSTMARK_INK,
  Postmark,
  reactionById,
  Stamp,
} from '../post/marks';

/**
 * How far a letter must be dragged to the left to reply to it, and as far
 * as it goes. Leftward, as Telegram does: a drag to the right is the
 * screen's own, back to the inbox.
 */
const REPLY_AT = 56;
const MAX_DRAG = 84;

/**
 * One letter: onion-skin white from the contact, aerogramme blue from the
 * person, with the letter it answers quoted above its text, a postcard if
 * it carried a photo, the stamps stuck on it, and, on the person's last
 * letter, the postmark saying where it's got to.
 *
 * Drag it to the left to reply to it; hold it for the stamps and copy.
 */
@Component({
  selector: 'app-letter',
  imports: [LYNX_ELEMENTS, LynxGestureDetector, Postmark, Stamp, UiIcon],
  host: { class: 'flex flex-col' },
  template: `
    <view
      class="relative flex flex-row px-3"
      [class.justify-end]="mine()"
      [style.padding-top.px]="stuck().length ? 14 : 0"
      [lynxGesture]="pan"
      [consume-slide-event]="sideways"
      (bindlongpress)="hold.emit()"
    >
      <!-- The reply arrow, uncovered as the letter is dragged. -->
      <view
        class="absolute flex h-9 w-9 items-center justify-center rounded-full"
        style="right: 10px; top: 50%; margin-top: -18px"
        [style.opacity]="Math.min(1, drag() / replyAt)"
        [style.background-color]="
          drag() >= replyAt ? 'rgba(200, 34, 48, 1)' : 'rgba(27, 39, 72, 0.1)'
        "
      >
        <ui-icon
          name="reply"
          size="sm"
          [class.text-paper]="drag() >= replyAt"
          [class.text-ink]="drag() < replyAt"
        />
      </view>

      <view
        class="relative flex flex-col shadow-letter"
        [class.bg-letter-mine]="mine()"
        [class.bg-letter]="!mine()"
        [style.transform]="'translateX(' + -drag() + 'px)'"
        [style.transition]="
          dragging() || reduceMotion()
            ? 'none'
            : 'transform 240ms cubic-bezier(0.22, 1, 0.36, 1)'
        "
        [style.max-width.px]="maxWidth()"
        [style.margin-top.px]="gapAbove()"
        accessibility-element="true"
        [attr.accessibility-label]="label()"
        accessibility-hint="Hold for stamps and copy"
      >
        @if (quoted(); as q) {
          <!-- The letter it answers, as a slip of onion skin clipped on. -->
          <view
            class="mx-2.5 mt-2.5 flex flex-col border px-2.5 py-1.5"
            style="border-color: rgba(27, 39, 72, 0.2); background-color: rgba(222, 231, 242, 0.6)"
          >
            <text class="font-postal text-[12px] tracking-[1px] text-postmark"
              >RE:
              {{ q.from === 'me' ? 'YOU' : contactName().toUpperCase() }}</text
            >
            <text
              class="text-[13px] leading-[17px] text-ellipsis text-ink-muted"
              [text-maxline]="2"
              >{{ q.photo ? 'A postcard' : q.text }}</text
            >
          </view>
        }
        @if (letter().photo; as photo) {
          <!-- A postcard: the photo with a white border, a little turned. -->
          <view
            class="m-2 flex flex-col bg-white p-1.5 shadow-letter"
            style="transform: rotate(-1.5deg)"
            (bindtap)="view.emit()"
            accessibility-element="true"
            accessibility-traits="button"
            accessibility-label="Open the postcard"
          >
            <image
              [src]="photo.src"
              mode="aspectFill"
              [style.width.px]="postcardWidth()"
              [style.height.px]="
                postcardWidth() * Math.min(1.25, photo.height / photo.width)
              "
            ></image>
          </view>
        }
        @if (letter().text) {
          <text class="px-3.5 pt-2.5 text-[16px] leading-[22px] text-ink">{{
            letter().text
          }}</text>
        }
        <text
          class="self-end px-3 pt-1 pb-2 font-postal text-[11px] tracking-[1px] text-ink-muted"
          >{{ time() }}</text
        >
        @if (stuck().length) {
          <!-- Stamps stuck on the letter's outer top corner, each at its
               own angle, clear of the text and the time. The row makes room
               above, since a list item clips what overflows it. -->
          <view
            class="absolute flex flex-row"
            style="top: -14px"
            [style.left.px]="mine() ? -10 : undefined"
            [style.right.px]="mine() ? undefined : -10"
          >
            @for (stamp of stuck(); track stamp.id; let i = $index) {
              <view
                class="ml-0.5"
                [style.transform]="'rotate(' + (i % 2 ? 7 : -6) + 'deg)'"
              >
                <app-stamp
                  [color]="stamp.color"
                  [motif]="stamp.id"
                  [size]="22"
                />
              </view>
            }
          </view>
        }
      </view>
    </view>
    @if (receipt(); as r) {
      <view class="flex flex-row justify-end pt-1 pr-4">
        <app-postmark
          [top]="r.top"
          [middle]="r.middle"
          [size]="40"
          [plain]="true"
          [struck]="true"
          [ink]="r.ink"
        />
      </view>
    }
  `,
})
export class LetterView {
  readonly letter = input.required<Letter>();
  readonly quoted = input<Letter | undefined>();
  readonly contactName = input('');
  readonly stamps = input<readonly string[]>([]);
  /** Shows where the letter has got to: the person's latest letter only. */
  readonly showReceipt = input(false);
  /** The first letter of a run from one side sits further from the last. */
  readonly startsRun = input(true);
  readonly width = input(402);

  readonly reply = output<void>();
  readonly hold = output<void>();
  readonly view = output<void>();

  protected readonly Math = Math;
  protected readonly replyAt = REPLY_AT;
  protected readonly reduceMotion = inject(LynxAccessibilitySettings)
    .reduceMotion;

  protected readonly mine = computed(() => this.letter().from === 'me');
  protected readonly maxWidth = computed(() => Math.round(this.width() * 0.78));
  protected readonly postcardWidth = computed(() =>
    Math.round(this.width() * 0.6),
  );
  protected readonly gapAbove = computed(() => (this.startsRun() ? 14 : 4));
  protected readonly time = computed(() => letterTime(this.letter().at));

  /** SENT, then DELIVERED, then READ in airmail red, struck as each lands. */
  protected readonly receipt = computed(() => {
    if (!this.showReceipt() || !this.mine()) return null;
    const status = this.letter().status;
    if (!status) return null;
    return {
      top:
        status === 'read'
          ? 'READ'
          : status === 'delivered'
            ? 'DELIVERED'
            : 'SENT',
      middle: letterTime(this.letter().at),
      ink: status === 'read' ? AIRMAIL_RED : POSTMARK_INK,
    };
  });

  /** The stamps stuck on the letter, drawn (see REACTIONS). */
  protected readonly stuck = computed(() =>
    this.stamps().flatMap((id) => reactionById(id) ?? []),
  );

  protected readonly label = computed(() => {
    const letter = this.letter();
    const who = letter.from === 'me' ? 'You' : this.contactName();
    const what = letter.photo ? `a postcard. ${letter.text}` : letter.text;
    const stamps = this.stuck().length
      ? `. Stamps: ${this.stuck()
          .map((stamp) => stamp.label)
          .join(', ')}`
      : '';
    return `${who}, ${this.time()}: ${what}${stamps}`;
  });

  /** How far the letter is dragged to the left, in layout pixels. */
  protected readonly drag = signal(0);
  protected readonly dragging = signal(false);

  /** Leftward drags reply; anything steeper scrolls the thread. */
  protected readonly sideways: [number, number][] = [
    [150, 180],
    [-180, -150],
  ];
  protected readonly pan = new PanGesture()
    .minDistance(6)
    .onStart(() => this.dragging.set(true))
    .onUpdate((event) => {
      // Leftward only, with resistance past the reply point.
      const x = Math.max(0, -event.translationX);
      const eased = x < REPLY_AT ? x : REPLY_AT + (x - REPLY_AT) * 0.35;
      this.drag.set(Math.min(MAX_DRAG, eased));
    })
    .onEnd(() => {
      if (this.drag() >= REPLY_AT) this.reply.emit();
      this.dragging.set(false);
      this.drag.set(0);
    });
}
