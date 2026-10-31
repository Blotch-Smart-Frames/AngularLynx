import { Component, ViewEncapsulation, computed, input } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { cn } from '../../utils/cn';
import { type IconName } from '../icon/icons';
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
    @if (icon()) {
      <ui-icon [name]="icon()!" size="lg" class="mb-3" />
    }
    <text [class]="titleClass()">{{ title() }}</text>
    @if (description()) {
      <text [class]="descriptionClass()">{{ description() }}</text>
    }
    <ng-content />
  `,
})
export class UiEmptyState {
  readonly icon = input<IconName | undefined>(undefined);
  readonly title = input.required<string>();
  readonly description = input('');
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly containerClass = computed(() =>
    cn(
      'flex-col items-center px-6 py-12 flex justify-center',
      this.userClass(),
    ),
  );

  protected readonly titleClass = computed(() =>
    cn('mb-1 text-lg font-semibold text-foreground'),
  );

  protected readonly descriptionClass = computed(() =>
    cn('mb-4 text-sm text-muted-foreground text-center'),
  );
}
