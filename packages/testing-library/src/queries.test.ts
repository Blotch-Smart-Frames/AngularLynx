/**
 * The Lynx queries in everything that binds queries: render()'s result,
 * screen, within() and getQueriesForElement(), and the queries object.
 */

import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { type Matcher, queries as domQueries } from '@testing-library/dom';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type RenderResult,
  fireEvent,
  getByAccessibilityLabel,
  getByRole,
  getQueriesForElement,
  queries,
  render,
  screen,
  waitForUpdate,
  within,
} from './index.js';

@Component({
  selector: 'test-toolbar',
  imports: [LYNX_ELEMENTS],
  template: `
    <view
      [accessibility-element]="true"
      accessibility-traits="button"
      accessibility-label="Save"
      (bindtap)="save()"
    >
      <text>Save</text>
    </view>
    <view
      [accessibility-element]="true"
      accessibility-traits="button"
      [accessibility-label]="deleteLabel()"
    ></view>
    <image accessibility-label="Logo" src="logo.png" />
    <text>Saved {{ saves() }} times</text>
  `,
})
class Toolbar {
  readonly saves = signal(0);
  readonly deleteLabel = signal('Delete');

  save(): void {
    this.saves.update((n) => n + 1);
  }
}

describe('render()', () => {
  it('finds Lynx elements by role and accessible name, as a screen reader reads them', async () => {
    const { getByRole, getByText } = await render(Toolbar);

    fireEvent.tap(getByRole('button', { name: 'Save' }));
    await waitForUpdate();

    expect(getByText('Saved 1 times')).toBeTruthy();
  });

  it('finds elements by accessibility-label, bound or not', async () => {
    const {
      getByAccessibilityLabel: getBound,
      getAllByRole,
      container,
    } = await render(Toolbar);
    expect(getBound('Logo').localName).toBe('image');
    expect(getByAccessibilityLabel(container as HTMLElement, 'Delete')).toBe(
      getAllByRole('button')[1],
    );
  });

  it('keeps the Lynx queries next to custom ones', async () => {
    const queryByTag = (container: HTMLElement, tag: string) =>
      container.querySelector<HTMLElement>(tag);
    const result = await render(Toolbar, { queries: { queryByTag } });
    expect(result.queryByTag('image')).toBe(result.getByRole('img'));
  });
});

describe('screen', () => {
  it('runs the Lynx queries on the whole document', async () => {
    await render(Toolbar);
    expect(screen.getByAccessibilityLabel('Logo').localName).toBe('image');
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(await screen.findByRole('img', { name: 'Logo' })).toBeTruthy();
  });

  it("keeps Testing Library's other queries and helpers", async () => {
    await render(Toolbar);
    expect(screen.getByText('Saved 0 times')).toBeTruthy();
    expect(typeof screen.debug).toBe('function');
    expect(typeof screen.logTestingPlaygroundURL).toBe('function');
  });
});

describe('within()', () => {
  it('runs the Lynx queries inside one element', async () => {
    const { getByRole: getRole } = await render(Toolbar);
    const save = getRole('button', { name: 'Save' });
    expect(within(save).getByText('Save')).toBeTruthy();
    expect(within(save).queryByAccessibilityLabel('Logo')).toBeNull();
    expect(within(save.parentElement!).getByRole('img')).toBeTruthy();
  });

  it('binds only the queries it is given', async () => {
    const { container } = await render(Toolbar);
    const bound = within(container as HTMLElement, {
      getByRole: queries.getByRole,
    });
    expect(Object.keys(bound)).toEqual(['getByRole']);
    expect(bound.getByRole('img')).toBeTruthy();
  });

  it('is also getQueriesForElement()', () => {
    expect(getQueriesForElement).toBe(within);
  });
});

describe('queries', () => {
  it("is Testing Library's, with the Lynx role queries and the accessibility-label queries", () => {
    expect(queries.getByText).toBe(domQueries.getByText);
    expect(queries.getByRole).toBe(getByRole);
    expect(queries.getByRole).not.toBe(domQueries.getByRole);
    expect(queries.getByAccessibilityLabel).toBe(getByAccessibilityLabel);
  });
});

describe('types', () => {
  it('types the accessibility-label queries everywhere they are bound', () => {
    expectTypeOf(
      screen.getByAccessibilityLabel<HTMLInputElement>,
    ).returns.toEqualTypeOf<HTMLInputElement>();
    expectTypeOf(screen.findAllByAccessibilityLabel)
      .parameter(0)
      .toEqualTypeOf<Matcher>();
    expectTypeOf<RenderResult>().toHaveProperty('getByAccessibilityLabel');
    expectTypeOf<RenderResult>().toHaveProperty('findByRole');
    expectTypeOf(
      within(document.body).getAllByAccessibilityLabel,
    ).returns.toEqualTypeOf<HTMLElement[]>();
  });
});
