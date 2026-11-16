import { Component, signal } from '@angular/core';
import { render, waitForUpdate } from '@blotch/angular-lynx-testing-library';
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

@Component({
  imports: [UiText],
  template: `<ui-text variant="small" [maxLines]="maxLines()" [class]="extra()"
    >Title</ui-text
  >`,
})
class MaxLinesHost {
  readonly maxLines = signal<number | undefined>(2);
  readonly extra = signal('');
}

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

  it('tracks the largest headings tighter, and only those', () => {
    // Letters read further apart as they grow. iOS's system font tightens
    // them by itself; Roboto and a browser's fonts don't.
    for (const variant of ['h1', 'h2'] as const) {
      expect(typographyVariants({ variant })).toContain('tracking-tight');
    }
    for (const variant of ['h3', 'h4', 'p'] as const) {
      expect(typographyVariants({ variant })).not.toContain('tracking-tight');
    }
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

  // Lynx's text-maxline only sizes the box: without text-overflow: ellipsis,
  // Android draws the lines past the cap over what follows and iOS cuts them
  // off with no "…" (issue #437). maxLines always sets the two together.
  describe('maxLines', () => {
    const renderMaxLines = async () => {
      const result = await render(MaxLinesHost);
      return {
        host: result.componentRef.instance as MaxLinesHost,
        text: () => result.getByText('Title'),
      };
    };

    it('caps the lines and ends the last with an ellipsis', async () => {
      const { text } = await renderMaxLines();
      expect(text().getAttribute('text-maxline')).toBe('2');
      expect(text().classList).toContain('text-ellipsis');
      expect(text().classList).toContain('text-sm');
    });

    it('leaves the text uncapped, with no ellipsis, when unset', async () => {
      const { host, text } = await renderMaxLines();
      host.maxLines.set(undefined);
      await waitForUpdate();
      expect(text().hasAttribute('text-maxline')).toBe(false);
      expect(text().classList).not.toContain('text-ellipsis');
    });

    it('follows the cap as it changes', async () => {
      const { host, text } = await renderMaxLines();
      host.maxLines.set(1);
      await waitForUpdate();
      expect(text().getAttribute('text-maxline')).toBe('1');
      expect(text().classList).toContain('text-ellipsis');
    });

    it("keeps the app's classes, which can still replace the ellipsis", async () => {
      const { host, text } = await renderMaxLines();
      host.extra.set('mt-2 text-clip');
      await waitForUpdate();
      expect(text().classList).toContain('mt-2');
      expect(text().classList).toContain('text-clip');
      expect(text().classList).not.toContain('text-ellipsis');
    });
  });
});
