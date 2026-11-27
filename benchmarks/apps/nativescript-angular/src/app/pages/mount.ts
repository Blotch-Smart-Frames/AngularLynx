import { Component, NO_ERRORS_SCHEMA, afterNextRender, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Color, Page } from '@nativescript/core';
import { SPRITES } from '../data/config';
import { Startup } from '../startup/app-startup';

export type MountKind = 'view' | 'text' | 'image';

/**
 * The benchmark's mount screen: `count` elements of one kind in a plain wrapping container, not a
 * virtualized list, so the time is what it costs to create and lay out that many native views.
 * Opened by `bench/mount?kind=view&count=1500`, for Instruments as the screen the app starts on
 * (BENCH_SCREEN; see app.routes.ts).
 */
@Component({
  selector: 'app-mount',
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <WrapLayout class="grid">
      @switch (kind) {
        @case ('text') {
          @for (i of indices; track i) {
            <Label class="text" [text]="i"></Label>
          }
        }
        @case ('image') {
          @for (i of indices; track i) {
            <Image class="image" loadMode="async" [src]="sprites[i]"></Image>
          }
        }
        @default {
          @for (i of indices; track i) {
            <StackLayout class="box"></StackLayout>
          }
        }
      }
    </WrapLayout>
  `,
  styles: `
    .grid {
      background-color: #ffffff;
    }
    .box {
      width: 10;
      height: 10;
      background-color: #6390f0;
    }
    .text {
      font-size: 12;
      color: #000000;
    }
    .image {
      width: 24;
      height: 24;
    }
  `,
})
export class Mount {
  readonly #params = inject(ActivatedRoute).snapshot.queryParamMap;
  protected readonly kind = (this.#params.get('kind') ?? 'view') as MountKind;
  // 1500 only when the link has no count: an explicit 0 is an empty screen.
  protected readonly indices = Array.from(
    { length: Number(this.#params.get('count') ?? 1500) || 0 },
    (_, i) => i,
  );
  protected readonly sprites = this.indices.map((i) => `${SPRITES}/${(i % 300) + 1}.png`);

  constructor() {
    const page = inject(Page);
    page.actionBarHidden = true;
    page.statusBarStyle = 'dark';
    page.backgroundColor = new Color('#ffffff');

    const startup = inject(Startup);
    // The screen begins rendering here: its template is created in the change detection pass
    // that follows the constructor.
    startup.reportMountStart();
    // The first pass creates every view, so the frame after it is the one that shows them all
    // (NativeScript lays them out in the run loop turn that created them). TTFD is the mark the
    // harness reads for a launch straight into this screen; the native class keeps only the first.
    afterNextRender(() =>
      requestAnimationFrame(() => {
        startup.reportMountEnd();
        startup.reportFullyDrawn();
      }),
    );
  }
}
