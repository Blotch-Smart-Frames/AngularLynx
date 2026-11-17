import { Component, input, output, viewChild } from '@angular/core';
import {
  ActivityIndicator,
  Text,
  View,
  VirtualList,
  VirtualListRow,
} from '@ng-native/components';
import type { Pokemon } from '../data/pokemon.ts';
import { PokemonItem } from './pokemon-item.ts';

/**
 * The reference's PokemonList (a FlatList) on `<virtual-list>`, Angular Native's windowed list.
 *
 * Every card is the same height (16 + 64 + 16 of content, a 1pt border each side, and the 8pt
 * margin under it), so the list is given that height rather than measuring each row, as
 * FlatList's `getItemLayout` would be.
 */
@Component({
  selector: 'app-pokemon-list',
  imports: [ActivityIndicator, PokemonItem, Text, View, VirtualList, VirtualListRow],
  host: { style: 'flex: 1' },
  template: `
    <virtual-list
      #list
      class="list"
      [items]="data()"
      [itemHeight]="106"
      [keyExtractor]="keyOf"
      [contentPadding]="padding"
      [endReachedThreshold]="0.5"
      contentInsetAdjustmentBehavior="automatic"
      (endReached)="endReached.emit()"
    >
      <text listHeader class="header">{{ headerText() }}</text>
      @for (row of list.window(); track row.slot) {
        <view [virtualListRow]="row">
          <app-pokemon-item [pokemon]="row.item" [index]="row.index" />
        </view>
      }
      @if (data().length === 0) {
        <view listFooter class="empty">
          @if (loading()) {
            <activity-indicator size="large" />
          } @else {
            <text class="empty-text">{{ error() ? 'Failed to load' : emptyMessage() }}</text>
          }
        </view>
      } @else if (fetchingNextPage()) {
        <view listFooter class="footer"><activity-indicator /></view>
      }
    </virtual-list>
  `,
  styles: `
    .list {
      flex: 1;
    }
    /* FlatList's 16pt content padding around its header, and the header's own 8pt below it. */
    .header {
      margin: 16px 16px 8px 16px;
      font-size: 16px;
      font-weight: bold;
    }
    .empty {
      justify-content: center;
      align-items: center;
      padding-top: 64px;
    }
    .empty-text {
      color: #9e9e9e;
    }
    .footer {
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

  /** For the page that reports fully drawn once the rows are on screen. */
  readonly list = viewChild.required<VirtualList<Pokemon>>('list');

  protected readonly keyOf = (item: Pokemon) => item.id;
  // The header sits outside the list's padding, so the top is the header's margin alone.
  protected readonly padding = { top: 0, right: 16, bottom: 16, left: 16 };
}
