import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createTransformStylesheet,
  forgetComponentStyleSizes,
} from './component-styles-cache';
import type { ComponentStyleSize } from './utils/angular/budgets';

describe('createTransformStylesheet', () => {
  const basePath = '/proj';
  const containing = path.join(basePath, 'src', 'app.component.ts');
  let componentStyleSizes: Map<string, ComponentStyleSize>;
  let transformStylesheet: ReturnType<typeof createTransformStylesheet>;

  beforeEach(() => {
    componentStyleSizes = new Map();
    transformStylesheet = createTransformStylesheet({
      basePath,
      componentStyleSizes,
    });
  });

  it('returns the CSS for Angular to embed and scope', async () => {
    // Angular's compiler scopes what this returns for the component's
    // encapsulation; component-styles.ts takes it back out of the output.
    await expect(
      transformStylesheet('.a{color:red}', containing, undefined, 0, 'App'),
    ).resolves.toBe('.a{color:red}');
  });

  it('works without a size map', async () => {
    const transform = createTransformStylesheet({ basePath });

    await expect(
      transform('.a{}', containing, undefined, 0, 'App'),
    ).resolves.toBe('.a{}');
  });

  describe('componentStyleSizes', () => {
    it('records the compiled size of each stylesheet, labeled like Angular', async () => {
      await transformStylesheet(
        '.a{color:red}',
        containing,
        path.join(basePath, 'src', 'app.css'),
        0,
        'App',
      );
      // Inline styles have no file, so they're labeled with their component.
      await transformStylesheet('.é{}', containing, undefined, 1, 'App');

      expect([...componentStyleSizes.values()]).toEqual([
        { label: 'src/app.css', size: 13 },
        { label: 'src/app.component.ts', size: 5 },
      ]);
    });

    it('keeps the latest size when a stylesheet is recompiled', async () => {
      const stylesheet = path.join(basePath, 'src', 'app.css');
      await transformStylesheet('.a{}', containing, stylesheet, 0, 'App');
      await transformStylesheet(
        '.a{color:red}',
        containing,
        stylesheet,
        0,
        'App',
      );
      // A call without a class name for a stylesheet already recorded doesn't
      // replace its size.
      await transformStylesheet('', containing, stylesheet, 0, undefined);

      expect([...componentStyleSizes.values()]).toEqual([
        { label: 'src/app.css', size: 13 },
      ]);
    });

    it('records a stylesheet first seen without a class name', async () => {
      await transformStylesheet('.a{}', containing, undefined, 0, undefined);

      expect([...componentStyleSizes.values()]).toEqual([
        { label: 'src/app.component.ts', size: 4 },
      ]);
    });

    it("forgets a deleted component's stylesheets only", async () => {
      const kept = path.join(basePath, 'src', 'other.component.ts');
      await transformStylesheet('.a{}', containing, undefined, 0, 'App');
      await transformStylesheet('.b{}', containing, undefined, 1, 'App');
      await transformStylesheet('.c{}', kept, undefined, 0, 'Other');

      forgetComponentStyleSizes(componentStyleSizes, containing);

      expect([...componentStyleSizes.values()]).toEqual([
        { label: 'src/other.component.ts', size: 4 },
      ]);
    });
  });
});
