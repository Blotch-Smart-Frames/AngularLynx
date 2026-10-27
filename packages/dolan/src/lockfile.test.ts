import { describe, expect, it } from 'vitest';
import { createEmptyLockfile, hashContent, themeBase } from './lockfile';
import { shippedTheme as shipped } from './test-utils';

describe('themeBase', () => {
  it('is the hash the lockfile records', () => {
    const lockfile = createEmptyLockfile();
    lockfile.theme['default.css'] = { hash: 'recorded' };

    expect(themeBase(lockfile, 'default.css', shipped('default.css'))).toBe(
      'recorded',
    );
  });

  it.each(['default.css', 'dark.css'] as const)(
    "is a release's own hash for the %s an older init copied, which the lockfile has none for",
    (file) => {
      const content = shipped(file);
      expect(themeBase(createEmptyLockfile(), file, content)).toBe(
        hashContent(content),
      );
    },
  );

  it('is null for an edited copy the lockfile has no hash for', () => {
    const edited = `${shipped('default.css')}\npage { --mine: red; }\n`;
    expect(themeBase(createEmptyLockfile(), 'default.css', edited)).toBeNull();
  });

  it('is null for a missing file the lockfile has no hash for', () => {
    expect(themeBase(createEmptyLockfile(), 'default.css', null)).toBeNull();
  });

  it("is null for a file dolan didn't ship", () => {
    expect(
      themeBase(createEmptyLockfile(), 'ocean.css', shipped('default.css')),
    ).toBeNull();
  });
});
