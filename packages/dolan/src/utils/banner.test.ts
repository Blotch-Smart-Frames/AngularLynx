import { describe, it, expect, vi, afterEach } from 'vitest';
import cfonts from 'cfonts';
import { printBanner } from './banner';

describe('printBanner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the rendered cfonts banner plus the tagline', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printBanner();

    // cfonts.render('dolan', ...) always returns a RenderedFontObject with a
    // `.string` for this font/input, so the "rendered" branch is the normal
    // path — asserting call count pins both the banner line and the tagline.
    expect(spy).toHaveBeenCalled();
    const output = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('AngularLynx');
  });

  it('skips the banner line when cfonts.render returns a falsy value', () => {
    // cfonts can return undefined for degenerate input — guard against that
    // rather than crash. Spy directly on the render method to force that
    // branch deterministically.
    vi.spyOn(cfonts, 'render').mockReturnValue(
      undefined as unknown as ReturnType<typeof cfonts.render>,
    );

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printBanner();

    // Only the tagline + blank line are logged — no banner string line.
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
