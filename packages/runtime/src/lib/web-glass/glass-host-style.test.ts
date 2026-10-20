// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  applyHostStyle,
  fallbackGlassCss,
  hostStyleCss,
  materialCss,
} from './glass-host-style';

const NONE = { fallback: false, rendered: false, hostsCanvas: false };

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
      fallback: false,
      rendered: true,
      hostsCanvas: true,
    });
    expect(css).toContain('isolation:isolate');
    expect(css).toContain('backdrop-filter:none!important');
    expect(hostStyleCss(host(), { ...NONE, fallback: true })).toContain(
      'saturate(180%)',
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
