import {
  Component,
  DestroyRef,
  type ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import {
  FlingGesture,
  Gesture,
  LYNX_ELEMENTS,
  type LynxCanvasElement,
  LynxGestureDetector,
  PanGesture,
  TapGesture,
} from '@blotch/angular-lynx';
import * as THREE from 'three';
import earthClouds from '../../assets/planets/earth-clouds.jpg';
import earthDay from '../../assets/planets/earth-day.jpg';
import earthNight from '../../assets/planets/earth-night.jpg';
import mars from '../../assets/planets/mars.jpg';
import mercury from '../../assets/planets/mercury.jpg';
import moon from '../../assets/planets/moon.jpg';
import type { Maps } from '../scene/bodies-3d';
import { type Label, OrreryScene } from '../scene/orrery-scene';
import { BODIES, type BodyId } from '../sky/bodies';
import { OrreryState } from '../state/orrery-state';
import { planSvg } from './plan';

/**
 * The orrery itself: a `<canvas>` the scene draws into, the planets' names
 * engraved beside them (native text, placed where the scene says each
 * planet is on screen), and the hand: drag to turn the view (or, flown in,
 * the planet), fling to let it coast, tap a planet to fly to it.
 *
 * Lynx Explorer has no canvas: there the orrery is drawn flat, as a plan.
 */
@Component({
  selector: 'app-orrery-view',
  imports: [LYNX_ELEMENTS, LynxGestureDetector],
  host: { class: 'relative' },
  template: `
    <view
      class="absolute top-0 left-0 h-full w-full"
      [lynxGesture]="gesture"
      accessibility-element="false"
    >
      <canvas
        #canvas
        class="h-full w-full"
        accessibility-element="false"
      ></canvas>
    </view>

    @if (hasGl() === false) {
      <view
        class="absolute top-0 left-0 flex h-full w-full flex-col items-center justify-center"
      >
        <svg
          [style.width.px]="planSize"
          [style.height.px]="planSize"
          [attr.content]="plan()"
        ></svg>
        <text
          class="mt-3 px-8 text-center font-italic text-[12px] leading-[17px] text-silver-shade"
          >Lynx Explorer has no canvas, so the orrery is drawn as a plan. Build
          the app to see it in 3D.</text
        >
      </view>
    }

    @for (label of placed(); track label.id) {
      <text
        class="absolute font-engraved text-[10px] tracking-[1.6px] text-brass-lit"
        [style.left.px]="label.left"
        [style.top.px]="label.top"
        accessibility-element="false"
        >{{ label.name }}</text
      >
    }
    @for (leader of leaders(); track leader.id) {
      <view
        class="absolute bg-brass-lit"
        style="height: 1px; opacity: 0.55; transform-origin: 0 50%"
        [style.left.px]="leader.x"
        [style.top.px]="leader.y"
        [style.width.px]="leader.length"
        [style.transform]="'rotate(' + leader.angle + 'deg)'"
      ></view>
    }
  `,
})
export class OrreryView {
  protected readonly state = inject(OrreryState);
  readonly canvas = viewChild.required<ElementRef<LynxCanvasElement>>('canvas');
  /** Idle motion: off under Reduce Motion. */
  readonly motion = input(true);

  protected readonly hasGl = signal<boolean | null>(null);
  protected readonly labels = signal<Label[]>([]);
  protected readonly names = Object.fromEntries(
    BODIES.map((body) => [body.id, body.name.toUpperCase()]),
  ) as Record<BodyId, string>;
  protected readonly planSize = 300;
  /** The canvas's laid-out width: labels stay inside it. */
  readonly #width = signal(402);

  /**
   * Each planet's name, engraved beside it: to its right if there's room,
   * else its left, above or below, else left out, so no name sits on
   * another or on a planet. Earth is placed first, then the larger on
   * screen; the Sun needs no label.
   */
  protected readonly placed = computed(() => {
    const labels = this.labels();
    // Saturn's disc counts out to its rings, so no name is set over them.
    const discs = labels.map((label) => ({
      ...label,
      r: (label.id === 'saturn' ? label.r * 2.7 : label.r) + 2,
    }));
    const boxes: Box[] = [];
    const placed: Placed[] = [];
    const order = [...labels]
      .filter((label) => label.id !== 'sun')
      .sort((a, b) =>
        a.id === 'earth' ? -1 : b.id === 'earth' ? 1 : b.r - a.r,
      );
    const right = this.#width() - 2;
    for (const label of order) {
      const name = this.names[label.id];
      const width = name.length * 8.4 + 2;
      // Beside it first, then above and below, then the same a step out,
      // where a leader joins name and planet. Kept inside the canvas.
      const spots: [number, number][] = [];
      for (const gap of [5, 24, 44, 64]) {
        const reach = label.r + gap;
        // Never below: that's where its post, the arms and the column are.
        spots.push(
          [label.x + reach, label.y - 6],
          [label.x - reach - width, label.y - 6],
          [label.x + reach * 0.7, label.y - reach * 0.7 - 12],
          [label.x - reach * 0.7 - width, label.y - reach * 0.7 - 12],
          [label.x - width / 2, label.y - reach - 12],
        );
      }
      const fits = (box: Box, strict: boolean) => {
        if (boxes.some((other) => overlaps(box, other))) return false;
        const hitsDisc = discs.some(
          (disc) =>
            disc.id !== label.id && touches(box, disc.x, disc.y, disc.r),
        );
        if (hitsDisc) return false;
        // A leader mustn't run through another planet's name.
        const leader = leaderTo(label, box);
        if (!leader || !strict) return true;
        if (boxes.some((other) => crosses(leader, other))) return false;
        // Nor across a planet, or the Sun.
        return !discs.some(
          (disc) =>
            disc.id !== label.id &&
            crosses(leader, {
              left: disc.x - disc.r,
              right: disc.x + disc.r,
              top: disc.y - disc.r,
              bottom: disc.y + disc.r,
            }),
        );
      };
      // A spot whose leader runs clear first; failing that, any free spot.
      let chosen: Box | null = null;
      for (const strict of [true, false]) {
        for (const [x, top] of spots) {
          if (top < 2) continue;
          const left = Math.min(Math.max(x, 2), right - width);
          const box = { left, top, right: left + width, bottom: top + 12 };
          if (fits(box, strict)) {
            chosen = box;
            break;
          }
        }
        if (chosen) break;
      }
      // Nowhere free: beside it on the roomier side, overlapping if it must,
      // rather than an unnamed planet.
      if (!chosen) {
        const x =
          label.x < this.#width() / 2
            ? label.x + label.r + 5
            : label.x - label.r - 5 - width;
        const left = Math.min(Math.max(x, 2), right - width);
        chosen = {
          left,
          top: label.y - 6,
          right: left + width,
          bottom: label.y + 6,
        };
      }
      boxes.push(chosen);
      placed.push({
        id: label.id,
        name,
        left: chosen.left,
        top: chosen.top,
        leader: leaderTo(label, chosen),
      });
    }
    return placed;
  });
  /** The hairlines joining names placed a step away to their planets. */
  protected readonly leaders = computed(() =>
    this.placed().flatMap((label) =>
      label.leader ? [{ id: label.id, ...label.leader }] : [],
    ),
  );
  protected readonly plan = computed(() =>
    planSvg(this.state.time(), this.planSize),
  );

  #scene: OrreryScene | null = null;

  // A drag turns the view round the orrery, or the planet flown in to.
  // `translationX` is from the drag's start, so each update moves by the
  // difference since the last one.
  #lastX = 0;
  #lastY = 0;
  readonly #pan = new PanGesture()
    .minDistance(4)
    .onStart(() => {
      this.#lastX = 0;
      this.#lastY = 0;
    })
    .onUpdate((event) => {
      const dx = event.translationX - this.#lastX;
      const dy = event.translationY - this.#lastY;
      this.#lastX = event.translationX;
      this.#lastY = event.translationY;
      this.#drag(dx, dy);
    });
  // The coast after the finger lifts: Lynx sends it frame by frame as
  // `deltaX`/`deltaY` in the native params.
  readonly #fling = new FlingGesture().onUpdate((event) => {
    const dx = Number(event.params?.['deltaX'] ?? 0);
    const dy = Number(event.params?.['deltaY'] ?? 0);
    if (dx || dy) this.#drag(dx, dy * 0.3);
  });
  readonly #tap = new TapGesture().onEnd((event) => {
    const picked = this.#scene?.pick(event.x, event.y);
    if (picked) this.state.focus.set(picked);
  });
  protected readonly gesture = Gesture.Simultaneous(
    this.#pan,
    this.#fling,
    this.#tap,
  );

  constructor() {
    const destroyRef = inject(DestroyRef);
    // The canvas has a size once it's laid out, after the first render.
    afterNextRender(() => {
      const element = this.canvas().nativeElement;
      // null where there's no WebGL: Lynx Explorer.
      if (!element.getContext('webgl2')) {
        this.hasGl.set(false);
        return;
      }
      this.hasGl.set(true);
      const scene = new OrreryScene(
        element as unknown as HTMLCanvasElement,
        loadMaps(),
        (labels) => {
          this.#width.set(element.clientWidth || 402);
          this.labels.set(labels);
        },
      );
      scene.setTime(this.state.time());
      scene.setMotion(this.motion());
      this.#scene = scene;
      destroyRef.onDestroy(() => scene.dispose());
    });

    // Each effect reads its signals before touching the scene: with
    // \`this.#scene?.setTime(this.state.time())\` the read would be skipped
    // while the scene is null, and the effect would never run again.
    effect(() => {
      const time = this.state.time();
      this.#scene?.setTime(time);
    });
    effect(() => {
      const focus = this.state.focus();
      // Under Reduce Motion the camera cuts instead of flying.
      const animate = this.motion();
      this.#scene?.setFocus(focus, animate);
    });
    effect(() => {
      const motion = this.motion();
      this.#scene?.setMotion(motion);
    });
  }

  #drag(dx: number, dy: number): void {
    const scene = this.#scene;
    if (!scene) return;
    if (this.state.focus()) scene.spin(dx);
    else scene.orbit(dx, dy);
  }
}

