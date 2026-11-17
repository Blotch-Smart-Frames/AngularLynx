import { useGlobalProps } from '@lynx-js/react';
import type { ReactNode } from '@lynx-js/react';

import type { Pokemon } from '../lib/types/pokemon';
import { ActivityIndicator } from './ActivityIndicator';
import PokemonItem from './PokemonItem';

// A row's height: the card (16 + 64 + 16 of content and padding, and a 1px
// border each side) and the 8 below it.
const ROW_HEIGHT = 106;
// React Navigation's tab bar on an iPhone, without the bottom inset.
const TAB_BAR_HEIGHT = 49;

interface PokemonListProps {
  data: Pokemon[] | undefined;
  headerText: string;
  ListEmptyComponent: ReactNode;
  onEndReached?: () => void;
  isFetchingNextPage?: boolean;
}

/**
 * FlatList becomes Lynx's `<list>`, its virtualized list: native lays out and
 * recycles the rows, and asks the main thread for each one as it comes into
 * view.
 *
 * FlatList's `onEndReachedThreshold={0.5}` asks for the next page when the
 * end is within half the list's visible length. `<list>` counts in rows
 * (`lower-threshold-item-count`), and every row is the same height, so half
 * the list's height in rows says the same.
 *
 * FlatList shows `ListEmptyComponent` in place of rows, under the header,
 * growing to fill the list. A list item takes its content's height, so the
 * empty state is drawn as a plain view with the same padding and header
 * instead.
 */
export default function PokemonList({
  data,
  headerText,
  ListEmptyComponent,
  onEndReached,
  isFetchingNextPage,
}: PokemonListProps) {
  const globalProps = useGlobalProps();
  const header = <text className="list-header">{headerText}</text>;

  if (!data || data.length === 0) {
    return (
      <view className="list-empty-frame">
        {header}
        {ListEmptyComponent}
      </view>
    );
  }

  const screenHeight = SystemInfo.pixelHeight / SystemInfo.pixelRatio;
  const listHeight =
    screenHeight -
    (globalProps.safeAreaTop ?? 0) -
    TAB_BAR_HEIGHT -
    (globalProps.safeAreaBottom ?? 0);
  const threshold = Math.ceil(listHeight / 2 / ROW_HEIGHT);

  return (
    <list
      className="list"
      list-type="single"
      span-count={1}
      scroll-orientation="vertical"
      lower-threshold-item-count={threshold}
      bindscrolltolower={onEndReached}
    >
      <list-item item-key="header" key="header" className="list-pad-x list-pad-top">
        {header}
      </list-item>
      {data.map((item, index) => (
        <list-item
          item-key={item.id}
          key={item.id}
          className={`list-pad-x${!isFetchingNextPage && index === data.length - 1 ? ' list-pad-bottom' : ''}`}
        >
          <PokemonItem pokemon={item} index={index} />
        </list-item>
      ))}
      {isFetchingNextPage && (
        <list-item item-key="footer" key="footer" className="list-pad-x list-pad-bottom">
          <view className="list-footer">
            <ActivityIndicator />
          </view>
        </list-item>
      )}
    </list>
  );
}
