import {
  Component,
  DestroyRef,
  type ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { LYNX_ELEMENTS, type LynxCanvasElement } from '@blotch/angular-lynx';
import { type Look, lookById } from '../develop/looks';
import type { Adjustments } from '../develop/settings';
import { DevelopSurface, loadImage } from '../develop/surface';
import { DarkroomState, type Recipe } from '../state/darkroom-state';
import { EdgeArrow, MarkerRing, Sprockets } from './marks';
import { keepChosenInView } from './strip-scroll';

const FRAME_WIDTH = 96;
const FRAME_HEIGHT = 64;
const GAP = 10;
const PAD = 12;
const SEED = 7.31;

/** One frame of the test strip: a stock, or a recipe the person kept. */
type TestFrame = {
  readonly id: string;
  readonly name: string;
  readonly look: Look;
  readonly adjustments: Adjustments;
  readonly recipe?: Recipe;
};

/**
 * The test strip: the photo on the easel printed in every stock, side by
 * side, as a printer makes a strip of test exposures before the real print.
 * All of it is one canvas: one GL context, drawing each frame into its own
 * part of the buffer with the same shader as the enlargement, so a slider
 * moves every frame at once. Kept recipes follow the stocks.
 */
@Component({
  selector: 'app-test-strip',
  imports: [LYNX_ELEMENTS, EdgeArrow, MarkerRing, Sprockets],
  host: { class: 'flex flex-col bg-film' },
  template: `
    <!-- The strip's own edge print: what it is, and how many frames. -->
    <view class="flex flex-row items-center justify-between px-3 pt-2">
      <view class="flex flex-row items-center">
        <app-edge-arrow class="mr-1.5" />
        <text class="font-edge text-[10px] tracking-[2px] text-edge"
          >TEST STRIP</text
        >
      </view>
      <text class="font-edge text-[10px] tracking-[2px] text-edge"
        >{{ frames().length }} PRINTS</text
      >
    </view>
    <scroll-view
      class="w-full"
      [style.height.px]="stripHeight"
      scroll-orientation="horizontal"
    >
      <view class="flex flex-col" [style.width.px]="stripWidth()">
        <app-sprockets class="px-1.5 pt-1.5" [count]="sprocketCount()" />
        <view
          class="relative mt-2"
          [style.width.px]="stripWidth()"
          [style.height.px]="frameHeight + 18"
        >
          <canvas
            #canvas
            class="absolute top-0 left-0"
            [style.width.px]="stripWidth()"
            [style.height.px]="frameHeight"
            accessibility-element="false"
          ></canvas>
          @for (frame of frames(); track frame.id; let index = $index) {
            <view
              #frame
              class="absolute flex flex-col items-center"
              [style.left.px]="pad + index * (frameWidth + gap)"
              style="top: 0"
              [style.width.px]="frameWidth"
              (bindtap)="choose(frame)"
              accessibility-element="true"
              accessibility-traits="button"
              [attr.accessibility-label]="'Print in ' + frame.name"
            >
              @if (hasGl() === false) {
                <image
                  mode="aspectFill"
                  [src]="state.photo().src"
                  [style.width.px]="frameWidth"
                  [style.height.px]="frameHeight"
                ></image>
              } @else {
                <view [style.height.px]="frameHeight"></view>
              }
              <text
                class="mt-1 font-edge text-[9px] tracking-[1.5px]"
                [class.text-edge]="!frame.recipe"
                [class.text-marker]="!!frame.recipe"
                >{{ frame.name.toUpperCase() }}</text
              >
              @if (isChosen(frame)) {
                <!-- Round the print and its name, as a hand would. -->
                <app-ring
                  [width]="frameWidth + 14"
                  [height]="frameHeight + 32"
                  [seed]="index + 5"
                  style="left: -7px; top: -8px"
                />
              }
            </view>
          }
        </view>
        <app-sprockets class="px-1.5" [count]="sprocketCount()" />
      </view>
    </scroll-view>
  `,
})
export class TestStrip {
  protected readonly state = inject(DarkroomState);
  readonly canvas = viewChild.required<ElementRef<LynxCanvasElement>>('canvas');

  protected readonly frameWidth = FRAME_WIDTH;
  protected readonly frameHeight = FRAME_HEIGHT;
  protected readonly gap = GAP;
  protected readonly pad = PAD;
  protected readonly stripHeight = FRAME_HEIGHT + 56;
  protected readonly hasGl = signal<boolean | null>(null);

  /** The stocks with the person's adjustments, then the kept recipes. */
  protected readonly frames = computed<TestFrame[]>(() => {
    const adjustments = this.state.adjustments();
    return [
      ...this.state.looks.map((look) => ({
        id: look.id,
        name: look.name,
        look,
        adjustments,
      })),
      ...this.state.recipes().map((recipe) => ({
        id: recipe.id,
        name: recipe.name,
        look: lookById(recipe.look),
        adjustments: recipe.adjustments,
        recipe,
      })),
    ];
  });

  protected readonly stripWidth = computed(
    () => PAD * 2 + this.frames().length * (FRAME_WIDTH + GAP) - GAP,
  );
  protected readonly sprocketCount = computed(() =>
    Math.ceil(this.stripWidth() / 14),
  );

  readonly frameElements = viewChildren<ElementRef>('frame');

  #surface: DevelopSurface | null = null;
  #loaded = '';

  constructor() {
    keepChosenInView(this.frameElements, () =>
      this.frames().findIndex((frame) => this.isChosen(frame)),
    );
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const surface = new DevelopSurface(this.canvas().nativeElement, () =>
        this.#draw(),
      );
      this.#surface = surface;
      this.hasGl.set(!!surface.renderer);
      destroyRef.onDestroy(() => surface.dispose());
      this.#load();
    });
    effect(() => {
      this.state.photo();
      this.#load();
    });
    effect(() => {
      this.frames();
      this.#surface?.schedule();
    });
  }

  protected isChosen(frame: TestFrame): boolean {
    const { look, adjustments } = this.state.development();
    if (frame.recipe) {
      return (
        frame.recipe.look === look &&
        sameAdjustments(frame.recipe.adjustments, adjustments)
      );
    }
    return frame.look.id === look;
  }

  protected choose(frame: TestFrame): void {
    if (frame.recipe) this.state.applyRecipe(frame.recipe);
    else this.state.setLook(frame.look);
  }

  async #load(): Promise<void> {
    const surface = this.#surface;
    const photo = this.state.photo();
    if (!surface?.renderer || this.#loaded === photo.id) return;
    this.#loaded = photo.id;
    try {
      const { image, width, height } = await loadImage(photo.src);
      if (this.state.photo().id !== photo.id) return;
      surface.renderer.setPhoto(image, width, height);
      surface.schedule();
    } catch {
      this.#loaded = '';
    }
  }

  #draw(): void {
    const surface = this.#surface;
    const renderer = surface?.renderer;
    if (!surface || !renderer) return;
    const { ratio } = surface;
    this.frames().forEach((frame, index) => {
      renderer.render(
        {
          look: frame.look,
          adjustments: frame.adjustments,
          split: -1,
          seed: SEED,
        },
        surface.width,
        surface.height,
        {
          x: Math.round((PAD + index * (FRAME_WIDTH + GAP)) * ratio),
          y: 0,
          width: Math.round(FRAME_WIDTH * ratio),
          height: Math.round(FRAME_HEIGHT * ratio),
          fit: 'cover',
          clear: index === 0,
        },
      );
    });
  }
}

const sameAdjustments = (a: Adjustments, b: Adjustments): boolean =>
  (Object.keys(a) as (keyof Adjustments)[]).every((key) => a[key] === b[key]);
