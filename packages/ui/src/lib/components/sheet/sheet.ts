import {
  Component,
  ViewEncapsulation,
  computed,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS, registerHostElement } from '@blotch/angular-lynx';

import {
  type BottomSheetVariant,
  type SheetDetent,
  type SheetSourceTarget,
  UiBottomSheet,
} from '../bottom-sheet/bottom-sheet';
import { cn } from '../../utils/cn';

/**
 * `UiBottomSheet`, for the sheet's view query. A call rather than the class
 * itself: for a class, Angular's test build keeps an arrow function that
 * nothing calls, which an app's coverage report would show as uncovered.
 */
const bottomSheetType = () => UiBottomSheet;

/**
 * Styled bottom sheet: a thin wrapper over the shared `ui-bottom-sheet`
 * primitive that adds content padding and pairs with the header/title/
 * description/footer layout helpers below. All the overlay, animation, and
 * drag-to-dismiss behavior lives in `ui-bottom-sheet`, and so do the glass
 * variant and the detents, which pass straight through.
 *
 * The consumer's `class` and the built-in padding are applied to an inner
 * content wrapper (not the panel, nor the sheet's host) — the panel chrome
 * (rounded corners, border, background) comes from the primitive.
 *
 * Mark the control that presents it with `[uiSheetSource]="sheet"`, and the
 * glass sheet grows out of it (see UiSheetSource).
 */
@Component({
  selector: 'ui-sheet',
  imports: [LYNX_ELEMENTS, UiBottomSheet],
  encapsulation: ViewEncapsulation.None,
  // The sheet's class is its content's, inside the overlay. Angular also
  // gives the host every static attribute the app writes on <ui-sheet>, and
  // the host sits in the page's layout where the sheet is written, so a
  // `class="px-8"` padded the page there too. The host drops it. The parts
  // below are their host elements for the same reason: a class on a part
  // lands on its host anyway, so a view or text inside it styled with the
  // same class applied it twice. The title and description are text, so
  // their hosts are `<text>` elements.
  host: { '[attr.class]': 'null' },
  // `open` is bound both ways by hand rather than with `[(open)]`: for a
  // two-way binding Angular also compiles a fallback that assigns the field,
  // which never runs for a signal and so shows as an uncovered branch in an
  // app's coverage report.
  template: `
    <ui-bottom-sheet
      [open]="open()"
      (openChange)="open.set($event)"
      [variant]="variant()"
      [detents]="detents()"
      [detent]="detent()"
      (detentChange)="detent.set($event)"
      (closed)="closed.emit()"
    >
      <view [class]="contentClass()">
        <ng-content />
      </view>
    </ui-bottom-sheet>
  `,
})
export class UiSheet implements SheetSourceTarget {
  readonly open = model(false);
  readonly userClass = input<string>('', { alias: 'class' });
  /** `'default'` or `'glass'`; see BottomSheetVariant. */
  readonly variant = input<BottomSheetVariant>('default');
  /** The heights the sheet rests at; see UiBottomSheet's `detents`. */
  readonly detents = input<readonly SheetDetent[]>(['fit']);
  /** The detent the sheet rests at; see UiBottomSheet's `detent`. */
  readonly detent = model<SheetDetent>();

  readonly closed = output<void>();

  // Required: always in the template.
  readonly bottomSheet = viewChild.required(bottomSheetType());

  /**
   * Whether the sheet covers the control that presents it; see
   * UiSheetSource.
   */
  coversSource(): boolean {
    return this.bottomSheet().coversSource();
  }

  /**
   * @internal Called by the `uiSheetSource` directive, for the sheet this
   * one draws on.
   */
  setSource(...source: Parameters<SheetSourceTarget['setSource']>): void {
    this.bottomSheet().setSource(...source);
  }

  /**
   * At a detent with a height of its own, the content fills the sheet as a
   * column, so a `flex-1` scroll view in it gets the height that's left.
   */
  protected readonly contentClass = computed(() =>
    cn(
      'px-6 pb-6',
      this.detents().some((detent) => detent !== 'fit') &&
        'flex-1 flex-col flex',
      this.userClass(),
    ),
  );
}

@Component({
  selector: 'ui-sheet-header',
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'containerClass()' },
  template: '<ng-content />',
})
export class UiSheetHeader {
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly containerClass = computed(() =>
    cn('mb-4 flex-col gap-1.5 flex', this.userClass()),
  );
}

@Component({
  selector: 'ui-sheet-title',
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'textClass()' },
  template: '<ng-content />',
})
export class UiSheetTitle {
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly textClass = computed(() =>
    cn('text-lg font-semibold text-foreground', this.userClass()),
  );
}

registerHostElement(UiSheetTitle, 'text');

@Component({
  selector: 'ui-sheet-description',
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'textClass()' },
  template: '<ng-content />',
})
export class UiSheetDescription {
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly textClass = computed(() =>
    cn('text-sm text-muted-foreground', this.userClass()),
  );
}

registerHostElement(UiSheetDescription, 'text');

@Component({
  selector: 'ui-sheet-footer',
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'containerClass()' },
  template: '<ng-content />',
})
export class UiSheetFooter {
  readonly userClass = input<string>('', { alias: 'class' });

  protected readonly containerClass = computed(() =>
    cn('flex-col gap-2 pt-4 flex', this.userClass()),
  );
}
