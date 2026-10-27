/**
 * The Lynx-aware *ByRole queries: roles from accessibility-traits, what a
 * screen reader can reach, names from accessibility-label, the states Lynx
 * has, Testing Library's own roles alongside, and the error messages.
 */

import { stripVTControlCharacters } from 'node:util';
import { configure, getConfig } from '@testing-library/dom';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { el, mount } from '../test-utils/elements.js';
import {
  findAllByRole,
  findByRole,
  getAllByRole,
  getByRole,
  queryAllByRole,
  queryByRole,
} from './role-queries.js';

/**
 * A view a screen reader reaches as one element, as the guides write a
 * button.
 */
const accessible = (
  traits: string,
  label?: string,
  ...children: (Node | string)[]
): HTMLElement =>
  el(
    'view',
    {
      'accessibility-element': 'true',
      'accessibility-traits': traits,
      ...(label === undefined ? {} : { 'accessibility-label': label }),
    },
    ...children,
  );

/**
 * The element's accessibility-label, to compare lists of elements by.
 */
const nameOf = (element: HTMLElement): string | null =>
  element.getAttribute('accessibility-label');

afterEach(() => {
  document.body.replaceChildren();
});

describe('roles from accessibility-traits', () => {
  it.each([
    ['button', 'button'],
    ['link', 'link'],
    ['image', 'img'],
    ['header', 'heading'],
    ['search', 'searchbox'],
    ['adjustable', 'slider'],
    ['tabbar', 'tablist'],
  ])('reads the %s trait as the %s role', (trait, role) => {
    const element = accessible(trait);
    const container = mount(element);
    expect(getByRole(container, role)).toBe(element);
  });

  it.each(['text', 'selected', 'disabled', 'playable', 'summary', 'none'])(
    'gives the %s trait no role',
    (trait) => {
      const container = mount(accessible(trait));
      expect(queryAllByRole(container, 'button')).toEqual([]);
      expect(queryAllByRole(container, trait)).toEqual([]);
    },
  );

  it('reads every trait in a comma-separated list, as iOS does', () => {
    const element = accessible('header,link');
    const container = mount(element);
    expect(getByRole(container, 'heading')).toBe(element);
    expect(getByRole(container, 'link')).toBe(element);
  });

  it('gives an <image> the img role by default, as Lynx does', () => {
    const image = el('image', { 'accessibility-label': 'Avatar' });
    const container = mount(image);
    expect(getByRole(container, 'img', { name: 'Avatar' })).toBe(image);
  });

  it("replaces an <image>'s default with the traits it sets", () => {
    const container = mount(
      el('image', { 'accessibility-traits': 'none' }),
      el('image', { 'accessibility-traits': 'button' }),
    );
    expect(queryAllByRole(container, 'img')).toEqual([]);
    expect(getAllByRole(container, 'button')).toHaveLength(1);
  });

  it('gives a <view> or <text> without traits no role', () => {
    const container = mount(el('view', { 'accessibility-element': 'true' }));
    container.append(el('text', {}, 'Hello'));
    expect(queryAllByRole(container, 'generic')).toEqual([]);
    expect(queryAllByRole(container, 'paragraph')).toEqual([]);
  });

  it('leaves out the container itself', () => {
    const container = accessible('button');
    document.body.append(container);
    expect(queryAllByRole(container, 'button')).toEqual([]);
  });
});

