import {
  Component,
  type ElementRef,
  Renderer2,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { LYNX_ELEMENTS, type LynxListItemAttributes } from '@blotch/angular-lynx';

import { UiSpinner } from '../../components/ui/spinner';
import type { Pokemon } from '../data/pokemon';
import { PokemonItem } from './pokemon-item';

/** What the list shows when it has no rows (ListEmpty in the original). */
export type ListEmptyState = 'loading' | 'error' | { readonly message: string };

/**
 * A row's height, 98px, and the 8px under it. Every row is the same height,
 * so the list knows how long it is before it has built the rows.
 */
const ROW_HEIGHT = 106;

/**
 * The list of Pokémon both tabs show (PokemonList in the original, a
 * FlatList): a header, the rows, and a spinner at the end while the next page
 * loads.
 *
 * It's Lynx's native `<list>`, which draws only the rows near the screen, as
 * FlatList does, with `*lynxListFor`, which builds a row's view only when the
 * list asks for it and reuses the views of rows scrolled away.
 */
@Component({
  selector: 'app-pokemon-list',
  imports: [LYNX_ELEMENTS, PokemonItem, UiSpinner],
  host: { class: 'list-host' },
  template: `
    <list
      #list
      class="list"
      list-type="single"
      scroll-orientation="vertical"
      [attr.lower-threshold-item-count]="threshold()"
      (bindscrolltolower)="endReached.emit()"
      (bindlayoutchange)="measure($event.detail.height)"
    >
      <list-item item-key="header" class="header-item">
        <text class="header">{{ headerText() }}</text>
      </list-item>
      @if (empty(); as empty) {
        <list-item item-key="empty" class="empty-item" [style.height.px]="emptyHeight()">
          @if (empty === 'loading') {
            <ui-spinner size="lg" color="#999999" />
          } @else if (empty === 'error') {
            <text class="empty-text">Failed to load</text>
          } @else {
            <text class="empty-text">{{ empty.message }}</text>
          }
        </list-item>
      }
      <list-item
        class="row-item"
        *lynxListFor="
          let pokemon of data();
          trackBy: byId;
          itemAttributes: rowLayout;
          let i = index
        "
      >
        <app-pokemon-item [pokemon]="pokemon" [index]="i" />
      </list-item>
      <!-- The list's bottom padding, with the spinner while the next page
           loads (FlatList's ListFooterComponent). -->
      <list-item item-key="footer" class="footer-item">
        @if (fetchingNextPage()) {
          <ui-spinner size="sm" color="#999999" class="footer-spinner" />
        }
      </list-item>
    </list>
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
    }
    .list {
      flex: 1;
      width: 100%;
    }
    /* The original pads the list's content by 16px. Lynx's list-items fill
       the list's width, so each item pads itself instead. */
    .header-item {
      padding: 16px 16px 8px 16px;
    }
    .header {
      font-size: 16px;
      font-weight: bold;
      color: #000;
    }
    .row-item {
      padding: 0 16px 8px 16px;
    }
    .empty-item {
      display: flex;
      justify-content: center;
      align-items: center;
      padding-top: 64px;
    }
    .empty-text {
      font-size: 14px;
      color: #9e9e9e;
    }
    /* With the last row's 8px, the original's 16px padding under the
       last card's margin. */
    .footer-item {
      display: flex;
      align-items: center;
      padding-bottom: 16px;
    }
    .footer-spinner {
      margin: 16px 0;
    }
  `,
})
export class PokemonList {
  readonly data = input.required<readonly Pokemon[]>();
  readonly headerText = input.required<string>();
  /** What shows while there are no rows. */
  readonly emptyState = input.required<ListEmptyState>();
  readonly fetchingNextPage = input(false);
  /** Whether to emit `laidOut` after each layout of the list. */
  readonly watchLayout = input(false);

  /** The end of the rows came within half a screen (onEndReached). */
  readonly endReached = output<void>();
  /** The list has laid out what it shows (Lynx's `layoutcomplete`). */
  readonly laidOut = output<void>();

  readonly #height = signal(0);
  protected readonly list = viewChild.required<ElementRef<unknown>>('list');

  constructor() {
    // Lynx's list sends `layoutcomplete` after every layout, which is every
    // few rows while it scrolls, and a template listener marks this view and
    // every view above it for check: each one would cost the app a change
    // detection of the whole list. The Pokédex needs it only until it's
    // fully drawn (ReactLynx's app doesn't listen at all), so it listens
    // through the renderer, only while the parent asks.
    const renderer = inject(Renderer2);
    effect((onCleanup) => {
      if (!this.watchLayout()) return;
      onCleanup(
        renderer.listen(this.list().nativeElement, 'bindlayoutcomplete', () => this.laidOut.emit()),
      );
    });
  }

  protected readonly empty = computed(() => (this.data().length === 0 ? this.emptyState() : null));

  /**
   * The empty state fills the list under the header, as ListEmpty's flex: 1
   * does in the original's growing content container.
   */
  protected readonly emptyHeight = computed(() => Math.max(this.#height() - 43, 0));

  /**
   * How many rows from the end the next page loads: half the list's height,
   * as the original's onEndReachedThreshold of 0.5. Lynx's list counts the
   * distance in items rather than pixels.
   */
  protected readonly threshold = computed(() =>
    Math.max(1, Math.ceil(this.#height() / 2 / ROW_HEIGHT)),
  );

  protected readonly byId = (_: number, pokemon: Pokemon) => pokemon.id;
  protected readonly rowLayout = (): LynxListItemAttributes => ({
    'estimated-main-axis-size-px': ROW_HEIGHT,
  });

  protected measure(height: number): void {
    this.#height.set(height);
  }
}
