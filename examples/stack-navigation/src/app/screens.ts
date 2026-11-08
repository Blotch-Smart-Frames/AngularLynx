import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LYNX_ELEMENTS,
  LynxStackPage,
  type StackAnimation,
} from '@blotch/angular-lynx';
import { Motion } from './motion';
import { Screen } from './screen';
import { SECTIONS, sectionOf } from './settings';

/** The look of a group of rows, as iOS's inset grouped lists draw them. */
const GROUP = 'flex flex-col rounded-xl bg-white';
/** The look of one row in a group. */
const ROW =
  'flex min-h-[48px] flex-row items-center gap-3 border-b border-zinc-100 px-4 py-3';

/**
 * The first screen: the sections, each a row that pushes its screen, the
 * motion to use, and a count that shows the screen stays alive while others
 * cover it.
 */
@Component({
  selector: 'app-settings-screen',
  imports: [LYNX_ELEMENTS, RouterLink, Screen],
  host: { class: 'flex flex-1 flex-col' },
  template: `
    <app-screen title="Settings">
      <text class="text-[13px] text-zinc-500">
        Tap a row to open it. Go back with ‹, Android's back button, or by
        dragging the screen to the right, from its edge or anywhere on it.
      </text>

      <view [class]="group">
        @for (section of sections; track section.id) {
          <view
            [class]="row"
            accessibility-element="true"
            accessibility-traits="button"
            [attr.accessibility-label]="section.title"
            [routerLink]="['/settings', section.id]"
          >
            <view
              class="flex h-[30px] w-[30px] items-center justify-center rounded-lg {{
                section.color
              }}"
            >
              <text class="text-[15px] font-semibold text-white">{{
                section.title[0]
              }}</text>
            </view>
            <text class="flex-1 text-[17px]">{{ section.title }}</text>
            <text class="text-[20px] text-zinc-400">›</text>
          </view>
        }
      </view>

      <view class="flex-col gap-2 flex">
        <text class="uppercase px-4 text-[13px] text-zinc-500">Motion</text>
        <view [class]="group">
          @for (choice of motions; track choice.label) {
            <view
              [class]="row"
              accessibility-element="true"
              accessibility-traits="button"
              [attr.accessibility-label]="choice.label"
              (bindtap)="motion.animation.set(choice.value)"
            >
              <text class="flex-1 text-[17px]">{{ choice.label }}</text>
              @if (motion.animation() === choice.value) {
                <text class="text-[17px] text-blue-500">✓</text>
              }
            </view>
          }
        </view>
        <text class="px-4 text-[13px] text-zinc-500">
          The platform's own is iOS's on iOS and the web, and Material's on
          Android. None swaps screens at once, with no swipe.
        </text>
      </view>

      <view class="flex-col gap-2 flex">
        <view [class]="group">
          <view
            [class]="row"
            accessibility-element="true"
            accessibility-traits="button"
            [attr.accessibility-label]="'Tapped ' + taps() + ' times'"
            (bindtap)="taps.set(taps() + 1)"
          >
            <text class="flex-1 text-[17px]">Tapped {{ taps() }} times</text>
          </view>
        </view>
        <text class="px-4 text-[13px] text-zinc-500">
          Tap it, open a section and come back: the count is still here, because
          the screens under the top one stay alive.
        </text>
      </view>
    </app-screen>
  `,
})
export class SettingsScreen {
  protected readonly sections = SECTIONS;
  protected readonly group = GROUP;
  protected readonly row = ROW;
  protected readonly motion = inject(Motion);
  protected readonly taps = signal(0);
  protected readonly motions: readonly {
    label: string;
    value: StackAnimation | undefined;
  }[] = [
    { label: "The platform's", value: undefined },
    { label: 'iOS', value: 'ios' },
    { label: 'Material', value: 'material' },
    { label: 'None', value: 'none' },
  ];
}

/**
 * A section: its rows, each pushing a screen of its own, a switch whose state
 * stays while you go deeper, and a clock that only runs while the screen is
 * on top.
 */