describe('what a screen reader reaches', () => {
  it('leaves out a <view> that is not an accessibility element', () => {
    const container = mount(el('view', { 'accessibility-traits': 'button' }));
    expect(queryByRole(container, 'button')).toBeNull();
    expect(queryByRole(container, 'button', { hidden: true })).not.toBeNull();
  });

  it('reaches a tab bar on the container around its tabs, as VoiceOver reads it', () => {
    const bar = el(
      'view',
      { 'accessibility-traits': 'tabbar' },
      accessible('button,selected', 'Home'),
      accessible('button', 'Inbox'),
    );
    const container = mount(
      bar,
      el(
        'view',
        { 'accessibility-elements-hidden': 'true' },
        el('view', { 'accessibility-traits': 'tabbar' }),
      ),
    );
    expect(getAllByRole(container, 'tablist')).toEqual([bar]);
    expect(nameOf(getByRole(bar, 'button', { selected: true }))).toBe('Home');
  });

  it('leaves out an element whose accessibility-element is false', () => {
    const container = mount(
      el('image', { 'accessibility-element': 'false' }),
      el('view', {
        'accessibility-element': 'false',
        'accessibility-traits': 'button',
      }),
    );
    expect(queryAllByRole(container, 'img')).toEqual([]);
    expect(queryAllByRole(container, 'button')).toEqual([]);
  });

  it('reaches a <text> by default', () => {
    const heading = el('text', { 'accessibility-traits': 'header' }, 'Inbox');
    const container = mount(heading);
    expect(getByRole(container, 'heading', { name: 'Inbox' })).toBe(heading);
  });

  it('takes any accessibility-element value but "false" as true', () => {
    const element = el('view', {
      'accessibility-element': '',
      'accessibility-traits': 'button',
    });
    const container = mount(element);
    expect(getByRole(container, 'button')).toBe(element);
  });

  it('leaves out everything inside accessibility-elements-hidden', () => {
    const container = mount(
      el(
        'view',
        { 'accessibility-elements-hidden': 'true' },
        accessible('button', 'Hidden'),
      ),
      el(
        'view',
        { 'accessibility-elements-hidden': 'false' },
        accessible('button', 'Shown'),
      ),
    );
    expect(getAllByRole(container, 'button').map(nameOf)).toEqual(['Shown']);
    expect(
      getAllByRole(container, 'button', { hidden: true }).map(nameOf),
    ).toEqual(['Hidden', 'Shown']);
  });

  it('leaves out an element that is not drawn', () => {
    const button = accessible('button');
    button.style.display = 'none';
    const container = mount(button);
    expect(queryByRole(container, 'button')).toBeNull();
  });

  it("follows Testing Library's defaultHidden", () => {
    const { defaultHidden } = getConfig();
    configure({ defaultHidden: true });
    try {
      const container = mount(el('view', { 'accessibility-traits': 'link' }));
      expect(queryByRole(container, 'link')).not.toBeNull();
    } finally {
      configure({ defaultHidden });
    }
  });
});

describe('names', () => {
  it('names an element by its accessibility-label', () => {
    const container = mount(
      accessible('button', 'Previous page'),
      accessible('button', 'Next page'),
    );
    expect(nameOf(getByRole(container, 'button', { name: 'Next page' }))).toBe(
      'Next page',
    );
  });

  it('matches a name with a RegExp, global ones included', () => {
    const container = mount(
      accessible('button', 'Page 1'),
      accessible('button', 'Page 2'),
      accessible('button', 'Next page'),
    );
    expect(
      getAllByRole(container, 'button', { name: /^Page/g }).map(nameOf),
    ).toEqual(['Page 1', 'Page 2']);
  });

  it('matches a name with a function, given the element', () => {
    const container = mount(accessible('button', 'Save'));
    const seen: [string, Element][] = [];
    getByRole(container, 'button', {
      name: (name, element) => {
        seen.push([name, element]);
        return true;
      },
    });
    expect(seen).toEqual([['Save', container.firstElementChild]]);
  });

  it('names a <text> by its text when it has no label, as Lynx reads it', () => {
    const container = mount(
      el('text', { 'accessibility-traits': 'header' }, '  Inbox \n ', 'zero'),
      el(
        'text',
        { 'accessibility-traits': 'link', 'accessibility-label': '' },
        'Help',
      ),
    );
    expect(
      getByRole(container, 'heading', { name: 'Inbox zero' }),
    ).toBeTruthy();
    expect(getByRole(container, 'link', { name: 'Help' })).toBeTruthy();
  });

  it("doesn't name a <view> by the text inside it, which iOS skips", () => {
    const container = mount(
      accessible('button', undefined, el('text', {}, 'Save')),
    );
    expect(queryByRole(container, 'button', { name: 'Save' })).toBeNull();
    expect(getByRole(container, 'button', { name: '' })).toBeTruthy();
  });

  it('gives Lynx elements no description', () => {
    const container = mount(accessible('button', 'Save'));
    expect(getByRole(container, 'button', { description: '' })).toBeTruthy();
    expect(
      queryByRole(container, 'button', { description: 'Saves' }),
    ).toBeNull();
  });
});

