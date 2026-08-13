import { describe, expect, it } from 'vitest';
import { stripTemplateWhitespace } from './strip-template-whitespace';

describe('stripTemplateWhitespace', () => {
  it('strips indentation whitespace from block text', () => {
    const source = `<text class="text-lg">
      The Quick Brown Fox
    </text>`;
    expect(stripTemplateWhitespace(source)).toBe(
      `<text class="text-lg">The Quick Brown Fox</text>`,
    );
  });

  it('preserves inline text adjacent to child elements', () => {
    // "Hello " and " again" are on the same line as sibling elements — no newlines
    const source = `<text>Hello <text style="color:red">world</text> again</text>`;
    expect(stripTemplateWhitespace(source)).toBe(source);
  });

  it('strips whitespace from Angular template expressions', () => {
    const source = `<text>
      {{ greeting }}
    </text>`;
    expect(stripTemplateWhitespace(source)).toBe(`<text>{{ greeting }}</text>`);
  });

  it('strips whitespace from interpolated mixed text', () => {
    const source = `<text>
      Hello {{ name }}!
    </text>`;
    expect(stripTemplateWhitespace(source)).toBe(
      `<text>Hello {{ name }}!</text>`,
    );
  });

  it('strips whitespace from multiple text nodes in sequence', () => {
    const source = `<view>
      <text class="title">
        Custom Fonts
      </text>
      <text class="subtitle">
        Load fonts via @font-face.
      </text>
    </view>`;
    expect(stripTemplateWhitespace(source)).toBe(
      `<view>
      <text class="title">Custom Fonts</text>
      <text class="subtitle">Load fonts via @font-face.</text>
    </view>`,
    );
  });

  it('does not affect text already on the same line as tags', () => {
    const source = `<text class="label">Custom Font (Roboto)</text>`;
    expect(stripTemplateWhitespace(source)).toBe(source);
  });

  it('does not affect multiline text content', () => {
    // Two lines of text inside a single element — only the single-line case is handled.
    const source = `<text>
      Line 1
      Line 2
    </text>`;
    expect(stripTemplateWhitespace(source)).toBe(source);
  });

  it('does not affect non-template TypeScript code', () => {
    const source = `const x = foo > bar ? 'a' : 'b';`;
    expect(stripTemplateWhitespace(source)).toBe(source);
  });
});
