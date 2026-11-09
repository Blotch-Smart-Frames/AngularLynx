// cspell:words halation
import {
  Component,
  DestroyRef,
  type ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  LYNX_ELEMENTS,
  LynxGestureDetector,
  type LynxCanvasElement,
  PanGesture,
} from '@blotch/angular-lynx';
import type { PhotoFrame } from '../develop/develop-renderer';
import { DevelopSurface, loadImage } from '../develop/surface';
import { DarkroomState } from '../state/darkroom-state';
import { EdgeArrow, MarkerRing, Sprockets } from './marks';

/**
 * The photo's band inside the film follows the photo's shape, within these
 * bounds (layout pixels): a wide photo isn't boxed in black, and a tall one
 * doesn't push the rest of the sheet off the screen.
 */
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 330;
/** The grain's pattern: fixed, so grain holds still while sliders move. */
const SEED = 7.31;

/**
 * The enlargement: the frame on the easel, developed live on the GPU, on
 * its strip of film. The red line splits it into before (left) and after
 * (right); dragging anywhere on the photo moves the line.
 */
@Component({
  selector: 'app-enlargement',
  imports: [
    LYNX_ELEMENTS,
    EdgeArrow,
    LynxGestureDetector,
    MarkerRing,
    Sprockets,
  ],
  host: { class: 'flex flex-col bg-film' },
  template: `
    <view class="flex flex-row justify-between px-3 pt-2 pb-1">
      <text class="font-edge text-[10px] tracking-[2px] text-edge"
        >DARKROOM {{ state.look().iso }}</text
      >
      <text class="font-edge text-[10px] tracking-[2px] text-edge">{{
        lookCode()
      }}</text>
    </view>
    <app-sprockets class="px-1.5" />

    <view
      class="relative my-2"
      [style.height.px]="photoHeight()"
      [lynxGesture]="pan"
      [consume-slide-event]="sideways"
      accessibility-label="The photo, before on the left and after on the right. Drag sideways to move the line."
    >
      @if (hasGl() === false) {
        <!-- Lynx Explorer: no canvas, so the photo shows as it is. -->
        <image
          class="h-full w-full"
          mode="aspectFit"
          [src]="state.photo().src"
        ></image>
      }
      <canvas
        #canvas
        class="absolute top-0 left-0 h-full w-full"
        accessibility-element="false"
      ></canvas>

      @if (split() >= 0 && hasGl()) {
        <!-- The before/after line, where the shader splits the photo. -->
        <view
          class="absolute bg-marker"
          [style.left.px]="lineX() - 1"
          [style.top.px]="frame().y * photoHeight()"
          [style.height.px]="frame().height * photoHeight()"
          style="width: 2px"
        ></view>
        <app-ring
          [width]="38"
          [height]="38"
          [seed]="3"
          [stroke]="3"
          [style.left.px]="lineX() - 19"
          [style.top.px]="photoHeight() / 2 - 19"
        />
      }
    </view>

    <app-sprockets class="px-1.5" />
    <!-- The bottom edge print: the frame's numbers at its ends, and which
         side of the line is which, printed under the line itself, so
         nothing is laid over the photo while it's judged. -->
    <view class="relative flex flex-row justify-between px-3 pt-1 pb-2">
      <view class="flex flex-row items-center">
        <app-edge-arrow class="mr-1.5" />
        <text class="font-edge text-[10px] tracking-[2px] text-edge">{{
          frameNumber()
        }}</text>
      </view>
      <view class="flex flex-row items-center">
        <text class="font-edge text-[10px] tracking-[2px] text-edge"
          >{{ frameNumber() }}A</text
        >
        <app-edge-arrow class="ml-1.5" />
      </view>
      @if (split() >= 0 && hasGl()) {
        @if (lineX() > 110) {
          <text
            class="absolute font-edge text-[10px] tracking-[2px] text-edge"
            style="top: 4px; width: 70px; text-align: right"
            [style.left.px]="lineX() - 78"
            >BEFORE</text
          >
        }
        @if (width() - lineX() > 110) {
          <text
            class="absolute font-edge text-[10px] tracking-[2px] text-edge"
            style="top: 4px"
            [style.left.px]="lineX() + 8"
            >AFTER</text
          >
        }
      }
    </view>
  `,
})
export class Enlargement {
  protected readonly state = inject(DarkroomState);
  readonly canvas = viewChild.required<ElementRef<LynxCanvasElement>>('canvas');

  /** The roll's frame number printed on the film beside the photo. */
  readonly frameNumber = input(1);
  /** Whether WebGL is here; Lynx Explorer has no canvas. */
  readonly ready = output<boolean>();

