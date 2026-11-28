import {
  CdkFixedSizeVirtualScroll,
  CdkVirtualForOf,
  CdkVirtualScrollViewport,
} from '@angular/cdk/scrolling';
import {
  Component,
  DestroyRef,
  afterNextRender,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { IonSpinner } from '@ionic/angular';
import type { Pokemon } from '../data/pokemon';
import { PokemonItem, ROW_HOST } from './pokemon-item';

/**
 * The reference's PokemonList (a FlatList) on the Angular CDK's virtual scroll viewport, which
 * builds only the rows near the screen and reuses the ones scrolled away: Ionic removed its own
 * virtual scroll in Ionic 7 and points to the CDK's, inside `<ion-content>` as its docs show
 * (`ion-content-scroll-host`).
 *
 * Every card is the same height (16 + 64 + 16 of content, a 1px border each side, and the 8px
 * margin under it), so the viewport is given that height rather than measuring each row. The
 * header and the spinners sit in the viewport's content, before and after the rows.
 */
@Component({
  selector: 'app-pokemon-list',
  imports: [CdkFixedSizeVirtualScroll, CdkVirtualForOf, CdkVirtualScrollViewport, IonSpinner, PokemonItem],
  providers: [{ provide: ROW_HOST, useExisting: PokemonList }],
  template: `
    <div class="frame">
      <cdk-virtual-scroll-viewport
        class="list ion-content-scroll-host"
        [itemSize]="106"
        minBufferPx="900"
        maxBufferPx="1350"
      >
        <div class="header">{{ headerText() }}</div>
        <app-pokemon-item
          *cdkVirtualFor="let pokemon of data(); let index = index; trackBy: keyOf"
          [pokemon]="pokemon"
          [index]="index"
        />
        @if (data().length === 0) {
          <div class="empty">
            @if (loading()) {
              <ion-spinner name="lines" />
            } @else {
              <span class="empty-text">{{ error() ? 'Failed to load' : emptyMessage() }}</span>
            }
          </div>
        } @else if (fetchingNextPage()) {
          <div class="footer"><ion-spinner name="lines-small" /></div>
        }
      </cdk-virtual-scroll-viewport>
    </div>
  `,
  styles: `
    :host,
    .frame {
      display: block;
      height: 100%;
    }
    /* White under the status bar, the light grey screen below it (the reference's TabScreenFrame). */
    .frame {
      box-sizing: border-box;
      padding-top: var(--ion-safe-area-top, 0);
      background-color: #ffffff;
    }
    .list {
      height: 100%;
      background-color: #f7f7f7;
    }
    /* FlatList's 16px content padding around its header and rows, and the header's own 8px below. */
    .header {
      margin: 16px 16px 8px;
      font-size: 16px;
      font-weight: bold;
      color: #000000;
    }
    app-pokemon-item {
      display: block;
      padding: 0 16px;
    }
    .empty {
      display: flex;
      justify-content: center;
      padding-top: 64px;
    }
    .empty-text {
      color: #9e9e9e;
    }
    .footer {
      display: flex;
      justify-content: center;
      padding-bottom: 16px;
    }
  `,
})
export class PokemonList {
  readonly data = input.required<readonly Pokemon[]>();
  readonly headerText = input.required<string>();
  readonly loading = input(false);
  readonly error = input(false);
  readonly emptyMessage = input('');
  readonly fetchingNextPage = input(false);
  readonly endReached = output<void>();

  readonly viewport = viewChild.required(CdkVirtualScrollViewport);

  readonly #rowsShown = signal(false);
  /**
   * Whether the viewport has built any rows yet, for the page that reports fully drawn. The rows
   * tell the list as they're created: the viewport builds them in a change detection pass of its
   * own, which doesn't refresh this view, so a `viewChildren` of them would stay empty.
   */
  readonly rowsShown = this.#rowsShown.asReadonly();

  rowCreated(): void {
    this.#rowsShown.set(true);
  }

  protected readonly keyOf = (_: number, item: Pokemon) => item.id;

  constructor() {
    // The reference loads the next page when the end comes within half a screen
    // (`onEndReachedThreshold` 0.5).
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const viewport = this.viewport();
      const subscription = viewport.elementScrolled().subscribe(() => {
        if (
          this.data().length > 0 &&
          viewport.measureScrollOffset('bottom') < viewport.getViewportSize() / 2
        ) {
          this.endReached.emit();
        }
      });
      destroyRef.onDestroy(() => subscription.unsubscribe());
    });
  }
}
