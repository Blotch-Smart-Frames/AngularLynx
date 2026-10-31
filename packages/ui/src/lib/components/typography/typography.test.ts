import { Component } from '@angular/core';
import { render } from '@blotch/angular-lynx-testing-library';
import { LYNX_ELEMENTS } from '@blotch/angular-lynx';
import { describe, expect, it } from 'vitest';
import { UiText, typographyVariants } from './typography';

@Component({
  standalone: true,
  imports: [UiText, LYNX_ELEMENTS],
  template: `<ui-text [variant]="variant">Hello</ui-text>`,
})
class TypographyHost {
  variant:
    | 'h1'
    | 'h2'
    | 'h3'
    | 'h4'
    | 'p'
    | 'lead'
    | 'large'
    | 'small'
    | 'muted' = 'p';
}

@Component({
  imports: [UiText],
  template: `<ui-text variant="muted" class="mb-4 text-center">Note</ui-text>`,
})
class StaticClassHost {}

describe('typographyVariants', () => {
  it('returns default variant classes', () => {
    expect(typographyVariants()).toContain('text-base');
  });

  it.each([
    'h1',
    'h2',
    'h3',
    'h4',
    'p',
    'lead',
    'large',
    'small',
    'muted',
  ] as const)('returns %s variant classes', (variant) => {
    expect(typographyVariants({ variant })).toBeTruthy();
  });
});

describe('UiText', () => {
  it('renders projected content', async () => {
    const { getByText } = await render(TypographyHost);
    expect(getByText('Hello')).toBeTruthy();
  });

  it('renders with no host wrapper (uses default input value)', async () => {
    const { getByText } = await render(UiText);
    expect(getByText).toBeTruthy();
  });

  // A class on a component lands on its host too (issue #181): the text is
  // one <text>, so the class styles one element.
  it('is one text, with the class written on it', async () => {
    const { container, getByText } = await render(StaticClassHost);
    const text = getByText('Note');
    expect(text.tagName.toLowerCase()).toBe('text');
    expect(text.classList).toContain('text-muted-foreground');
    expect([...container.querySelectorAll('.mb-4')]).toEqual([text]);
  });
});
