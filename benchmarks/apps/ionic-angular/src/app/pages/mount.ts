import { Component, afterNextRender, computed, inject, input, numberAttribute } from '@angular/core';
import { IonContent } from '@ionic/angular';
import { SPRITES } from '../data/config';
import { Startup } from '../startup/app-startup';

export type MountKind = 'view' | 'text' | 'image';

/**
 * The benchmark's mount screen: `count` elements of one kind in a plain wrapping container, not a
 * virtualized list, so the time is what it costs to create, lay out and draw that many elements.
 * Opened by `bench/mount?kind=view&count=1500`, for Instruments as the screen the app starts on
 * (BENCH_SCREEN; see app.routes.ts).
 */
@Component({
  selector: 'app-mount',
  imports: [IonContent],
  template: `
    <ion-content>
      <div class="grid">
        @switch (kind()) {
          @case ('text') {
            @for (i of indices(); track i) {
              <span class="text">{{ i }}</span>
            }
          }
          @case ('image') {
            @for (i of indices(); track i) {
              <img class="image" [src]="sprites()[i]" alt="" />
            }
          }
          @default {
            @for (i of indices(); track i) {
              <div class="box"></div>
            }
          }
        }
      </div>
    </ion-content>
  `,
  styles: `
    ion-content {
      --background: #ffffff;
    }
    /* Under the status bar, as the reference pads its screen by the top inset. */
    .grid {
      padding-top: var(--ion-safe-area-top, 0);
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      align-content: flex-start;
    }
    .box {
      width: 10px;
      height: 10px;
      background-color: #6390f0;
    }
    .text {
      font-size: 12px;
      color: #000000;
    }
    .image {
      width: 24px;
      height: 24px;
    }
  `,
})
export class Mount {
  // Query params, bound by withComponentInputBinding.
  readonly kind = input<MountKind>('view');
  readonly count = input(1500, { transform: (value: unknown) => numberAttribute(value, 1500) });

  protected readonly indices = computed(() => Array.from({ length: this.count() }, (_, i) => i));
  protected readonly sprites = computed(() =>
    this.indices().map((i) => `${SPRITES}/${(i % 300) + 1}.png`),
  );

  constructor() {
    const startup = inject(Startup);
    // The screen begins rendering here: its template is created in the change detection pass
    // that follows the constructor.
    startup.reportMountStart();
    // The first pass creates every element, so afterNextRender runs once they're all in the DOM,
    // and the frame after it is the one that draws them. TTFD is the mark the harness reads for a
    // launch straight into this screen; the plugin keeps only the first.
    afterNextRender(() =>
      requestAnimationFrame(() => {
        startup.reportMountEnd();
        startup.reportFullyDrawn();
      }),
    );
  }
}
