/**
 * Rows a `@for` adds under a footer already on the screen, through the real
 * renderer: the runtime appends a cycle's rows past the first 32 and puts
 * the footer back after them at the end of the cycle (issue #913), so what
 * native holds has to come out in Angular's order.
 */

import { Component, signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { render, waitForUpdate } from './index.js';

const range = (from: number, to: number): string[] =>
  Array.from({ length: to - from }, (_, i) => `row ${from + i}`);

describe('@for under a footer on the screen (issue #913)', () => {
  it('keeps the rows of each cycle before the footer, in order', async () => {
    const items = signal(range(0, 2));

    @Component({
      selector: 'test-for-footer',
      template: `
        <view class="container">
          @for (item of items(); track item) {
            <text>{{ item }}</text>
          }
          <text class="footer">Load more</text>
        </view>
      `,
    })
    class ForFooter {
      items = items;
    }

    const { container } = await render(ForFooter);
    const texts = (): string[] =>
      [...container.querySelectorAll('.container > text')].map(
        (text) => text.textContent ?? '',
      );

    // A page of rows, past the ones the runtime inserts.
    items.set(range(0, 50));
    await waitForUpdate();
    expect(texts()).toEqual([...range(0, 50), 'Load more']);

    // Another, after the footer has moved back once.
    items.set(range(0, 100));
    await waitForUpdate();
    expect(texts()).toEqual([...range(0, 100), 'Load more']);

    // A few, which are inserted.
    items.set(range(0, 103));
    await waitForUpdate();
    expect(texts()).toEqual([...range(0, 103), 'Load more']);
  });

  it('keeps the rows before a footer that holds a field', async () => {
    const items = signal<string[]>([]);

    @Component({
      selector: 'test-for-field-footer',
      template: `
        <view class="container">
          @for (item of items(); track item) {
            <text>{{ item }}</text>
          }
          <view class="footer"><input placeholder="Message" /></view>
        </view>
      `,
    })
    class ForFieldFooter {
      items = items;
    }

    const { container } = await render(ForFieldFooter);

    items.set(range(0, 50));
    await waitForUpdate();

    const children = [...container.querySelector('.container')!.children];
    expect(
      children
        .filter((child) => child.tagName.toLowerCase() === 'text')
        .map((text) => text.textContent),
    ).toEqual(range(0, 50));
    expect(children.at(-1)!.className).toContain('footer');
  });
});
