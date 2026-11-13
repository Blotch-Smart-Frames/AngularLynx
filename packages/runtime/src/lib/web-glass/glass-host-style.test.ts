// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  applyHostStyle,
  FALLBACK_EDGES,
  fallbackGlassCss,
  glassEdges,
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
  press: 0,
  dark: false,
  luminance: 1,
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
  it('frosts the light regular material half way to white', () => {
    const css = fallbackGlassCss(host());
    expect(css).toContain('blur(12px) saturate(190%)');
    expect(css).toContain('background-color:rgba(250, 250, 250, 0.53)');
  });

  it('pulls the dark regular material toward a dark gray', () => {
    const css = fallbackGlassCss(host(), true);
    expect(css).toContain('blur(12px) saturate(140%)');
    expect(css).toContain('background-color:rgba(52, 52, 52, 0.4)');
  });

  it('barely changes what’s behind clear glass, in either material', () => {
    for (const dark of [false, true]) {
      const css = fallbackGlassCss(host({ 'glass-style': 'clear' }), dark);
      expect(css).toContain('blur(4px) saturate(112%)');
      expect(css).toContain('rgba(255, 255, 255, 0.1)');
    }
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
  it('lights the rim along the top and the bottom', () => {
    expect(FALLBACK_EDGES).toBe(
      'inset 0 0.67px 0 rgba(255, 255, 255, 0.35), ' +
        'inset 0 -0.67px 0 rgba(255, 255, 255, 0.35)',
    );
  });
});

describe('glassEdges', () => {
  it('draws a dark line down the sides, as crescents', () => {
    // The shape moved sideways by twice the line's width and shrunk by it.
    expect(glassEdges(host({ 'glass-style': 'clear' }), false, 1)).toBe(
      '1.33px 0 0 -0.67px rgba(0, 0, 0, 0.23), ' +
        '-1.33px 0 0 -0.67px rgba(0, 0, 0, 0.23)',
    );
  });

  it('darkens the lines over a dark backdrop', () => {
    expect(glassEdges(host({ 'glass-style': 'clear' }), false, 0.5)).toContain(
      'rgba(0, 0, 0, 0.45)',
    );
  });

  it('adds a fainter line along the top and the bottom of the light regular material', () => {
    expect(glassEdges(host(), false, 1)).toBe(
      '1.33px 0 0 -0.67px rgba(0, 0, 0, 0.23), ' +
        '-1.33px 0 0 -0.67px rgba(0, 0, 0, 0.23), ' +
        '0 1.33px 0 -0.67px rgba(0, 0, 0, 0.075), ' +
        '0 -1.33px 0 -0.67px rgba(0, 0, 0, 0.075)',
    );
    // The dark material has the side lines alone.
    expect(glassEdges(host(), true, 1)).toBe(
      glassEdges(host({ 'glass-style': 'clear' }), false, 1),
    );
  });

  it('fills the band around tinted glass with the tint', () => {
    expect(glassEdges(host({ 'glass-tint-color': '#2563eb' }), false, 1)).toBe(
      '1.33px 0 0 -0.67px rgba(0, 0, 0, 0.23), ' +
        '-1.33px 0 0 -0.67px rgba(0, 0, 0, 0.23), ' +
        '0 0 0 0.67px color-mix(in srgb, #2563eb 80%, transparent)',
    );
  });
});

describe('glassShadow', () => {
  /**
   * A glass element laid out `width` by `height` CSS pixels.
   */
  const sized = (
    width: number,
    height: number,
    attributes: Record<string, string> = {},
  ) => {
    const element = host(attributes);
    Object.defineProperties(element, {
      offsetWidth: { value: width },
      offsetHeight: { value: height },
    });
    return element;
  };

  it('casts a barely visible shadow under a control', () => {
    expect(glassShadow(sized(44, 44))).toBe('0 7px 6px rgba(0, 0, 0, 0.013)');
    // A capsule's height decides it, not its length.
    expect(glassShadow(sized(300, 44))).toBe(glassShadow(sized(44, 44)));
    expect(glassShadow(sized(60, 60))).toBe(glassShadow(sized(44, 44)));
  });

  it('casts a wide, soft one under a menu or an action sheet', () => {
    expect(glassShadow(sized(250, 160))).toBe(
      '0 10px 34px rgba(0, 0, 0, 0.105)',
    );
    expect(glassShadow(sized(400, 600))).toBe(glassShadow(sized(250, 160)));
  });

  it('grows between the two in tenths', () => {
    expect(glassShadow(sized(105, 105))).toBe(
      '0 8.5px 20px rgba(0, 0, 0, 0.059)',
    );
    expect(glassShadow(sized(107, 107))).toBe(glassShadow(sized(105, 105)));
  });

  it('is half as strong again under a panel of the dark material', () => {
    expect(glassShadow(sized(250, 160), true)).toBe(
      '0 10px 34px rgba(0, 0, 0, 0.152)',
    );
    // A control's is the same in both.
    expect(glassShadow(sized(44, 44), true)).toBe(glassShadow(sized(44, 44)));
  });

  it('gives clear glass none', () => {
    expect(glassShadow(sized(250, 160, { 'glass-style': 'clear' }))).toBe('');
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
      'saturate(190%)',
    );
    // The fallback follows the material the glass would draw.
    expect(
      hostStyleCss(host(), { ...NONE, fallback: true, dark: true }),
    ).toContain('saturate(140%)');
  });

  it('puts the edge lines, the shadow and the fallback’s rim in one box-shadow', () => {
    const edges = glassEdges(host(), false, 1);
    const shadow = glassShadow(host());
    // Listed first, the lines are drawn over the shadow.
    expect(hostStyleCss(host(), { ...NONE, shadow: true })).toBe(
      `:host{box-shadow:${edges}, ${shadow}}`,
    );
    expect(hostStyleCss(host(), { ...NONE, fallback: true })).toContain(
      `:host{box-shadow:${FALLBACK_EDGES}}`,
    );
    expect(
      hostStyleCss(host(), { ...NONE, fallback: true, shadow: true }),
    ).toContain(`:host{box-shadow:${edges}, ${shadow}, ${FALLBACK_EDGES}}`);
  });

  it('draws the lines for the material and the backdrop it’s given', () => {
    expect(
      hostStyleCss(host(), {
        ...NONE,
        shadow: true,
        dark: true,
        luminance: 0.2,
      }),
    ).toBe(
      `:host{box-shadow:${glassEdges(host(), true, 0.2)}, ${glassShadow(host(), true)}}`,
    );
    // Clear glass has the lines and no shadow.
    const clear = host({ 'glass-style': 'clear' });
    expect(hostStyleCss(clear, { ...NONE, shadow: true })).toBe(
      `:host{box-shadow:${glassEdges(clear, false, 1)}}`,
    );
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

  it('washes a pressed shape out, over its content', () => {
    const wash = (opacity: string) =>
      ':host::after{content:"";position:absolute;inset:0;' +
      'border-radius:inherit;pointer-events:none;background:#fff;' +
      `opacity:${opacity}}`;
    expect(hostStyleCss(host(), { ...NONE, press: 1 })).toBe(wash('0.4'));
    expect(hostStyleCss(host(), { ...NONE, press: 0.5 })).toBe(wash('0.2'));
    // Fainter over the dark material.
    expect(hostStyleCss(host(), { ...NONE, press: 1, dark: true })).toBe(
      wash('0.25'),
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
