import { Component, signal } from '@angular/core';
import {
  createMainThreadRef,
  LYNX_ELEMENTS,
  LynxMainThreadEvent,
  type MainThread,
  mainThreadFn,
} from '@blotch/angular-lynx';

type Point = { x: number; y: number };
type GlassStyle = 'regular' | 'clear';

/**
 * Where a drag began: the finger that grabbed the blob (or `MOUSE`), and both
 * the pointer's and the blob's starting positions.
 */
type Drag = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

/** Stands in for a touch identifier while a mouse drags a blob. */
const MOUSE = -1;

const BLOB_SIZE = 104;
const START_POSITIONS: readonly Point[] = [
  { x: 20, y: 56 },
  { x: 150, y: 150 },
  { x: 48, y: 260 },
];

// Drag state lives on the main thread, next to the native views. Handling the
// touches there moves a blob on the same frame as the finger; routing them
// through Angular on the background thread would add a round trip per frame.
const positions = createMainThreadRef<Point[]>(
  START_POSITIONS.map((p) => ({ ...p })),
);
const drags = createMainThreadRef<(Drag | null)[]>(
  START_POSITIONS.map(() => null),
);
const stageSize = createMainThreadRef({ width: 0, height: 0 });
// The blob a mouse is dragging. Mouse moves are followed on the stage rather
// than the blob (see onStageMouseMove), so it keeps the blob's element to move.
const mouseDrag = createMainThreadRef<{
  index: number;
  blob: MainThread.Element;
} | null>(null);

const onStageLayout = mainThreadFn((event: MainThread.LayoutChangeEvent) => {
  stageSize.current = {
    width: event.detail.width,
    height: event.detail.height,
  };
});

/**
 * Keeps a blob fully inside the stage. Before the stage's first layout event
 * its size is unknown, so the value passes through unclamped.
 */
const clamp = (value: number, max: number): number =>
  max > 0 ? Math.min(Math.max(value, 0), max - BLOB_SIZE) : value;

const startDrag = (
  index: number,
  pointerId: number,
  pageX: number,
  pageY: number,
): void => {
  const origin = positions.current[index]!;
  drags.current[index] = {
    pointerId,
    startX: pageX,
    startY: pageY,
    originX: origin.x,
    originY: origin.y,
  };
};

const dragTo = (
  index: number,
  blob: MainThread.Element,
  pageX: number,
  pageY: number,
): void => {
  const drag = drags.current[index];
  if (!drag) return;
  const x = clamp(drag.originX + pageX - drag.startX, stageSize.current.width);
  const y = clamp(drag.originY + pageY - drag.startY, stageSize.current.height);
  positions.current[index] = { x, y };
  // Move with left/top rather than a transform: the glass container decides
  // which shapes merge from each blob's laid-out frame.
  blob.setStyleProperties({ left: `${x}px`, top: `${y}px` });
};

const endMouseDrag = (): void => {
  const drag = mouseDrag.current;
  if (!drag) return;
  drags.current[drag.index] = null;
  mouseDrag.current = null;
};

/**
 * Follows a mouse drag anywhere on the stage. A desktop browser running Lynx
 * for Web fires no touch events, and unlike a touch, a fast mouse flick
 * leaves the blob behind, so its moves only reach the stage.
 */
const onStageMouseMove = mainThreadFn((event: MainThread.MouseEvent) => {
  const drag = mouseDrag.current;
  if (!drag) return;
  // The button came up outside the stage, so its mouseup never arrived here.
  if (!event.buttons) {
    endMouseDrag();
    return;
  }
  dragTo(drag.index, drag.blob, event.pageX, event.pageY);
});

const onStageMouseUp = mainThreadFn(() => {
  endMouseDrag();
});

/**
 * Builds the pointer handlers for one blob. Each blob tracks the finger that
 * grabbed it by touch identifier, so two fingers can drag two blobs into each
 * other at once.
 */
const createBlobDrag = (index: number) => ({
  start: mainThreadFn((event: MainThread.TouchEvent) => {
    const touch = event.changedTouches[0] ?? event.touches[0];
    if (!touch) return;
    startDrag(index, touch.identifier, touch.pageX, touch.pageY);
  }),
  move: mainThreadFn((event: MainThread.TouchEvent) => {
    const drag = drags.current[index];
    if (!drag) return;
    const touch =
      event.touches.find(
        (t: { identifier: number }) => t.identifier === drag.pointerId,
      ) ?? event.touches[0];
    if (!touch) return;
    dragTo(index, event.currentTarget, touch.pageX, touch.pageY);
  }),
  end: mainThreadFn(() => {
    drags.current[index] = null;
  }),
  mouseDown: mainThreadFn((event: MainThread.MouseEvent) => {
    startDrag(index, MOUSE, event.pageX, event.pageY);
    mouseDrag.current = { index, blob: event.currentTarget };
  }),
});

// Created at module scope, in a fixed order, so both thread bundles assign the
// same main-thread function IDs.
const BLOBS = START_POSITIONS.map((position, index) => ({
  ...position,
  drag: createBlobDrag(index),
}));