describe('states', () => {
  it('reads the selected trait as selected, and its absence as not', () => {
    const container = mount(
      accessible('button,selected', 'Day'),
      accessible('button', 'Week'),
    );
    expect(nameOf(getByRole(container, 'button', { selected: true }))).toBe(
      'Day',
    );
    expect(nameOf(getByRole(container, 'button', { selected: false }))).toBe(
      'Week',
    );
  });

  it("doesn't read a trait after a space, as iOS doesn't", () => {
    const container = mount(accessible('button, selected', 'Day'));
    expect(queryByRole(container, 'button', { selected: true })).toBeNull();
  });

  it('reads accessibility-value as the value text', () => {
    const slider = el('view', {
      'accessibility-element': 'true',
      'accessibility-traits': 'adjustable',
      'accessibility-value': '40%',
    });
    const container = mount(slider, accessible('adjustable'));
    expect(getByRole(container, 'slider', { value: { text: '40%' } })).toBe(
      slider,
    );
    expect(getByRole(container, 'slider', { value: { text: /%$/ } })).toBe(
      slider,
    );
  });

  it('finds a value on any role, since Lynx reads it on any element', () => {
    const button = el('view', {
      'accessibility-element': 'true',
      'accessibility-traits': 'button',
      'accessibility-value': '3 items',
    });
    const container = mount(button);
    expect(getByRole(container, 'button', { value: { text: '3 items' } })).toBe(
      button,
    );
  });

  it.each([
    ['pressed', 'button', { pressed: false }],
    ['expanded', 'button', { expanded: true }],
    ['busy', 'button', { busy: true }],
    ['current', 'button', { current: 'page' }],
    ['value.now', 'slider', { value: { now: 1 } }],
    ['value.min', 'slider', { value: { min: 0 } }],
    ['value.max', 'slider', { value: { max: 9 } }],
  ])("doesn't match %s, which Lynx doesn't have", (_state, role, options) => {
    const container = mount(accessible('button,adjustable'));
    expect(queryByRole(container, role, options)).toBeNull();
  });

  it("doesn't match a heading level, which Lynx doesn't have", () => {
    const container = mount(accessible('header'));
    expect(queryByRole(container, 'heading', { level: 1 })).toBeNull();
  });

  it('matches not busy and not current, as Testing Library does without aria-busy or aria-current', () => {
    const container = mount(accessible('link'));
    expect(getByRole(container, 'link', { busy: false })).toBeTruthy();
    expect(getByRole(container, 'link', { current: false })).toBeTruthy();
  });
});

describe("Testing Library's roles", () => {
  it('still finds a Lynx <input> as a textbox, named by its accessibility-label', () => {
    const input = el('input', { 'accessibility-label': 'Email' });
    const container = mount(input);
    expect(getByRole(container, 'textbox', { name: 'Email' })).toBe(input);
    expect(queryByRole(container, 'textbox', { name: 'Name' })).toBeNull();
  });

  it('falls back to the ARIA name when there is no accessibility-label', () => {
    const container = mount(el('div', { role: 'button' }, 'Go'));
    expect(getByRole(container, 'button', { name: 'Go' })).toBeTruthy();
  });

  it('returns both kinds once each, in document order', () => {
    const container = mount(
      accessible('button', 'Lynx first'),
      el('div', { role: 'button' }, 'ARIA'),
      el('div', {
        role: 'button',
        'accessibility-element': 'true',
        'accessibility-traits': 'button',
        'accessibility-label': 'Both',
      }),
      accessible('button', 'Lynx last'),
    );
    expect(
      getAllByRole(container, 'button').map(
        (element) => nameOf(element) ?? element.textContent,
      ),
    ).toEqual(['Lynx first', 'ARIA', 'Both', 'Lynx last']);
  });

  it('finds Lynx elements by a state ARIA refuses on the role', () => {
    const container = mount(
      el('div', { role: 'button', 'aria-selected': 'true' }),
      accessible('button,selected', 'Day'),
    );
    expect(nameOf(getByRole(container, 'button', { selected: true }))).toBe(
      'Day',
    );
  });

  it('still throws the errors ARIA gives for other states', () => {
    const container = mount(accessible('button'));
    expect(() =>
      queryAllByRole(container, 'button', { checked: true }),
    ).toThrow('"aria-checked" is not supported on role "button".');
  });

  it("throws Testing Library's message for a container that isn't an element", () => {
    expect(() =>
      queryAllByRole(null as unknown as HTMLElement, 'button'),
    ).toThrow(/Expected container to be an Element/);
  });
});

