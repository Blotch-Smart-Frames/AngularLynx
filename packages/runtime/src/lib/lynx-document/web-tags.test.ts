import { describe, expect, it } from 'vitest';
import { LYNX_ELEMENT_TAGS } from './element-tags';
import { WEB_TAG_ELEMENTS } from './web-tags';

describe('WEB_TAG_ELEMENTS', () => {
  it('makes the tags that hold text a <text>, where Lynx draws text', () => {
    for (const tag of ['span', 'p', 'h1', 'h6', 'a', 'button', 'label']) {
      expect(WEB_TAG_ELEMENTS.get(tag)).toBe('text');
    }
  });

  it('makes the tags that hold blocks a <view>', () => {
    for (const tag of ['div', 'section', 'header', 'nav', 'ul', 'li', 'form']) {
      expect(WEB_TAG_ELEMENTS.get(tag)).toBe('view');
    }
  });

  it('makes an <img> an <image>', () => {
    expect(WEB_TAG_ELEMENTS.get('img')).toBe('image');
  });

  it('leaves a tag Lynx has its own element for, such as input, alone', () => {
    // An <input> or <canvas> is already the Lynx element of that name, with
    // that element's own attributes and events: mapping it would lose them.
    for (const tag of WEB_TAG_ELEMENTS.keys()) {
      expect(LYNX_ELEMENT_TAGS.has(tag), tag).toBe(false);
    }
  });
});
