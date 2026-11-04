import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LYNX_ELEMENT_TAGS, tagClassFor, tagClassOf } from './element-tags';

describe('LYNX_ELEMENT_TAGS', () => {
  // A tag createElement() makes its own element for, but missing here, would
  // get a tag class, and the build plugin would rewrite its type selectors to
  // that class: harmless. One listed here that falls back to a view would
  // keep a type selector that matches nothing.
  it('lists exactly the tags createElement() makes their own element for', () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, 'create-native-ref.ts'),
      'utf-8',
    );
    const cases = [...source.matchAll(/case '([^']+)':/g)].map(
      ([, tag]) => tag,
    );
    // `list` and `page` are created by LynxDocument itself.
    expect([...LYNX_ELEMENT_TAGS].sort()).toEqual(
      [...cases, 'list', 'page'].sort(),
    );
  });
});

describe('tagClassFor', () => {
  it('gives a tag Lynx has no element for its tag class', () => {
    expect(tagClassFor('app-card')).toBe('_ngtag-app-card');
    expect(tagClassFor('div')).toBe('_ngtag-div');
  });

  it('gives a Lynx element none', () => {
    expect(tagClassFor('view')).toBeNull();
    expect(tagClassFor('scroll-view')).toBeNull();
  });
});

describe('tagClassOf', () => {
  it('lowercases the tag', () => {
    expect(tagClassOf('App-Card')).toBe('_ngtag-app-card');
  });
});
