import { Component, afterNextRender, computed, input } from '@angular/core';
import { LYNX_ELEMENTS, reportFullyDrawn } from '@blotch/angular-lynx';

import { SPRITE_BASE } from '../data/config';

type Kind = 'view' | 'text' | 'image';

/** The shell's module as main-thread code calls it (`lynx.module(name)`). */
type MainThreadModule = { invoke(method: string, ...args: unknown[]): unknown };

/**
 * Marks `MountStart`: the shell emits an os_signpost event whose message is
 * `MountStart` (ShellModule.swift's `markEvent`; on Android, ShellModule.kt
 * logs `Mark MountStart at <ns> ns`), which the harness reads with
 * the screen's `Fully Drawn` to time the screen apart from the launch before
 * it, as the React Native apps' `MountStart` does. Called from the main
 * thread, where Angular runs, straight to the shell's module (the runtime's
 * reportFullyDrawn() calls it the same way), so no hop to the background
 * thread delays the moment it marks. Lynx Explorer has no shell, and a shell
 * from before markEvent no such method: there it marks nothing.
 */
const markMountStart = (): void => {
  try {
    const lynxGlobal = (
      globalThis as { lynx?: { module?: (name: string) => unknown } }
    ).lynx;
    const module = lynxGlobal?.module?.('AngularLynxShell') as
      | Partial<MainThreadModule>
      | undefined;
    module?.invoke?.('markEvent', 'MountStart');
  } catch {
    // Nothing to mark with.
  }
};

const KINDS: readonly Kind[] = ['view', 'text', 'image'];

/**
 * The benchmark's rendering-throughput screen (benchmarks/SPEC.md, "Mount"):
 * `count` elements of one kind in a plain, wrapping container, not a
 * virtualized list, so every one of them is built. Opened as
 * `/bench/mount?kind=view&count=1500`; a build with BENCH_SCREEN set opens on
 * it at launch (see app.routes.ts).
 */
@Component({
  selector: 'app-mount',
  imports: [LYNX_ELEMENTS],
  template: `
    <!-- A scroll-view builds every child, so the ones past the screen can
         be scrolled to, as the original's ScrollView. -->
    <scroll-view class="screen" scroll-orientation="vertical">
      <view class="container">
        @switch (kind()) {
          @case ('text') {
            @for (i of items(); track i) {
              <text class="text">{{ i }}</text>
            }
          }
          @case ('image') {
            @for (i of items(); track i) {
              <image class="image" mode="aspectFit" [src]="sprite(i)" />
            }
          }
          @default {
            @for (i of items(); track i) {
              <view class="box"></view>
            }
          }
        }
      </view>
    </scroll-view>
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
    }
    .screen {
      flex: 1;
      width: 100%;
      background-color: #fff;
      padding-top: env(safe-area-inset-top);
    }
    .container {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
    }
    .box {
      width: 10px;
      height: 10px;
      background-color: #1a1a1a;
    }
    .text {
      font-size: 14px;
      color: #000;
    }
    .image {
      width: 24px;
      height: 24px;
    }
  `,
})
export class Mount {
  /** The query's `kind` and `count` (withComponentInputBinding). */
  readonly kindParam = input<string | undefined>(undefined, { alias: 'kind' });
  readonly countParam = input<string | undefined>(undefined, {
    alias: 'count',
  });

  protected readonly kind = computed<Kind>(() => {
    const kind = this.kindParam() as Kind;
    return KINDS.includes(kind) ? kind : 'view';
  });

  protected readonly items = computed(() => {
    const count = Number(this.countParam());
    return Array.from({ length: count > 0 ? count : 1500 }, (_, i) => i);
  });

  protected readonly sprite = (i: number) =>
    `${SPRITE_BASE}/${(i % 300) + 1}.png`;

  constructor() {
    // Before the template makes anything: the component is created as the
    // route activates, and its elements in its first render after. The
    // ReactLynx app marks as its screen's component first renders.
    markMountStart();
    // Every element is made in the screen's first render. reportFullyDrawn()
    // then waits for the flush that hands them to native, so it marks them
    // committed, as the original's MountEnd does after the commit.
    afterNextRender(() => reportFullyDrawn());
  }
}
