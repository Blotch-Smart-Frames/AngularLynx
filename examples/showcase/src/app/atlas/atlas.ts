import { Component, computed, inject, signal } from '@angular/core';
import {
  FlingGesture,
  Gesture,
  LYNX_ELEMENTS,
  LynxAccessibilitySettings,
  LynxGestureDetector,
  LynxMainThreadEvent,
  LynxSystemInfo,
  LynxTransitionGroup,
  type MainThread,
  PanGesture,
  registerHostElement,
} from '@blotch/angular-lynx';
import { UiSheetSource } from '../../components/ui/bottom-sheet';
import { UiGlass } from '../../components/ui/glass';
import { UiSheet, UiSheetHeader } from '../../components/ui/sheet';
import { dialFigures, dialSvg, facetMapSvg } from '../cut/facet-map';
import { CUTS, type Cut, type Gem, cutName } from '../data/gems';
import { formatNumber } from '../data/format';
import { type Scheme, AtlasState } from '../state/atlas-state';
import { Ground } from '../ground/ground';
import { StoneScene } from './stone-scene';

// cspell:words Mohs mohs Padparadscha

/** The dial and the stone turn a full circle for a drag of this many pixels. */
const PIXELS_PER_TURN = 420;
const RADIANS_PER_PIXEL = (Math.PI * 2) / PIXELS_PER_TURN;
/** The dial's size on the plate, and the box each figure is centered in. */
const DIAL = 308;
/** The facet map inside the dial's ring. */
const MAP = DIAL - 4;
const FIGURE_BOX = 24;
/** The paper color the plate's hairlines are drawn in. */
const PAPER = 'rgba(246, 243, 236, 0.5)';

type ScrollWorkletEvent = {
  readonly currentTarget: MainThread.Element;
  readonly detail: { readonly scrollTop: number };
};

/**
 * Parallax, on the main thread: as the sheet scrolls up over the plate, the
 * plate follows at half speed, so the stone seems to sit deeper than the
 * paper. A main-thread script moves the element in the scroll event itself,
 * with no render in between.
 */
const parallax = (event: ScrollWorkletEvent) => {
  'main thread';
  const plate = event.currentTarget.querySelector('#plate');
  if (!plate) return;
  const y = Math.max(0, event.detail.scrollTop);
  plate.setStyleProperty('transform', `translateY(${(y * 0.5).toFixed(1)}px)`);
};

/**
 * The atlas: the plate, with the stone turning in its index dial, and the
 * cut sheet below it with the stone's figures set in tier bands.
 */
