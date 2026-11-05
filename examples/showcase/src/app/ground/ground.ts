import { Component, computed, inject } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { facetMapSvg } from '../cut/facet-map';
import { AtlasState } from '../state/atlas-state';

/** Each tile's size: three across a phone, so the repeat never shows. */
const TILE = 134;
const COLUMNS = 3;
/** Rows enough for the tallest phone; the layer is clipped to its host. */
const ROWS = 9;

/**
 * The paper's ground: the chosen cut's facet map, tiled at a hairline's
 * share of ink, behind every sheet. A static layer under a scroll container,
 * never inside one: an absolute child of a scroll-view takes its gesture.
 * Lynx can't paint an SVG as a background image, so the tiles are `<svg>`
 * elements.
 */
@Component({
  selector: 'view[appGround]',
  imports: [LYNX_ELEMENTS],
  host: { class: 'overflow-hidden' },
  template: `
    @for (tile of tiles; track tile.key) {
      <svg
        class="absolute"
        [style.left.px]="tile.x"
        [style.top.px]="tile.y"
        [style.width.px]="size"
        [style.height.px]="size"
        [attr.content]="map()"
      ></svg>
    }
  `,
})
export class Ground {
  readonly #atlas = inject(AtlasState);

  protected readonly size = TILE;
  protected readonly tiles = Array.from({ length: COLUMNS * ROWS }, (_, i) => ({
    key: i,
    x: (i % COLUMNS) * TILE,
    y: Math.floor(i / COLUMNS) * TILE,
  }));

  // Ink on paper by day, paper on ink by night, at six percent either way.
  protected readonly map = computed(() =>
    facetMapSvg(
      this.#atlas.cut(),
      TILE,
      this.#atlas.dark()
        ? 'rgba(242, 239, 230, 0.07)'
        : 'rgba(22, 24, 29, 0.07)',
    ),
  );
}
