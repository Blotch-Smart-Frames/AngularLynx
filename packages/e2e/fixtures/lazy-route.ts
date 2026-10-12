import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

/**
 * E2E fixture loaded through `loadComponent`. Lazy loading only fails at
 * runtime, never at build time, so the render tests navigate here and look for
 * its text. The text isn't flattened, so Maestro can see it on Android (see
 * counter.ts).
 */
@Component({
  selector: 'app-lazy-route',
  imports: [LYNX_ELEMENTS],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<text flatten="false" style="margin-top: 16px;"
    >Lazy page loaded</text
  >`,
})
export class LazyRoute {}