@Component({
  selector: 'app-atlas',
  imports: [
    LYNX_ELEMENTS,
    LynxGestureDetector,
    LynxMainThreadEvent,
    LynxTransitionGroup,
    Ground,
    StoneScene,
    UiGlass,
    UiSheet,
    UiSheetHeader,
    UiSheetSource,
  ],
  host: { class: 'relative h-full w-full flex-col bg-background flex' },
  template: `
    <!-- The ruled paper, under the scroll-view rather than in it. -->
    <view appGround class="absolute top-0 right-0 bottom-0 left-0"></view>
    <scroll-view
      class="h-full w-full"
      scroll-orientation="vertical"
      [mainThreadBindscroll]="parallax"
    >
      <!-- The plate: the stone's color, the diagram and the dial. A sideways
           drag anywhere on it turns the stone; a swipe up still scrolls. -->
      <!-- The color is bound here rather than read from var(--stone): the web
           preview doesn't re-resolve var() when a [style.--x] binding changes. -->
      <view
        id="plate"
        class="plate flex flex-col overflow-hidden"
        [style.background-color]="atlas.color()"
        [lynxGesture]="gesture"
        [consume-slide-event]="slideAngles"
        accessibility-label="The stone. Drag sideways to turn it."
      >
        <view
          class="flex flex-row items-center justify-between px-5 pt-safe-3 pb-1"
        >
          <text class="font-wide text-[15px] tracking-[5px] text-paper"
            >FACET</text
          >
          <blur-view
            ui-glass
            shape="capsule"
            class="flex h-7 items-center justify-center px-3"
          >
            <text
              class="font-narrow text-[11px] tracking-[2px] text-glass-foreground"
            >
              {{ renderer() }}
            </text>
          </blur-view>
        </view>

        <view
          class="relative flex items-center justify-center"
          style="height: 320px"
        >
          @defer (on idle) {
            <view
              appStoneScene
              class="absolute top-0 right-0 bottom-0 left-0"
              [gem]="atlas.gem()"
              [color]="atlas.color()"
              [cut]="atlas.cut()"
              [spin]="spin()"
              [planWidth]="mapSize"
              [animate]="!reduceMotion()"
              (ready)="hasGl.set($event)"
            ></view>
          }
          <view
            class="relative"
            [style.width.px]="dialSize"
            [style.height.px]="dialSize"
          >
            @if (!hasGl()) {
              <!-- No WebGL here (Lynx Explorer): the diagram stands in. -->
              <svg
                class="absolute"
                style="left: 2px; top: 2px"
                [style.width.px]="mapSize"
                [style.height.px]="mapSize"
                [attr.content]="facetMap()"
              ></svg>
            }
            <view
              class="absolute top-0 left-0"
              [style.width.px]="dialSize"
              [style.height.px]="dialSize"
              [style.transform]="dialTransform()"
              [style.transition]="dialTransition()"
            >
              <svg
                [style.width.px]="dialSize"
                [style.height.px]="dialSize"
                [attr.content]="dial"
              ></svg>
              @for (figure of figures; track figure.value) {
                <text
                  class="absolute text-center font-wide text-[10px] text-paper"
                  [style.width.px]="figureBox"
                  [style.left.px]="figure.x"
                  [style.top.px]="figure.y"
                  [style.transform]="figure.rotate"
                >
                  {{ figure.value }}
                </text>
              }
            </view>
          </view>
        </view>

        <view class="flex flex-row items-end justify-between px-5 pt-1 pb-3">
          <!-- The name cuts in as the stone changes: the old one leaves as the
               new one enters. The group itself has the height, because on
               Lynx an absolute child is placed from its parent's box, and the
               group's host would otherwise be zero tall. -->
          <lynx-transition-group
            class="flex-1"
            style="height: 56px"
            [each]="gemList()"
            [trackBy]="trackGem"
            name="cut"
            [duration]="320"
          >
            <ng-template let-gem>
              <view class="absolute right-0 bottom-0 left-0 flex flex-col">
                <!-- Long names (Padparadscha, Alexandrite) set smaller, so
                     the name stays one line beside the chip. -->
                <text
                  class="font-wide text-paper"
                  [text-maxline]="1"
                  [style.font-size.px]="nameSize(gem.name)"
                  [style.line-height.px]="nameSize(gem.name) + 4"
                >
                  {{ upper(gem.name) }}
                </text>
                <text class="font-narrow text-[12px] tracking-[2px] text-paper">
                  {{ upper(gem.species) }}
                </text>
              </view>
            </ng-template>
          </lynx-transition-group>
          <blur-view
            ui-glass
            interactive
            shape="capsule"
            class="flex h-9 items-center justify-center px-4"
            [accessibility-element]="true"
            accessibility-traits="button"
            accessibility-label="Cut and light"
            [uiSheetSource]="cutSheet"
            (bindtap)="cutSheetOpen.set(true)"
          >
            <text
              class="font-narrow text-[11px] tracking-[2px] text-glass-foreground"
            >
              {{ upper(cutLabel()) }}
            </text>
          </blur-view>
        </view>
      </view>

      <!-- The cut sheet: hairlines and tier bands on the ruled paper. -->
      <view class="flex flex-col">
        <!-- The parcel: ten stones; tap one and the whole app takes its color. -->
        <view
          class="flex flex-row justify-center border-b border-foreground"
          style="height: 64px"
        >
          @for (gem of atlas.gems; track gem.id) {
            <view
              class="flex items-center justify-center"
              style="width: 36px; height: 64px"
              accessibility-element="true"
              accessibility-traits="button"
              [accessibility-label]="gem.name"
              [lynxAccessibilityTraits]="{ selected: gem.id === atlas.gemId() }"
              (bindtap)="atlas.gemId.set(gem.id)"
            >
              <view
                class="rounded-full border-foreground"
                style="width: 30px; height: 30px; transition: transform 300ms ease-out, border-width 300ms ease-out"
                [style.background-color]="swatch(gem)"
                [style.border-width.px]="gem.id === atlas.gemId() ? 2 : 0"
                [style.transform]="
                  gem.id === atlas.gemId() ? 'scale(1.2)' : 'scale(1)'
                "
              ></view>
            </view>
          }
        </view>

        <!-- Hardness: the Mohs scale, with the stone's range on it. -->
        <view
          class="band-main flex flex-row items-center border-b border-foreground px-5"
        >
          <text
            class="band-label font-narrow text-[11px] tracking-[2px] text-muted-foreground"
            >HARDNESS</text
          >
          <view class="flex flex-1 flex-row items-center">
            <view class="relative flex-1" style="height: 14px">
              <view
                class="absolute right-0 left-0 border-b border-foreground"
                style="top: 7px"
              ></view>
              @for (tick of mohs; track tick) {
                <view
                  class="absolute border-l border-foreground"
                  style="top: 3px; height: 8px"
                  [style.left]="((tick - 1) / 9) * 100 + '%'"
                ></view>
              }
              <view
                class="absolute rounded-full"
                style="top: 3px; height: 8px"
                [style.background-color]="atlas.color()"
                [style.left]="hardnessRange().left"
                [style.width]="hardnessRange().width"
              ></view>
            </view>
            <text class="band-value font-wide text-[18px] text-foreground">{{
              hardness()
            }}</text>
          </view>
        </view>

        <!-- Refractive index, on the scale from glass to diamond. -->
        <view
          class="band-main flex flex-row items-center border-b border-foreground px-5"
        >
          <text
            class="band-label font-narrow text-[11px] tracking-[2px] text-muted-foreground"
            >REFRACTION</text
          >
          <view class="flex flex-1 flex-row items-center">
            <view class="relative flex-1" style="height: 14px">
              <view
                class="absolute right-0 left-0 border-b border-foreground"
                style="top: 7px"
              ></view>
              <view
                class="absolute border-l border-foreground"
                style="left: 0; top: 3px; height: 8px"
              ></view>
              <view
                class="absolute border-l border-foreground"
                style="right: 0; top: 3px; height: 8px"
              ></view>
              <view
                class="absolute rounded-full"
                style="top: 2px; width: 10px; height: 10px; margin-left: -5px"
                [style.background-color]="atlas.color()"
                [style.left]="iorPosition()"
              ></view>
            </view>
            <text class="band-value font-wide text-[18px] text-foreground">{{
              ior()
            }}</text>
          </view>
        </view>

        <!-- Dispersion: the fire, on a spectrum, up to sphene's. -->
        <view
          class="band-main flex flex-row items-center border-b border-foreground px-5"
        >
          <text
            class="band-label font-narrow text-[11px] tracking-[2px] text-muted-foreground"
            >DISPERSION</text
          >
          <view class="flex flex-1 flex-row items-center">
            <view class="relative flex-1" style="height: 14px">
              <view
                class="fire absolute right-0 left-0"
                style="top: 5px; height: 4px"
              ></view>
              <view
                class="absolute border-l-2 border-foreground"
                style="top: 0; height: 14px"
                [style.left]="dispersionPosition()"
              ></view>
            </view>
            <text class="band-value font-wide text-[18px] text-foreground">{{
              dispersion()
            }}</text>
          </view>
        </view>

        <!-- Origin and formula. -->
        <view
          class="band-bezel flex flex-row items-center border-b border-foreground px-5"
        >
          <text
            class="band-label font-narrow text-[11px] tracking-[2px] text-muted-foreground"
            >ORIGIN</text
          >
          <view class="flex flex-1 flex-col">
            <text class="font-wide text-[18px] text-foreground">{{
              atlas.gem().origin
            }}</text>
            <text class="font-routed text-[13px] text-muted-foreground">{{
              atlas.gem().locality
            }}</text>
            <text class="mt-1 font-routed text-[12px] text-foreground">{{
              atlas.gem().formula
            }}</text>
          </view>
        </view>

        <view class="flex flex-row items-center px-5" style="height: 56px">
          <text
            class="font-routed text-[13px] leading-[18px] text-muted-foreground"
            >{{ atlas.gem().note }}</text
          >
        </view>
      </view>

      <!-- Room to scroll the last band out from under the dock. -->
      <view style="height: 128px"></view>
    </scroll-view>

    <!-- Cut and light: grows out of the chip that opens it. -->
    <ui-sheet #cutSheet variant="glass" [(open)]="cutSheetOpen">
      <ui-sheet-header>
        <text class="font-wide text-[22px] leading-[26px] text-foreground"
          >CUT AND LIGHT</text
        >
        <text
          class="font-routed text-[14px] leading-[19px] text-glass-muted-foreground"
        >
          The same stone, recut, and seen by day or by lamplight.
        </text>
      </ui-sheet-header>
      <view class="flex flex-col gap-5 py-3">
        <view class="flex flex-col gap-2">
          <text
            class="font-narrow text-[11px] tracking-[2px] text-glass-muted-foreground"
            >CUT</text
          >
          <view class="flex flex-row gap-2">
            @for (cut of cuts; track cut.id) {
              <view
                class="detent flex h-10 flex-1 items-center justify-center border border-foreground"
                [class.detent-on]="cut.id === atlas.cut()"
                accessibility-element="true"
                accessibility-traits="button"
                [accessibility-label]="cut.name"
                [lynxAccessibilityTraits]="{ selected: cut.id === atlas.cut() }"
                (bindtap)="atlas.cutOverride.set(cut.id)"
              >
                <text
                  class="font-narrow text-[11px] tracking-[2px]"
                  [class.text-foreground]="cut.id !== atlas.cut()"
                  [class.text-background]="cut.id === atlas.cut()"
                >
                  {{ upper(cutShort(cut.id)) }}
                </text>
              </view>
            }
          </view>
        </view>
        <view class="flex flex-col gap-2">
          <text
            class="font-narrow text-[11px] tracking-[2px] text-glass-muted-foreground"
            >LIGHT</text
          >
          <view class="flex flex-row gap-2">
            @for (option of schemes; track option.id) {
              <view
                class="detent flex h-10 flex-1 items-center justify-center border border-foreground"
                [class.detent-on]="option.id === atlas.scheme()"
                accessibility-element="true"
                accessibility-traits="button"
                [accessibility-label]="option.label"
                [lynxAccessibilityTraits]="{
                  selected: option.id === atlas.scheme(),
                }"
                (bindtap)="atlas.scheme.set(option.id)"
              >
                <text
                  class="font-narrow text-[11px] tracking-[2px]"
                  [class.text-foreground]="option.id !== atlas.scheme()"
                  [class.text-background]="option.id === atlas.scheme()"
                >
                  {{ upper(option.name) }}
                </text>
              </view>
            }
          </view>
          <text
            class="font-routed text-[12px] leading-[17px] text-glass-muted-foreground"
          >
            {{ lightNote() }}
          </text>
        </view>
      </view>
    </ui-sheet>
  `,
  styles: [
    `
      .plate {
        transition: background-color 600ms ease-out;
      }
      .band-main {
        height: 52px;
      }
      .detent {
        background-color: transparent;
        transition: background-color 120ms ease-out;
      }
      .detent-on {
        background-color: var(--foreground);
      }
      .band-bezel {
        height: 88px;
      }
      .band-label {
        width: 108px;
      }
      .band-value {
        width: 64px;
        text-align: right;
      }
      .fire {
        background-image: linear-gradient(
          90deg,
          #6a4cff,
          #2f8bff 20%,
          #19c6a8 40%,
          #ffd23a 65%,
          #ff7a16 85%,
          #ff2d55
        );
      }
      @keyframes cut-enter {
        from {
          opacity: 0;
          transform: translateY(14px) scaleY(0.7);
        }
        to {
          opacity: 1;
          transform: translateY(0) scaleY(1);
        }
      }
      @keyframes cut-leave {
        from {
          opacity: 1;
          transform: translateY(0) scaleY(1);
        }
        to {
          opacity: 0;
          transform: translateY(-14px) scaleY(0.7);
        }
      }
      .cut-enter {
        animation: cut-enter 320ms ease-out both;
      }
      .cut-leave {
        animation: cut-leave 200ms ease-in both;
      }
    `,
  ],
})
export class AtlasPage {
  protected readonly atlas = inject(AtlasState);
  readonly #settings = inject(LynxAccessibilitySettings);
  readonly #system = inject(LynxSystemInfo);

