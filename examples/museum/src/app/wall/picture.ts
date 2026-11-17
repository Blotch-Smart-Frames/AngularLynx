import { Component, computed, input, linkedSignal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import type { Artwork } from '../data/artwork';

/**
 * A work's picture in its pane. Until it loads the pane is frosted glass;
 * then the glass clears into the picture (a 400ms fade). `fit` shows the
 * whole work, as on its own screen; `fill` crops it to the pane, as a wall
 * of panes does.
 *
 * In a virtualized list one of these is reused for another work as it
 * scrolls, so whether it has loaded is derived from the picture's URL and
 * starts again with each new one.
 */
@Component({
  selector: 'app-picture',
  imports: [LYNX_ELEMENTS],
  host: { class: 'flex flex-col overflow-hidden pane-seed' },
  template: `
    <image
      class="h-full w-full"
      [src]="src()"
      [attr.mode]="fit() ? 'aspectFit' : 'aspectFill'"
      [style.opacity]="loaded() ? 1 : 0"
      style="transition: opacity 400ms cubic-bezier(0.22, 1, 0.36, 1)"
      [attr.accessibility-element]="true"
      [attr.accessibility-label]="label()"
      (bindload)="loaded.set(true)"
    />
  `,
})
export class Picture {
  readonly work = input.required<Artwork>();
  readonly fit = input(false);

  protected readonly src = computed(() => this.work().image.url);
  protected readonly loaded = linkedSignal({
    source: this.src,
    computation: () => false,
  });
  protected readonly label = computed(() => {
    const work = this.work();
    return work.maker ? `${work.title}, by ${work.maker}` : work.title;
  });
}
