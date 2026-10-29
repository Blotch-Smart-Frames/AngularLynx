// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  applyHostStyle,
  FALLBACK_EDGES,
  fallbackGlassCss,
  glassShadow,
  hostStyleCss,
  materialCss,
} from './glass-host-style';

const NONE = {
  fallback: false,
  rendered: false,
  hostsCanvas: false,
  shadow: false,
  scale: 1,
};

const host = (attributes: Record<string, string> = {}) => {
  const element = document.createElement('x-blur-view');
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  element.attachShadow({ mode: 'open' }).innerHTML =
    '<style id="dynamic-style"></style><slot></slot>';
  return element;
};

describe('fallbackGlassCss', () => {
  it('frosts regular glass with a white wash', () => {
    const css = fallbackGlassCss(host());
    expect(css).toContain('blur(12px) saturate(180%)');
    expect(css).toContain('background-color:rgba(255, 255, 255, 0.18)');
  });

  it('keeps clear glass lighter', () => {
    const css = fallbackGlassCss(host({ 'glass-style': 'clear' }));
    expect(css).toContain('blur(4px) saturate(140%)');
    expect(css).toContain('rgba(255, 255, 255, 0.04)');
  });

  it('honors blur-radius and the tint', () => {
    const css = fallbackGlassCss(
      host({ 'blur-radius': '20px', 'glass-tint-color': 'blue' }),
    );
    expect(css).toContain('blur(20px)');
    expect(css).toContain('background-color:blue');
  });
});

describe('FALLBACK_EDGES', () => {
  it('outlines the glass with a gray hairline, and a bright rim inside it', () => {
    expect(FALLBACK_EDGES).toMatch(/^inset 0 0 0 1px rgba\(0, 0, 0, 0\.08\)/);
    expect(FALLBACK_EDGES).toContain('inset 0 2px 0 rgba(255, 255, 255, 0.5)');
  });
});

describe('glassShadow', () => {
  /**
   * A glass element laid out `width` by `height` CSS pixels.
   */
  const sized = (width: number, height: number) => {
    const element = host();
    Object.defineProperties(element, {
      offsetWidth: { value: width },
      offsetHeight: { value: height },
    });
    return element;
  };

  it('casts a faint shadow under a bar button', () => {
    expect(glassShadow(sized(44, 44))).toBe('0 2px 10px rgba(0, 0, 0, 0.06)');
    // A capsule's height decides it, not its length.
    expect(glassShadow(sized(300, 44))).toBe(glassShadow(sized(44, 44)));
  });

  it('casts a wide, soft one under a menu or an action sheet', () => {
    expect(glassShadow(sized(250, 160))).toBe(
      '0 8px 32px rgba(0, 0, 0, 0.08), 0 1px 4px rgba(0, 0, 0, 0.04)',
    );
    expect(glassShadow(sized(400, 600))).toBe(glassShadow(sized(250, 160)));
  });

  it('grows between the two in tenths', () => {
    expect(glassShadow(sized(102, 102))).toBe(
      '0 5px 21px rgba(0, 0, 0, 0.07), 0 1px 4px rgba(0, 0, 0, 0.02)',
    );
    expect(glassShadow(sized(104, 104))).toBe(glassShadow(sized(102, 102)));
  });
});

describe('materialCss', () => {
  it('brightens the backdrop for light, the default', () => {
    expect(materialCss(host({ 'blur-radius': '16px' }))).toBe(
      ':host{backdrop-filter:blur(16px) brightness(1.35);' +
        '-webkit-backdrop-filter:blur(16px) brightness(1.35)}',
    );
  });

  it('washes extra-light with white and dark with black', () => {
    expect(
      materialCss(host({ 'blur-radius': '8px', 'blur-effect': 'extra-light' })),
    ).toBe(':host{background-color:rgba(255, 255, 255, 0.75)}');
    expect(
      materialCss(host({ 'blur-radius': '8px', 'blur-effect': 'dark' })),
    ).toBe(':host{background-color:rgba(0, 0, 0, 0.6)}');
  });

  it('leaves glass, and views with no blur, alone', () => {
    expect(materialCss(host())).toBe('');
    expect(materialCss(host({ 'blur-radius': '0px' }))).toBe('');
    for (const effect of ['glass', 'glass-container']) {
      expect(
        materialCss(host({ 'blur-radius': '16px', 'blur-effect': effect })),
      ).toBe('');
    }
  });
});

describe('hostStyleCss', () => {
  it('is empty when nothing applies', () => {
    expect(hostStyleCss(host(), NONE)).toBe('');
  });

  it('combines the rules that apply', () => {
    const css = hostStyleCss(host(), {
      ...NONE,
      rendered: true,
      hostsCanvas: true,
    });
    expect(css).toContain('isolation:isolate');
    expect(css).toContain('backdrop-filter:none!important');
    expect(hostStyleCss(host(), { ...NONE, fallback: true })).toContain(
      'saturate(180%)',
    );
  });

  it('puts the shadow and the fallback’s rims in one box-shadow', () => {
    const shadow = glassShadow(host());
    expect(hostStyleCss(host(), { ...NONE, shadow: true })).toBe(
      `:host{box-shadow:${shadow}}`,
    );
    expect(hostStyleCss(host(), { ...NONE, fallback: true })).toContain(
      `:host{box-shadow:${FALLBACK_EDGES}}`,
    );
    expect(
      hostStyleCss(host(), { ...NONE, fallback: true, shadow: true }),
    ).toContain(`:host{box-shadow:${shadow}, ${FALLBACK_EDGES}}`);
  });

  it('lets a container’s canvas and shadows reach past its box', () => {
    expect(hostStyleCss(host({ 'blur-effect': 'glass-container' }), NONE)).toBe(
      ':host{overflow:visible!important}',
    );
    expect(hostStyleCss(host({ 'blur-effect': 'glass' }), NONE)).toBe('');
  });

  it('swells a pressed shape with the scale property', () => {
    expect(hostStyleCss(host(), { ...NONE, scale: 1.0123456 })).toBe(
      ':host{scale:1.012}',
    );
  });
});

describe('applyHostStyle', () => {
  it('does nothing without a shadow root', () => {
    const element = document.createElement('x-blur-view');
    applyHostStyle(element, { ...NONE, rendered: true });
    expect(element.childNodes).toHaveLength(0);
  });

  it('adds no style element until there is something to apply', () => {
    const element = host();
    applyHostStyle(element, NONE);
    expect(element.shadowRoot!.querySelectorAll('style')).toHaveLength(1);
  });

  it('appends one style after web-elements’ own and keeps it current', () => {
    const element = host();
    const root = element.shadowRoot!;
    applyHostStyle(element, { ...NONE, rendered: true });
    const style = root.lastElementChild as HTMLStyleElement;
    expect(style.textContent).toContain('backdrop-filter:none');

    applyHostStyle(element, { ...NONE, rendered: true });
    expect(root.querySelectorAll('style')).toHaveLength(2);

    applyHostStyle(element, NONE);
    expect(style.textContent).toBe('');

    // Put back if something removed it.
    style.remove();
    applyHostStyle(element, { ...NONE, hostsCanvas: true });
    expect(root.lastElementChild).toBe(style);
    expect(style.textContent).toBe(':host{isolation:isolate}');
  });
});