@Component({
  selector: 'app-glass-playground',
  host: { class: 'flex flex-1 flex-col px-6 pb-6' },
  template: `
    <view
      class="flex-1 rounded-2xl border border-zinc-200 bg-white relative overflow-hidden"
      [mainThreadBindlayoutchange]="onStageLayout"
      [mainThreadBindmousemove]="onStageMouseMove"
      [mainThreadBindmouseup]="onStageMouseUp"
    >
      <!-- The glass bends and magnifies this text near its edges. -->
      <view class="h-full w-full p-5 absolute left-0 top-0" [flatten]="false">
        <text class="text-[64px] font-black leading-[68px] text-zinc-900">
          Liquid
        </text>
        <text class="text-[64px] font-black leading-[68px] text-indigo-600">
          Glass
        </text>
        <text class="mt-3 text-[17px] leading-[26px] text-zinc-600">
          Drag the glass over this text. Each blob refracts what is behind it,
          and blobs closer than the merge distance flow together into one shape,
          like drops of water.
        </text>
        <!-- More text so there is something to refract anywhere on the stage. -->
        <view class="mt-4">
          @for (word of words; track word.text) {
            <text
              class="text-[48px] font-black leading-[52px]"
              [class]="word.color"
            >
              {{ word.text }}
            </text>
          }
        </view>
      </view>

      <!--
        One glass-container groups the blobs so they can merge. Each blob must
        be a direct child for the container to blend it with its neighbors.
      -->
      <blur-view
        class="h-full w-full absolute left-0 top-0"
        blur-effect="glass-container"
        [spacing]="spacing()"
      >
        @for (blob of blobs; track $index) {
          <blur-view
            class="rounded-[52px] absolute"
            [style.left.px]="blob.x"
            [style.top.px]="blob.y"
            [style.width.px]="blobSize"
            [style.height.px]="blobSize"
            blur-effect="glass"
            blur-radius="12px"
            [glass-style]="glassStyle()"
            [glass-interactive]="interactive()"
            [mainThreadBindtouchstart]="blob.drag.start"
            [mainThreadBindtouchmove]="blob.drag.move"
            [mainThreadBindtouchend]="blob.drag.end"
            [mainThreadBindmousedown]="blob.drag.mouseDown"
          ></blur-view>
        }
      </blur-view>
    </view>

    <text class="mb-2 mt-4 text-[13px] text-zinc-500">
      Merge distance (spacing)
    </text>
    <view class="flex-row flex">
      @for (s of spacings; track s) {
        <view
          class="mr-2 rounded-lg px-3 py-2"
          [class.bg-zinc-900]="s === spacing()"
          [class.bg-zinc-100]="s !== spacing()"
          (bindtap)="spacing.set(s)"
        >
          <text
            class="text-[13px]"
            [class.text-white]="s === spacing()"
            [class.text-zinc-700]="s !== spacing()"
          >
            {{ s }}
          </text>
        </view>
      }
    </view>

    <view class="mt-4 flex-row flex">
      <view class="mr-6">
        <text class="mb-2 text-[13px] text-zinc-500">glass-style</text>
        <view class="flex-row flex">
          @for (s of glassStyles; track s) {
            <view
              class="mr-2 rounded-lg px-3 py-2"
              [class.bg-zinc-900]="s === glassStyle()"
              [class.bg-zinc-100]="s !== glassStyle()"
              (bindtap)="glassStyle.set(s)"
            >
              <text
                class="text-[13px]"
                [class.text-white]="s === glassStyle()"
                [class.text-zinc-700]="s !== glassStyle()"
              >
                {{ s }}
              </text>
            </view>
          }
        </view>
      </view>
      <view>
        <text class="mb-2 text-[13px] text-zinc-500">glass-interactive</text>
        <view
          class="self-start rounded-lg px-3 py-2"
          [class.bg-zinc-900]="interactive()"
          [class.bg-zinc-100]="!interactive()"
          (bindtap)="interactive.set(!interactive())"
        >
          <text
            class="text-[13px]"
            [class.text-white]="interactive()"
            [class.text-zinc-700]="!interactive()"
          >
            {{ interactive() ? 'On' : 'Off' }}
          </text>
        </view>
      </view>
    </view>

    <text class="mt-4 text-[12px] text-zinc-400">
      Merging and refraction need iOS 26 or web. Android shows frosted circles,
      and Harmony plain blurred ones.
    </text>
  `,
  imports: [LYNX_ELEMENTS, LynxMainThreadEvent],
})
export class GlassPlayground {
  readonly blobs = BLOBS;
  readonly blobSize = BLOB_SIZE;
  readonly onStageLayout = onStageLayout;
  readonly onStageMouseMove = onStageMouseMove;
  readonly onStageMouseUp = onStageMouseUp;
  readonly spacings = [0, 24, 48] as const;
  readonly words = [
    { text: 'Refract', color: 'text-pink-500' },
    { text: 'Merge', color: 'text-emerald-500' },
    { text: 'Flow', color: 'text-amber-500' },
  ] as const;
  readonly glassStyles: readonly GlassStyle[] = ['clear', 'regular'];

  readonly spacing = signal<number>(24);
  // Clear glass is the most transparent variant, so the refraction of the text
  // behind it is easiest to see.
  readonly glassStyle = signal<GlassStyle>('clear');
  readonly interactive = signal(false);
}