  protected readonly hasGl = signal<boolean | null>(null);
  /** The stock's name and the frame, as the film's edge prints them. */
  protected readonly lookCode = computed(
    () => `${this.state.look().name.toUpperCase()}  ${this.frameNumber()}`,
  );
  /** The line, as a fraction of the photo's width; -1 hides it. */
  readonly split = signal(0.5);
  readonly #photoSize = signal({ width: 3, height: 2 });
  readonly #width = signal(402);

  /** The band's height: the photo's at full width, within bounds. */
  protected readonly photoHeight = computed(() => {
    const { width, height } = this.#photoSize();
    const fitted = Math.round((this.#width() * height) / width);
    return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, fitted));
  });

  /** Where the photo sits in the band, as fractions of it. */
  protected readonly frame = computed<PhotoFrame>(() => {
    const { width, height } = this.#photoSize();
    const boxWidth = this.#width();
    const photoAspect = width / height;
    const boxAspect = boxWidth / this.photoHeight();
    const w = photoAspect > boxAspect ? 1 : photoAspect / boxAspect;
    const h = photoAspect > boxAspect ? boxAspect / photoAspect : 1;
    return { x: (1 - w) / 2, y: (1 - h) / 2, width: w, height: h };
  });
  protected readonly width = this.#width.asReadonly();
  protected readonly frameLeft = computed(() => this.frame().x * this.#width());
  protected readonly frameRight = computed(
    () => (this.frame().x + this.frame().width) * this.#width(),
  );
  protected readonly lineX = computed(
    () =>
      this.frameLeft() + this.split() * (this.frameRight() - this.frameLeft()),
  );

  /** Sideways drags move the line; anything steeper scrolls the sheet. */
  protected readonly sideways: [number, number][] = [
    [-40, 40],
    [140, 180],
    [-180, -140],
  ];
  #startSplit = 0.5;
  protected readonly pan = new PanGesture()
    .minDistance(2)
    .onStart(() => (this.#startSplit = Math.max(0, this.split())))
    .onUpdate((event) => {
      const span = this.frameRight() - this.frameLeft();
      if (!span) return;
      const next = this.#startSplit + event.translationX / span;
      this.split.set(Math.min(1, Math.max(0, next)));
    });

  #surface: DevelopSurface | null = null;
  #loaded = '';

  constructor() {
    const destroyRef = inject(DestroyRef);
    // The canvas has a size once it's laid out, after the first render.
    afterNextRender(() => {
      const surface = new DevelopSurface(this.canvas().nativeElement, () =>
        this.#draw(),
      );
      this.#surface = surface;
      this.hasGl.set(!!surface.renderer);
      this.ready.emit(!!surface.renderer);
      this.#width.set(surface.cssWidth || 402);
      destroyRef.onDestroy(() => surface.dispose());
      this.#load();
    });

    // A new photo on the easel: load it into the texture.
    effect(() => {
      this.state.photo();
      this.#load();
    });

    // Anything that changes the development redraws, once per frame.
    effect(() => {
      this.state.development();
      this.split();
      this.#surface?.schedule();
    });
  }

  /**
   * The photo at full size, developed, as a JPEG: the canvas draws it once,
   * off screen, at the photo's own pixel size.
   */
  async print(): Promise<Blob | null> {
    const surface = this.#surface;
    const renderer = surface?.renderer;
    if (!surface || !renderer) return null;
    const { width, height } = renderer.size;
    return surface.exportJpeg(width, height, (w, h) =>
      renderer.render(
        {
          look: this.state.look(),
          adjustments: this.state.adjustments(),
          split: -1,
          seed: SEED,
        },
        w,
        h,
      ),
    );
  }

  async #load(): Promise<void> {
    const surface = this.#surface;
    const photo = this.state.photo();
    if (!surface?.renderer || this.#loaded === photo.id) return;
    this.#loaded = photo.id;
    try {
      const { image, width, height } = await loadImage(photo.src);
      // Another photo was chosen while this one loaded.
      if (this.state.photo().id !== photo.id) return;
      surface.renderer.setPhoto(image, width, height);
      this.#photoSize.set({ width, height });
      this.#width.set(surface.cssWidth || this.#width());
      surface.schedule();
    } catch {
      this.#loaded = '';
    }
  }

  #draw(): void {
    const surface = this.#surface;
    if (!surface?.renderer) return;
    this.#width.set(surface.cssWidth);
    surface.renderer.render(
      {
        look: this.state.look(),
        adjustments: this.state.adjustments(),
        split: this.split(),
        seed: SEED,
      },
      surface.width,
      surface.height,
    );
  }
}
