// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { ElementRef } from '../types/lynx';
import { stackWebTextarea, TEXTAREA_STACKING_CSS } from './web-textarea';

/**
 * A web-elements `<x-textarea>`: a shadow root holding the browser's field.
 */
const xTextarea = () => {
  const host = document.createElement('x-textarea');
  host.attachShadow({ mode: 'open' }).innerHTML =
    '<form part="form"><textarea id="textarea" part="textarea"></textarea></form>';
  return host;
};

describe('stackWebTextarea', () => {
  it("lets the field inherit the element's z-index, from inside its shadow root", () => {
    const host = xTextarea();
    stackWebTextarea(host as unknown as ElementRef);

    const style = host.shadowRoot!.querySelector('style');
    expect(style?.textContent).toBe(TEXTAREA_STACKING_CSS);
    // Lynx owns the element's own attributes.
    expect(host.getAttribute('style')).toBeNull();
    expect(host.getAttribute('class')).toBeNull();
  });

  it('leaves an element without a shadow root alone', () => {
    const host = document.createElement('x-textarea');
    expect(() => stackWebTextarea(host as unknown as ElementRef)).not.toThrow();
    expect(host.childNodes).toHaveLength(0);
  });
});
