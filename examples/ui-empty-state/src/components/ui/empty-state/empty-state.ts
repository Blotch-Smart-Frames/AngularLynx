import { Component, ViewEncapsulation, computed, input } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { cn } from '@blotch/dolan/utils/cn';
import { type IconName, optionalIconMarkup } from '../icon/icons';
import { UiIcon } from '../icon/icon';

/**
 * The empty state is its host, styled through `host`. Angular gives a
 * component's host every static attribute the app writes on it, so a class on
 * <ui-empty-state> lands on the host whatever the component does: with a
 * styled view inside as well, the padding applied twice. Its title lands
 * there too, and goes: it's shown in a <text>, and on the web preview a
 * `title` attribute is a tooltip (and a second match for getByTitle).
 */
@Component({
  selector: 'ui-empty-state',
  imports: [LYNX_ELEMENTS, UiIcon],
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'containerClass()',
    '[attr.title]': 'null',
  },
  template: `
    @if (iconMarkup(); as markup) {
      <ui-icon
        [svg]="markup"
        size="lg"
        color="var(--muted-foreground)"
        class="mb-4"
      />
    }
    <text [class]="titleClass()">{{ title() }}</text>
    @if (description()) {
      <text [class]="descriptionClass()">{{ description() }}</text>
    }
    <ng-content />
  `,
})
export class UiEmptyState {
  /** An icon from the set (see `ICONS`) over the title. Give this or `svg`. */
  readonly icon = input<IconName | undefined>(undefined);
  /**
   * SVG markup to draw instead of an icon from the set, such as the app's
   * own illustration of what's missing. `currentColor` in it takes the muted
   * foreground, as the set's icons do; colors written out stay. Give this or
   * `icon`.
   */
  readonly svg = input<string | undefined>(undefined);
  readonly title = input.required<string>();
  readonly description = input('');
  readonly userClass = input<string>('', { alias: 'class' });

  /**
   * The icon's markup, from the set or the app's own, or nothing. The
   * <ui-icon> gets it as its `svg` either way, so the empty state checks for
   * both itself and names itself in the error rather than the icon.
   */
  protected readonly iconMarkup = computed(() =>
    optionalIconMarkup(
      this.icon(),
      this.svg(),
      '<ui-empty-state> takes an icon or an svg, not both.',
    ),
  );

  protected readonly containerClass = computed(() =>
    cn(
      'flex-col items-center px-6 py-12 flex justify-center',
      this.userClass(),
    ),
  );

  protected readonly titleClass = computed(() =>
    cn('mb-1 text-xl font-semibold text-foreground text-center'),
  );

  protected readonly descriptionClass = computed(() =>
    cn('mb-4 text-base text-muted-foreground text-center'),
  );
}