describe('errors', () => {
  it('names the role and the name when more than one element matches', () => {
    const container = mount(
      accessible('button', 'Go'),
      accessible('button', 'Go'),
    );
    expect(() => getByRole(container, 'button', { name: 'Go' })).toThrow(
      'Found multiple elements with the role "button" and name "Go"',
    );
    expect(() => queryByRole(container, 'button')).toThrow(
      'Found multiple elements with the role "button"\n',
    );
  });

  it('lists the roles there are, with their names and markup', () => {
    const container = mount(
      accessible('button,selected', 'Cancel'),
      el('input', { 'accessibility-label': 'Email' }),
      el('div', {}, 'plain'),
      el('view', { 'accessibility-traits': 'link' }),
    );
    let message = '';
    try {
      getByRole(container, 'button', { name: 'Save' });
    } catch (error) {
      // prettyDOM colors the markup when it runs in Node.
      message = stripVTControlCharacters((error as Error).message);
    }
    expect(message).toMatch(
      /^Unable to find an accessible element with the role "button" and name "Save"\n\nHere are the accessible roles:\n\n {2}button:\n\n {2}Name "Cancel":\n/,
    );
    expect(message).toContain('accessibility-traits="button,selected"');
    expect(message).toContain('textbox:\n\n  Name "Email":');
    // Testing Library leaves the generic role out of its list, and so does
    // this one. The link isn't reachable, so it isn't listed either.
    expect(message).not.toContain('generic:');
    expect(message).not.toContain('link:');
  });

  it('describes a RegExp name and a description in backticks and quotes', () => {
    const container = mount(accessible('button', 'Cancel'));
    expect(() => getByRole(container, 'button', { name: /save/i })).toThrow(
      'with the role "button" and name `/save/i`',
    );
    expect(() =>
      getByRole(container, 'button', { description: 'Saves the draft' }),
    ).toThrow('with the role "button" and description "Saves the draft"');
  });

  it('says there are no accessible roles, and how to see hidden ones', () => {
    const container = mount(el('view'));
    expect(() => getByRole(container, 'button')).toThrow(
      'There are no accessible roles. But there might be some inaccessible roles. If you wish to access them, then set the `hidden` option to `true`.',
    );
  });

  it('lists the available roles when hidden is true', () => {
    const container = mount(el('view', { 'accessibility-traits': 'link' }));
    expect(() => getByRole(container, 'button', { hidden: true })).toThrow(
      /^Unable to find an element with the role "button"\n\nHere are the available roles:\n\n {2}link:/,
    );
    expect(() => getByRole(mount(), 'button', { hidden: true })).toThrow(
      'There are no available roles.',
    );
  });

  it('says which role a Lynx trait is, when the query used the trait', () => {
    const container = mount(el('image'));
    expect(() => getByRole(container, 'image')).toThrow(
      `Lynx's image trait is the "img" role, so query by "img".`,
    );
    expect(() => getByRole(container, 'button')).not.toThrow(/trait is the/);
  });

  it('says when elements with the role are hidden from screen readers', () => {
    const container = mount(el('view', { 'accessibility-traits': 'button' }));
    expect(() => getByRole(container, 'button')).toThrow(
      'Some elements with the role "button" are hidden from screen readers. Lynx reaches an element other than <text> and <image> only when it sets accessibility-element="true"',
    );
    expect(() => getByRole(container, 'link')).not.toThrow(/Some elements/);
  });

  it("gives find* Testing Library's short message once it times out", async () => {
    const container = mount(accessible('button', 'Cancel'));
    await expect(
      findByRole(container, 'image', { name: 'Save' }, { timeout: 20 }),
    ).rejects.toThrow(
      /^Unable to find role="image" and name "Save"\n\nLynx's image trait is the "img" role, so query by "img"\./,
    );
  });
});

describe('find*', () => {
  it('waits for an element to appear', async () => {
    const container = mount();
    setTimeout(() => container.append(accessible('button', 'Later')), 10);
    expect(nameOf(await findByRole(container, 'button'))).toBe('Later');
    expect(await findAllByRole(container, 'button')).toHaveLength(1);
  });
});

describe('types', () => {
  it("takes Testing Library's generic element type", () => {
    expectTypeOf(
      getByRole<HTMLInputElement>,
    ).returns.toEqualTypeOf<HTMLInputElement>();
    expectTypeOf(findAllByRole<HTMLInputElement>).returns.toEqualTypeOf<
      Promise<HTMLInputElement[]>
    >();
  });
});