type Box = { left: number; top: number; right: number; bottom: number };

type Leader = { x: number; y: number; length: number; angle: number };

type Placed = {
  id: BodyId;
  name: string;
  left: number;
  top: number;
  leader: Leader | null;
};

/**
 * Whether a leader runs through a box: tested at points along it.
 */
const crosses = (leader: Leader, box: Box) => {
  const radians = (leader.angle * Math.PI) / 180;
  for (let step = 1; step <= 12; step++) {
    const along = (leader.length * step) / 12;
    const x = leader.x + Math.cos(radians) * along;
    const y = leader.y + Math.sin(radians) * along;
    if (x > box.left && x < box.right && y > box.top && y < box.bottom) {
      return true;
    }
  }
  return false;
};

/**
 * An engraved hairline from a planet's edge to its name, when the name sits
 * a step away; none when it's right beside the planet.
 */
const leaderTo = (label: Label, box: Box): Leader | null => {
  // To the nearest point a few pixels outside the name, so the line ends
  // short of its letters.
  const nx = Math.max(box.left - 3, Math.min(label.x, box.right + 3));
  const ny = Math.max(box.top - 3, Math.min(label.y, box.bottom + 3));
  const dx = nx - label.x;
  const dy = ny - label.y;
  const distance = Math.hypot(dx, dy);
  if (distance < label.r + 12) return null;
  const x = label.x + (dx / distance) * (label.r + 2);
  const y = label.y + (dy / distance) * (label.r + 2);
  return {
    x,
    y,
    length: distance - label.r - 4,
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
};

const overlaps = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * Whether a box and a disc touch: the box's nearest point to the center.
 */
const touches = (box: Box, x: number, y: number, r: number) => {
  const nx = Math.max(box.left, Math.min(x, box.right));
  const ny = Math.max(box.top, Math.min(y, box.bottom));
  return (nx - x) ** 2 + (ny - y) ** 2 < r * r;
};

/**
 * The maps, loading: three.js draws a texture black until its image
 * arrives, then uploads it. sRGB values are linearized in the shaders.
 */
const loadMaps = (): Maps => {
  const loader = new THREE.TextureLoader();
  const load = (url: string) => {
    const texture = loader.load(url);
    texture.anisotropy = 4;
    // The maps wrap round the globe: the clouds drift past the seam, where a
    // clamped map would smear its edge into streaks.
    texture.wrapS = THREE.RepeatWrapping;
    return texture;
  };
  return {
    earthDay: load(earthDay),
    earthNight: load(earthNight),
    earthClouds: load(earthClouds),
    moon: load(moon),
    mars: load(mars),
    mercury: load(mercury),
  };
};
