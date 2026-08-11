import {
  Component,
  ViewEncapsulation,
  computed,
  input,
  model,
  output,
} from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';

import { UiBottomSheet } from '../bottom-sheet/bottom-sheet';
import { cn } from '@blotch/dolan/utils/cn';

/**
 * Styled bottom sheet: a thin wrapper over the shared `ui-bottom-sheet`
 * primitive that adds content padding and pairs with the header/title/
 * description/footer layout helpers below. All the overlay, animation, and
 * drag-to-dismiss behavior lives in `ui-bottom-sheet`.
 *
 * The consumer's `class` and the built-in padding are applied to an inner
 * content wrapper (not the panel) — the panel chrome (rounded corners, border,
 * background) comes from the primitive.
 */
@Component({
  selector: 'ui-sheet',
  standalone: true,
  imports: [LYNX_ELEMENTS, UiBottomSheet],
  encapsulation: ViewEncapsulation.None,
  template: `
    <ui-bottom-sheet [(open)]="open" (closed)="closed.emit()">
      <view [class]="contentClass()">
        <ng-content />
      </view>
    </ui-bottom-sheet>
  `,
})
export class UiSheet {
  readonly open = model(false);
  readonly userClass = input<string>('', { alias: 'class' });

  readonly closed = output<void>();

  protected readonly contentClass = computed(() =>
    cn('px-6 pb-6', this.userClass()),
  );
}

@Component({
  selector: 'ui-sheet-header',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="containerClass()">
      <ng-content />
    </view>
  `,
})
export class UiSheetHeader {
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly containerClass = computed(() =>
    cn('mb-4 flex-col gap-1.5 flex', this.userClass()),
  );
}

@Component({
  selector: 'ui-sheet-title',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `<text [class]="textClass()"><ng-content /></text>`,
})
export class UiSheetTitle {
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly textClass = computed(() =>
    cn('text-lg font-semibold text-foreground', this.userClass()),
  );
}

@Component({
  selector: 'ui-sheet-description',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `<text [class]="textClass()"><ng-content /></text>`,
})
export class UiSheetDescription {
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly textClass = computed(() =>
    cn('text-sm text-muted-foreground', this.userClass()),
  );
}

@Component({
  selector: 'ui-sheet-footer',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  encapsulation: ViewEncapsulation.None,
  template: `
    <view [class]="containerClass()">
      <ng-content />
    </view>
  `,
})
export class UiSheetFooter {
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly containerClass = computed(() =>
    cn('flex-col gap-2 pt-4 flex', this.userClass()),
  );
}
