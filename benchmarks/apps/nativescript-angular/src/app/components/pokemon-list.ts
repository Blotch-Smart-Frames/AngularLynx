import { Component, NO_ERRORS_SCHEMA, computed, input, output } from '@angular/core';
import { NativeScriptCommonModule } from '@nativescript/angular';
import { Screen, type ItemEventData } from '@nativescript/core';
import type { Pokemon } from '../data/pokemon';
import { PokemonItem } from './pokemon-item';

type Row =
  | { readonly kind: 'header'; readonly text: string }
  | { readonly kind: 'pokemon'; readonly pokemon: Pokemon; readonly index: number }
  | { readonly kind: 'footer' };

/** A row is 106pt: the 98pt card and its 8pt margin. */
const ROW_HEIGHT = 106;

/**
 * The reference's PokemonList (a FlatList) on NativeScript's ListView, a UITableView that builds
 * only the rows on screen and reuses the ones scrolled away, with an Angular view in each.
 *
 * ListView has no header or footer of its own, so the header text and the spinner are rows of
 * their own templates, chosen by `templateOf`. Each row pads itself to the reference's 16pt
 * around the content, since a table row fills the list's width.
 */
@Component({
  selector: 'app-pokemon-list',
  imports: [NativeScriptCommonModule, PokemonItem],
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <ListView
      class="list"
      separatorColor="transparent"
      [items]="rows()"
      [itemTemplateSelector]="templateOf"
      (itemLoading)="onItemLoading($event)"
    >
      <ng-template nsTemplateKey="header" let-row="item">
        <Label class="header" [text]="row.text"></Label>
      </ng-template>
      <ng-template nsTemplateKey="pokemon" let-row="item">
        <app-pokemon-item [pokemon]="row.pokemon" [index]="row.index" />
      </ng-template>
      <ng-template nsTemplateKey="footer">
        <GridLayout [class]="data().length === 0 ? 'empty' : 'footer'">
          @if (data().length === 0 && !loading()) {
            <Label class="empty-text" [text]="error() ? 'Failed to load' : emptyMessage()"></Label>
          } @else {
            <ActivityIndicator [busy]="true"></ActivityIndicator>
          }
        </GridLayout>
      </ng-template>
    </ListView>
  `,
  styles: `
    .list {
      background-color: #f7f7f7;
    }
    /* FlatList's 16pt content padding around its header, and the header's own 8pt below it. */
    .header {
      margin: 16 16 8 16;
      font-size: 16;
      font-weight: bold;
      color: #000000;
    }
    .empty {
      padding-top: 64;
    }
    .empty-text {
      color: #9e9e9e;
      horizontal-align: center;
    }
    .footer {
      padding-bottom: 16;
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

  protected readonly rows = computed<Row[]>(() => {
    const rows: Row[] = [{ kind: 'header', text: this.headerText() }];
    this.data().forEach((pokemon, index) => rows.push({ kind: 'pokemon', pokemon, index }));
    if (this.data().length === 0 || this.fetchingNextPage()) rows.push({ kind: 'footer' });
    return rows;
  });

  /**
   * The reference loads the next page when the end comes within half a screen
   * (`onEndReachedThreshold` 0.5). ListView says only when its last row loads, so this counts
   * rows: half the screen's height in rows of 106pt.
   */
  readonly #threshold = Math.ceil(Screen.mainScreen.heightDIPs / 2 / ROW_HEIGHT);

  protected readonly templateOf = (row: Row) => row.kind;

  protected onItemLoading(event: Event): void {
    const { index } = event as unknown as ItemEventData;
    const rows = this.rows();
    if (this.data().length > 0 && index >= rows.length - this.#threshold) {
      this.endReached.emit();
    }
  }
}
