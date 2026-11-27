import { describe, expect, it } from 'vitest';
import {
  resolveBackgroundTreeShaking,
  wrapsBackgroundInitializers,
} from './background-tree-shaking.js';

describe('resolveBackgroundTreeShaking', () => {
  it("is 'safe' when neither the plugin nor angular.json sets it", () => {
    expect(resolveBackgroundTreeShaking(undefined, undefined)).toBe('safe');
    expect(resolveBackgroundTreeShaking(undefined, {})).toBe('safe');
  });

  it("takes angular.json's build option", () => {
    expect(
      resolveBackgroundTreeShaking(undefined, {
        backgroundTreeShaking: 'aggressive',
      }),
    ).toBe('aggressive');
  });

  it("lets the plugin's option win", () => {
    expect(
      resolveBackgroundTreeShaking('safe', {
        backgroundTreeShaking: 'aggressive',
      }),
    ).toBe('safe');
    expect(resolveBackgroundTreeShaking('aggressive', undefined)).toBe(
      'aggressive',
    );
  });

  // A JavaScript lynx.config.ts isn't type-checked.
  it('rejects any other value', () => {
    expect(() =>
      resolveBackgroundTreeShaking('none' as never, undefined),
    ).toThrow(
      `backgroundTreeShaking must be 'safe' or 'aggressive', not "none"`,
    );
  });
});

describe('wrapsBackgroundInitializers', () => {
  const APP = '/app/src/app/main-thread-demo.ts';
  const DOLAN_COPY = '/app/src/components/ui/icon/icons.ts';
  const RUNTIME = '/app/node_modules/@blotch/angular-lynx/fesm2022/index.mjs';
  const THIRD_PARTY = '/app/node_modules/tailwind-merge/dist/bundle-mjs.mjs';

  it("wraps AngularLynx's packages whatever the mode", () => {
    expect(wrapsBackgroundInitializers(RUNTIME, 'safe')).toBe(true);
    expect(wrapsBackgroundInitializers(RUNTIME, 'aggressive')).toBe(true);
  });

  it("leaves the app's files alone by default", () => {
    expect(wrapsBackgroundInitializers(APP, 'safe')).toBe(false);
    expect(wrapsBackgroundInitializers(DOLAN_COPY, 'safe')).toBe(false);
  });

  it("wraps the app's files when aggressive", () => {
    expect(wrapsBackgroundInitializers(APP, 'aggressive')).toBe(true);
    expect(wrapsBackgroundInitializers(DOLAN_COPY, 'aggressive')).toBe(true);
  });

  // As Angular's build, which assumes it only of @angular/* packages.
  it('never wraps other packages', () => {
    expect(wrapsBackgroundInitializers(THIRD_PARTY, 'safe')).toBe(false);
    expect(wrapsBackgroundInitializers(THIRD_PARTY, 'aggressive')).toBe(false);
  });
});
