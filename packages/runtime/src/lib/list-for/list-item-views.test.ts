// ListItemViews.setItems() on its own: whether the list has news for native
// after the directive's check. Building and reusing views is driven through
// the directive in list-for.test.ts; nothing here asks for an item, so the
// template and view container are never used.
import type { TemplateRef, ViewContainerRef } from '@angular/core';
import { describe, expect, it } from 'vitest';
import type {
  ListItemAttributes,
  ListItemRun,
} from '../lynx-element/lynx-list-element';
import type { LynxListForContext } from './list-for-context';
import { ListItemViews } from './list-item-views';

const views = () =>
  new ListItemViews<string>(
    {} as TemplateRef<LynxListForContext<string>>,
    {} as ViewContainerRef,
  );

const runOf = (
  keys: string[],
  types: string[] = keys.map(() => 'list-item'),
  attributes: Array<ListItemAttributes | undefined> = keys.map(() => undefined),
): ListItemRun => ({ keys, types, attributes });

describe('ListItemViews.setItems', () => {
  it('leaves the items to the list while a change waits for it', () => {
    const items = views();
    expect(items.setItems(['A', 'B'], runOf(['a', 'b']))).toBe(true);
    // The same keys again before the list commits them (while the first
    // render defers list updates): native hasn't heard of them yet.
    expect(items.setItems(['A!', 'B'], runOf(['a', 'b']))).toBe(true);
    items.commit();

    // A row comes and goes before the list commits it: the update its
    // coming scheduled commits the rows as they end up.
    expect(items.setItems(['A', 'B', 'C'], runOf(['a', 'b', 'c']))).toBe(true);
    expect(items.setItems(['A', 'B'], runOf(['a', 'b']))).toBe(true);
    items.commit();

    const same = runOf(['a', 'b']);
    expect(items.setItems(['A!!', 'B'], same)).toBe(false);
    // Committed already, as the list's update would have.
    expect(items.commit()).toBe(same);
  });

  it('has news for native when a key, a type or a layout attribute changed', () => {
    const items = views();
    items.setItems(['A', 'B'], runOf(['a', 'b']));
    items.commit();
    const step = (run: ListItemRun): boolean => {
      const news = items.setItems(['?'], run);
      items.commit();
      return news;
    };

    expect(step(runOf(['a', 'b', 'c']))).toBe(true);
    expect(step(runOf(['a', 'c', 'b']))).toBe(true);
    expect(step(runOf(['a', 'c', 'd']))).toBe(true);
    expect(
      step(runOf(['a', 'c', 'd'], ['list-item', 'big', 'list-item'])),
    ).toBe(true);
    const sized = (): Array<ListItemAttributes | undefined> => [
      undefined,
      { 'estimated-main-axis-size-px': 40 },
      undefined,
    ];
    expect(
      step(runOf(['a', 'c', 'd'], ['list-item', 'big', 'list-item'], sized())),
    ).toBe(true);
    // The same attributes in new objects, as itemAttributes makes them on
    // every check.
    expect(
      step(runOf(['a', 'c', 'd'], ['list-item', 'big', 'list-item'], sized())),
    ).toBe(false);
  });
});
