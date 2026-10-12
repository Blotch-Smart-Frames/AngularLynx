import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

/**
 * E2E fixture loaded through `loadComponent`, so the build splits it into its
 * own chunk. Chunk loading only fails at runtime, never at build time, so the
 * render tests navigate here and look for its text.
 */
@Component({
  selector: 'app-lazy-route',
  imports: [LYNX_ELEMENTS],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<text style="margin-top: 16px;">Lazy page loaded</text>`,
})
export class LazyRoute {}
