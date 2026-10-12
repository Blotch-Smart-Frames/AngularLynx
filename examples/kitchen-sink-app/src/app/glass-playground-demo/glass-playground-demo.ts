import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  createMainThreadRef,
  LYNX_ELEMENTS,
  LynxMainThreadEvent,
  type MainThread,
  mainThreadFn,
} from '@blotch/angular-lynx';
import { UiBadge } from '../../components/ui/badge';
import { UiButton } from '../../components/ui/button';
import { UiText } from '../../components/ui/typography';
import { ScreenHost } from '../screen-host';

type Point = { x: number; y: number };
type GlassStyle = 'regular' | 'clear';

/**
 * Where a drag began: the finger that grabbed the blob, and both the finger's
 * and the blob's starting positions.
 */
type Drag = {
  touchId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

const BLOB_SIZE = 96;
const START_POSITIONS: readonly Point[] = [
  { x: 16, y: 40 },
  { x: 140, y: 124 },
  { x: 40, y: 220 },
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

/**
 * Builds the touch handlers for one blob. Each blob tracks the finger that
 * grabbed it by touch identifier, so two fingers can drag two blobs into each
 * other at once.
 */
const createBlobDrag = (index: number) => ({
  start: mainThreadFn((event: MainThread.TouchEvent) => {
    const touch = event.changedTouches[0] ?? event.touches[0];
    if (!touch) return;
    const origin = positions.current[index]!;
    drags.current[index] = {
      touchId: touch.identifier,
      startX: touch.pageX,
      startY: touch.pageY,
      originX: origin.x,
      originY: origin.y,
    };
  }),
  move: mainThreadFn((event: MainThread.TouchEvent) => {
    const drag = drags.current[index];
    if (!drag) return;
    const touch =
      event.touches.find(
        (t: { identifier: number }) => t.identifier === drag.touchId,
      ) ?? event.touches[0];
    if (!touch) return;
    const x = clamp(
      drag.originX + touch.pageX - drag.startX,
      stageSize.current.width,
    );
    const y = clamp(
      drag.originY + touch.pageY - drag.startY,
      stageSize.current.height,
    );
    positions.current[index] = { x, y };
    // Move with left/top rather than a transform so each blob's native frame
    // moves with it.
    event.currentTarget.setStyleProperties({ left: `${x}px`, top: `${y}px` });
  }),
  end: mainThreadFn(() => {
    drags.current[index] = null;
  }),
});

// Created at module scope, in a fixed order, so both thread bundles assign the
// same main-thread function IDs.
const BLOBS = START_POSITIONS.map((position, index) => ({
  ...position,
  drag: createBlobDrag(index),
}));

/**
 * Liquid Glass playground: drag glass blobs over text. On iOS 26 each blob
 * refracts the text behind it, and blobs closer than the merge distance flow
 * together into one shape. Other platforms show frosted circles.
 *
 * Like the gesture demo, it deliberately avoids `DemoScreen` and any
 * scroll-view: a vertical drag inside a scroll-view would scroll the page
 * instead of moving the glass. The stage claims the free height via `flex-1`.
 */
@Component({
  selector: 'app-glass-playground-demo',
  hostDirectives: [ScreenHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS, LynxMainThreadEvent, UiBadge, UiButton, UiText],
  template: `
    <view class="h-full w-full flex-col gap-3 bg-background p-4 flex">
      <view class="flex-row items-center gap-2 flex">
        <ui-text variant="h3">Glass Playground</ui-text>
        <ui-badge variant="secondary">Elements</ui-badge>
      </view>
      <ui-text variant="muted">
        Drag the glass over the text. Bring two blobs together to merge them.
      </ui-text>

      <view
        class="flex-1 rounded-xl border border-border bg-card relative overflow-hidden"
        [mainThreadBindlayoutchange]="onStageLayout"
      >
        <!-- The glass bends and magnifies this text near its edges. -->
        <view class="h-full w-full p-4 absolute left-0 top-0" [flatten]="false">
          <text class="text-[56px] font-black leading-[60px] text-foreground">
            Liquid
          </text>
          <text class="text-[56px] font-black leading-[60px] text-indigo-500">
            Glass
          </text>
          <text class="mt-2 text-[15px] leading-[22px] text-muted-foreground">
            Each blob refracts what is behind it, and blobs closer than the
            merge distance flow together into one shape, like drops of water.
          </text>
          <view class="mt-3">
            @for (word of words; track word.text) {
              <text
                class="text-[44px] font-black leading-[48px]"
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
              class="rounded-[48px] absolute"
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
            ></blur-view>
          }
        </blur-view>
      </view>

      <view class="flex-row items-center gap-2 flex">
        <ui-text variant="muted" class="w-[64px]">Merge</ui-text>
        @for (s of spacings; track s) {
          <ui-button
            size="sm"
            [variant]="s === spacing() ? 'default' : 'outline'"
            (pressed)="spacing.set(s)"
          >
            {{ s }}
          </ui-button>
        }
      </view>
      <view class="flex-row items-center gap-2 flex">
        <ui-text variant="muted" class="w-[64px]">Glass</ui-text>
        @for (s of glassStyles; track s) {
          <ui-button
            size="sm"
            [variant]="s === glassStyle() ? 'default' : 'outline'"
            (pressed)="glassStyle.set(s)"
          >
            {{ s }}
          </ui-button>
        }
        <ui-button
          size="sm"
          [variant]="interactive() ? 'default' : 'outline'"
          (pressed)="interactive.set(!interactive())"
        >
          interactive
        </ui-button>
      </view>
    </view>
  `,
})
export class GlassPlaygroundDemo {
  readonly blobs = BLOBS;
  readonly blobSize = BLOB_SIZE;
  readonly onStageLayout = onStageLayout;
  readonly spacings = [0, 24, 48] as const;
  readonly glassStyles: readonly GlassStyle[] = ['clear', 'regular'];
  readonly words = [
    { text: 'Refract', color: 'text-pink-500' },
    { text: 'Merge', color: 'text-emerald-500' },
    { text: 'Flow', color: 'text-amber-500' },
  ] as const;

  readonly spacing = signal<number>(24);
  // Clear glass is the most transparent variant, so the refraction of the text
  // behind it is easiest to see.
  readonly glassStyle = signal<GlassStyle>('clear');
  // Off by default: whether interactive glass's own touch handling coexists
  // with the drag hasn't been verified on device.
  readonly interactive = signal(false);
}