@Component({
  selector: 'app-section-screen',
  imports: [LYNX_ELEMENTS, RouterLink, Screen],
  host: { class: 'flex flex-1 flex-col' },
  template: `
    <app-screen [title]="current().title" backLabel="Settings">
      <view [class]="group">
        @for (item of current().items; track item.id) {
          <view
            [class]="row"
            accessibility-element="true"
            accessibility-traits="button"
            [attr.accessibility-label]="item.title"
            [routerLink]="['/settings', current().id, item.id]"
          >
            <text class="flex-1 text-[17px]">{{ item.title }}</text>
            <text class="text-[20px] text-zinc-400">›</text>
          </view>
        }
      </view>

      <view [class]="group">
        <view
          [class]="row"
          accessibility-element="true"
          accessibility-traits="button"
          [attr.accessibility-label]="'Show in Control Center'"
          (bindtap)="on.set(!on())"
        >
          <text class="flex-1 text-[17px]">Show in Control Center</text>
          <view
            class="flex h-[31px] w-[51px] rounded-full p-[2px] {{
              on() ? 'bg-green-500 justify-end' : 'bg-zinc-300 justify-start'
            }}"
          >
            <view class="h-[27px] w-[27px] rounded-full bg-white"></view>
          </view>
        </view>
      </view>

      <text class="px-4 text-[13px] text-zinc-500">
        On top for {{ seconds() }}s. The clock stops while another screen covers
        this one: it reads LynxStackPage's active().
      </text>
    </app-screen>
  `,
})
export class SectionScreen {
  /** The route's `:section`, bound by withComponentInputBinding(). */
  readonly section = input('general');

  protected readonly current = computed(() => sectionOf(this.section()));
  protected readonly group = GROUP;
  protected readonly row = ROW;
  protected readonly on = signal(false);
  protected readonly seconds = signal(0);

  /** The stack page this screen is on: its `active()` is whether it's on top. */
  readonly #page = inject(LynxStackPage, { optional: true });
  readonly #clock = setInterval(() => {
    if (this.#page?.active() ?? true) this.seconds.update((s) => s + 1);
  }, 1000);
  protected readonly stopClock = inject(DestroyRef).onDestroy(() =>
    clearInterval(this.#clock),
  );
}

/**
 * The deepest screen, with the ways out: Back, a link straight to the first
 * screen, which pops both screens above it, and a link to the next row,
 * which is at the same depth but pushes because the link says so in its
 * navigation's `info`.
 */
@Component({
  selector: 'app-item-screen',
  imports: [LYNX_ELEMENTS, RouterLink, Screen],
  host: { class: 'flex flex-1 flex-col' },
  template: `
    <app-screen [title]="current().title" [backLabel]="parent().title">
      <text class="text-[15px] text-zinc-600">
        Three screens deep. Settings and {{ parent().title }} are still alive
        under this one.
      </text>
      <view [class]="group">
        <view
          [class]="row"
          accessibility-element="true"
          accessibility-traits="button"
          accessibility-label="Back to Settings"
          routerLink="/settings"
        >
          <text class="flex-1 text-[17px] text-blue-500">
            Back to Settings
          </text>
        </view>
        <view
          [class]="row"
          accessibility-element="true"
          accessibility-traits="button"
          [attr.accessibility-label]="'Next: ' + next().title"
          [routerLink]="['/settings', parent().id, next().id]"
          [info]="{ stack: 'push' }"
        >
          <text class="flex-1 text-[17px] text-blue-500">
            Next: {{ next().title }}
          </text>
        </view>
      </view>
      <text class="px-4 text-[13px] text-zinc-500">
        Back to Settings links to a screen in the stack, so it pops back to it.
        Next is at the same depth, which would swap screens at once, as tabs do;
        its info says to push.
      </text>
    </app-screen>
  `,
})
export class ItemScreen {
  /** The route's `:section` and `:item`, bound by withComponentInputBinding(). */
  readonly section = input('general');
  readonly item = input('about');

  protected readonly parent = computed(() => sectionOf(this.section()));
  protected readonly current = computed(
    () =>
      this.parent().items.find((item) => item.id === this.item()) ??
      this.parent().items[0]!,
  );
  protected readonly next = computed(() => {
    const items = this.parent().items;
    return items[(items.indexOf(this.current()) + 1) % items.length]!;
  });
  protected readonly group = GROUP;
  protected readonly row = ROW;
}