  protected readonly parallax = parallax;
  protected readonly cuts = CUTS;
  protected readonly schemes: readonly {
    id: Scheme;
    name: string;
    label: string;
  }[] = [
    { id: 'day', name: 'Day', label: 'Daylight' },
    { id: 'night', name: 'Night', label: 'Lamplight' },
    { id: 'system', name: 'System', label: 'Follow the system' },
  ];
  protected readonly dialSize = DIAL;
  protected readonly mapSize = MAP;
  protected readonly figureBox = FIGURE_BOX;
  protected readonly dial = dialSvg(DIAL, PAPER);
  protected readonly figures = dialFigures(DIAL, FIGURE_BOX);
  protected readonly mohs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  /** Drags within 35° of sideways turn the stone; steeper ones scroll. */
  protected readonly slideAngles: [number, number][] = [
    [-35, 35],
    [145, 180],
    [-180, -145],
  ];

  protected readonly reduceMotion = this.#settings.reduceMotion;
  protected readonly hasGl = signal<boolean | null>(null);
  protected readonly cutSheetOpen = signal(false);

  /** The dial's angle, in radians, from the visitor's drags and flings. */
  protected readonly spin = signal(0);
  #restSpin = 0;

  readonly #pan = new PanGesture()
    .minDistance(4)
    .onStart(() => (this.#restSpin = this.spin()))
    .onUpdate((event) =>
      this.spin.set(this.#restSpin + event.translationX * RADIANS_PER_PIXEL),
    )
    .onEnd(() => (this.#restSpin = this.spin()));
  // The momentum after the finger lifts: Lynx sends it frame by frame as
  // `deltaX`/`deltaY` in the native params, with no typed alias.
  readonly #fling = new FlingGesture().onUpdate((event) => {
    const delta = Number(event.params?.['deltaX'] ?? 0);
    if (!delta) return;
    this.spin.update((spin) => spin + delta * RADIANS_PER_PIXEL);
    this.#restSpin = this.spin();
  });
  protected readonly gesture = Gesture.Simultaneous(this.#pan, this.#fling);

  protected readonly dialTransform = computed(
    () => `rotate(${((this.spin() * 180) / Math.PI).toFixed(2)}deg)`,
  );
  // No easing under the finger; the fling's deltas are already smooth.
  protected readonly dialTransition = computed(() => 'none');

  protected readonly facetMap = computed(() =>
    facetMapSvg(this.atlas.cut(), MAP, PAPER),
  );

  protected readonly gemList = computed(() => [this.atlas.gem()]);
  protected readonly trackGem = (gem: Gem) => gem.id;

  protected readonly cutLabel = computed(() => cutName(this.atlas.cut()));

  /** What draws the stone here, for the chip in the corner. */
  protected readonly renderer = computed(() => {
    if (this.hasGl() === false) return 'NO CANVAS';
    switch (this.#system.platform) {
      case 'iOS':
        return 'METAL';
      case 'Android':
        return 'GL ES';
      default:
        return 'WEBGL2';
    }
  });

  protected readonly hardness = computed(() => {
    const [low, high] = this.atlas.gem().hardness;
    return low === high ? `${low}` : `${low}–${high}`;
  });
  protected readonly hardnessRange = computed(() => {
    const [low, high] = this.atlas.gem().hardness;
    const at = (value: number) => ((value - 1) / 9) * 100;
    return {
      left: `${at(low)}%`,
      width: `${Math.max(2.5, at(high) - at(low))}%`,
    };
  });
  protected readonly ior = computed(() =>
    formatNumber(this.atlas.gem().ior, 3),
  );
  /** From window glass (1.5) to diamond (2.42). */
  protected readonly iorPosition = computed(
    () => `${((this.atlas.gem().ior - 1.5) / (2.42 - 1.5)) * 100}%`,
  );
  protected readonly dispersion = computed(() =>
    formatNumber(this.atlas.gem().dispersion, 3),
  );
  /** Up to demantoid's 0.057, the most fire a gem throws. */
  protected readonly dispersionPosition = computed(
    () => `${(this.atlas.gem().dispersion / 0.057) * 100}%`,
  );

  protected readonly lightNote = computed(() => {
    const gem = this.atlas.gem();
    if (gem.nightColor) {
      return this.atlas.dark()
        ? `${gem.name} under lamplight: red.`
        : `${gem.name} turns red under lamplight. Try Night.`;
    }
    return this.atlas.dark()
      ? 'Night: the paper goes dark, the stone keeps its color.'
      : 'Day: ink on paper. Night swaps them.';
  });

  protected upper(text: string): string {
    return text.toUpperCase();
  }

  /**
   * The name's size: Routed Gothic Wide runs about 0.9em per capital, and
   * the name has the row minus the cut chip, about 200px.
   */
  protected nameSize(name: string): number {
    return name.length > 10 ? 22 : name.length > 8 ? 26 : 36;
  }

  /**
   * Alexandrite's disc shows its night color at night.
   */
  protected swatch(gem: Gem): string {
    return (this.atlas.dark() && gem.nightColor) || gem.color;
  }

  protected cutShort(cut: Cut): string {
    switch (cut) {
      case 'brilliant':
        return 'Round';
      case 'oval':
        return 'Oval';
      case 'cushion':
        return 'Cushion';
      case 'step':
        return 'Step';
    }
  }
}

// The route's host is a real <view>, so the page can fill the screen.
registerHostElement(AtlasPage, 'view');
