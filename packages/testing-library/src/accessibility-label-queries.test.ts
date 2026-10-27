/**
 * The *ByAccessibilityLabel queries: Testing Library's TextMatch and
 * MatcherOptions on the accessibility-label attribute, its error messages,
 * and find* waiting.
 */

import { getDefaultNormalizer } from '@testing-library/dom';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { el, mount } from '../test-utils/elements.js';
import {
  findAllByAccessibilityLabel,
  findByAccessibilityLabel,
  getAllByAccessibilityLabel,
  getByAccessibilityLabel,
  queryAllByAccessibilityLabel,
  queryByAccessibilityLabel,
} from './accessibility-label-queries.js';

/**
 * A view labeled `label`, as a screen reader reads it.
 */
const labeled = (label: string): HTMLElement =>
  el('view', { 'accessibility-label': label });

afterEach(() => {
  document.body.replaceChildren();
});

describe('matching', () => {
  it('finds the element with the label', () => {
    const close = labeled('Close');
    const container = mount(labeled('Open'), close);
    expect(getByAccessibilityLabel(container, 'Close')).toBe(close);
  });

  it('finds any Lynx element, an <image> or a <text> included', () => {
    const image = el('image', { 'accessibility-label': 'Avatar' });
    const text = el('text', { 'accessibility-label': 'Total' }, '$4');
    const container = mount(image, text);
    expect(getByAccessibilityLabel(container, 'Avatar')).toBe(image);
    expect(getByAccessibilityLabel(container, 'Total')).toBe(text);
  });

  it('matches the whole label by default, and part of it with exact: false', () => {
    const container = mount(labeled('Page 2, current page'));
    expect(queryByAccessibilityLabel(container, 'Page 2')).toBeNull();
    expect(
      getByAccessibilityLabel(container, 'page 2', { exact: false }),
    ).toBeTruthy();
  });

  it('matches with a RegExp or a function', () => {
    const container = mount(labeled('Page 1'), labeled('Next page'));
    expect(getAllByAccessibilityLabel(container, /^Page/)).toHaveLength(1);
    expect(
      getByAccessibilityLabel(container, (label) => label.startsWith('Next')),
    ).toBeTruthy();
  });

  it('trims and collapses whitespace, unless the normalizer says otherwise', () => {
    const container = mount(labeled('  Next   page '));
    expect(getByAccessibilityLabel(container, 'Next page')).toBeTruthy();
    expect(
      queryByAccessibilityLabel(container, 'Next page', {
        normalizer: getDefaultNormalizer({ collapseWhitespace: false }),
      }),
    ).toBeNull();
  });

  it('returns every match in document order', () => {
    const first = labeled('Delete');
    const second = labeled('Delete');
    const container = mount(first, el('view', {}, second));
    expect(getAllByAccessibilityLabel(container, 'Delete')).toEqual([
      first,
      second,
    ]);
    expect(queryAllByAccessibilityLabel(container, 'Edit')).toEqual([]);
  });

  it("doesn't read an element's text as its label", () => {
    const container = mount(el('text', {}, 'Close'));
    expect(queryByAccessibilityLabel(container, 'Close')).toBeNull();
  });
});

describe('errors', () => {
  it('says which label it looked for when nothing has it', () => {
    const container = mount(labeled('Open'));
    expect(() => getByAccessibilityLabel(container, 'Close')).toThrow(
      'Unable to find an element with the accessibility-label: Close',
    );
    expect(() => getAllByAccessibilityLabel(container, 'Close')).toThrow(
      'Unable to find an element with the accessibility-label: Close',
    );
  });

  it('says so when more than one element has the label', () => {
    const container = mount(labeled('Delete'), labeled('Delete'));
    expect(() => getByAccessibilityLabel(container, 'Delete')).toThrow(
      'Found multiple elements with the accessibility-label: Delete',
    );
    expect(() => queryByAccessibilityLabel(container, 'Delete')).toThrow(
      'Found multiple elements with the accessibility-label: Delete',
    );
  });
});

describe('find*', () => {
  it('waits for the element to appear', async () => {
    const container = mount();
    const later = labeled('Saved');
    setTimeout(() => container.append(later), 10);
    expect(await findByAccessibilityLabel(container, 'Saved')).toBe(later);
    expect(await findAllByAccessibilityLabel(container, 'Saved')).toEqual([
      later,
    ]);
  });

  it('rejects when the timeout passes first', async () => {
    const container = mount();
    await expect(
      findByAccessibilityLabel(container, 'Saved', {}, { timeout: 20 }),
    ).rejects.toThrow(
      'Unable to find an element with the accessibility-label: Saved',
    );
  });
});

describe('types', () => {
  it("takes an element type, as Testing Library's queries do", () => {
    expectTypeOf(
      getByAccessibilityLabel<HTMLInputElement>,
    ).returns.toEqualTypeOf<HTMLInputElement>();
    expectTypeOf(
      queryByAccessibilityLabel<HTMLInputElement>,
    ).returns.toEqualTypeOf<HTMLInputElement | null>();
    expectTypeOf(findAllByAccessibilityLabel)
      .parameter(3)
      .toMatchTypeOf<{ timeout?: number } | undefined>();
  });
});
