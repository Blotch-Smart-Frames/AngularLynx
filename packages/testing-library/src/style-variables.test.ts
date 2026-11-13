/**
 * CSS variables bound in a template, `[style.--x]`, compiled by Angular's
 * own compiler: it writes the variable's name with a placeholder for the
 * app's CSS variable namespace (`--%NS%x`), which the renderer has to fill
 * before the name reaches the element. A test that calls the renderer with
 * `--x` itself never sees the placeholder.
 */

import { Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { render, waitForUpdate } from './index.js';

@Component({
  selector: 'themed-card',
  imports: [LYNX_ELEMENTS],
  host: { '[style.--card-edge]': 'edge()' },
  template: `
    <view class="card" style="width: 10px" [style.--accent]="accent()">
      <view class="swatch" style="background-color: var(--accent, blue)"></view>
    </view>
    <view class="palette" [style]="palette()"></view>
  `,
})
class ThemedCard {
  readonly accent = signal<string | null>('red');
  readonly edge = signal('2px');
  readonly palette = signal<Record<string, string>>({ '--tone': 'teal' });
}

describe('CSS variables bound with [style.--x]', () => {
  it('sets the variable under the name the template gives it', async () => {
    const { container } = await render(ThemedCard);
    const card = container.querySelector('.card') as HTMLElement;

    expect(card.style.getPropertyValue('--accent')).toBe('red');
    // The placeholder never reaches the element.
    expect(card.getAttribute('style')).not.toContain('%NS%');
    // The style attribute it's written after is kept.
    expect(card.style.getPropertyValue('width')).toBe('10px');
  });

  it('follows the binding as it changes, and goes when it is null', async () => {
    const { container, componentRef } = await render(ThemedCard);
    const card = container.querySelector('.card') as HTMLElement;

    componentRef.instance.accent.set('green');
    await waitForUpdate();
    expect(card.style.getPropertyValue('--accent')).toBe('green');

    componentRef.instance.accent.set(null);
    await waitForUpdate();
    expect(card.style.getPropertyValue('--accent')).toBe('');
    expect(card.style.getPropertyValue('width')).toBe('10px');
  });

  // A [style] map's keys are the app's own strings, which the compiler never
  // sees, so they come without the placeholder.
  it('sets the variables of a [style] map', async () => {
    const { container } = await render(ThemedCard);
    const palette = container.querySelector('.palette') as HTMLElement;

    expect(palette.style.getPropertyValue('--tone')).toBe('teal');
  });

  it("sets a host binding's variable on the host", async () => {
    const { container } = await render(ThemedCard);
    const host = container.querySelector('.card')!.parentElement!;

    expect(host.style.getPropertyValue('--card-edge')).toBe('2px');
  });
});
