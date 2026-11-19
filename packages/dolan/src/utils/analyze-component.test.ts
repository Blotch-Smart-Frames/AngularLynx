import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashContent, type Lockfile } from '../lockfile';
import { createFixture, DEFAULT_CONFIG, type Fixture } from '../test-utils';
import {
  analyzeComponent,
  componentStatus,
  componentStatusJson,
} from './analyze-component';

let fixture: Fixture;

vi.mock('./resolve-paths.js', () => ({
  getComponentSourceDir: (name: string) =>
    join(fixture.uiDir, 'components', name),
  getComponentFiles: (name: string, { tests }: { tests: boolean }) =>
    readdirSync(join(fixture.uiDir, 'components', name)).filter(
      (f) => f.endsWith('.ts') && (tests || !f.endsWith('.test.ts')),
    ),
  rewriteImports: (content: string) => content.replace('@upstream', '@app'),
}));

afterEach(() => fixture?.cleanup());

const card = 'export const Card = {};';
const spec = "it('renders', () => {});";
const stale = "import { setInputSignal } from '../../../test-utils/x';";
const STALE = 'card-render.test.ts';

/**
 * A project with card as `add` copied it, plus STALE, which upstream no
 * longer ships (on disk as `staleOnDisk`, or not at all for `null`).
 */
const setup = ({
  staleOnDisk = stale,
  upstream = { 'card.ts': card, 'card.test.ts': spec },
}: {
  staleOnDisk?: string | null;
  upstream?: Record<string, string>;
} = {}) => {
  const lockfile: Lockfile = {
    version: 1,
    components: {
      card: {
        'card.ts': { hash: hashContent(card) },
        'card.test.ts': { hash: hashContent(spec) },
        [STALE]: { hash: hashContent(stale) },
      },
    },
    theme: {},
  };
  fixture = createFixture({
    config: DEFAULT_CONFIG,
    lockfile,
    components: {
      card: {
        'card.ts': card,
        'card.test.ts': spec,
        ...(staleOnDisk === null ? {} : { [STALE]: staleOnDisk }),
      },
    },
    uiSource: { card: upstream },
  });
  return {
    lockfile,
    componentsDir: join(fixture.dir, DEFAULT_CONFIG.aliases.components),
  };
};

describe('analyzeComponent', () => {
  it('analyzes the files upstream ships, then the ones it stopped shipping', () => {
    const { lockfile, componentsDir } = setup();

    expect(analyzeComponent('card', componentsDir, lockfile, true)).toEqual([
      {
        file: 'card.test.ts',
        status: 'up-to-date',
        currentContent: spec,
        newContent: spec,
      },
      {
        file: 'card.ts',
        status: 'up-to-date',
        currentContent: card,
        newContent: card,
      },
      {
        file: STALE,
        status: 'auto-update',
        currentContent: stale,
        newContent: '',
        removed: 'upstream no longer ships it',
      },
    ]);
  });

  it('calls a stale file you edited a conflict', () => {
    const { lockfile, componentsDir } = setup({
      staleOnDisk: `${stale}\n// mine\n`,
    });

    expect(
      analyzeComponent('card', componentsDir, lockfile, true).at(-1),
    ).toMatchObject({ file: STALE, status: 'conflict' });
  });

  it('calls a stale file that is gone from disk up to date', () => {
    const { lockfile, componentsDir } = setup({ staleOnDisk: null });

    expect(
      analyzeComponent('card', componentsDir, lockfile, true).at(-1),
    ).toEqual({
      file: STALE,
      status: 'up-to-date',
      currentContent: '',
      newContent: '',
      removed: 'upstream no longer ships it',
    });
  });

  it("leaves a project without the testing library's tests alone: upstream still ships them", () => {
    const { lockfile, componentsDir } = setup();

    expect(
      analyzeComponent('card', componentsDir, lockfile, false).map(
        ({ file }) => file,
      ),
    ).toEqual(['card.ts', STALE]);
  });

  it("compares against upstream's content as add would write it, imports rewritten", () => {
    const { lockfile, componentsDir } = setup({
      upstream: { 'card.ts': "import '@upstream';" },
    });

    expect(
      analyzeComponent('card', componentsDir, lockfile, true)[0],
    ).toMatchObject({ status: 'auto-update', newContent: "import '@app';" });
  });

  it('reads a component with no lockfile entry as all new or in conflict', () => {
    const { componentsDir } = setup({
      upstream: { 'card.ts': `${card}\n// v2`, 'card-extra.ts': card },
    });
    const empty: Lockfile = { version: 1, components: {}, theme: {} };

    expect(
      analyzeComponent('card', componentsDir, empty, true).map(
        ({ file, status }) => [file, status],
      ),
    ).toEqual([
      ['card-extra.ts', 'new-upstream'],
      // No base to tell who changed it.
      ['card.ts', 'conflict'],
    ]);
  });
});

describe('componentStatus', () => {
  it('counts a stale file still in the app, and calls the component outdated', () => {
    const { lockfile, componentsDir } = setup();

    const status = componentStatus('card', componentsDir, lockfile, true);

    expect(status).toMatchObject({
      name: 'card',
      status: 'auto-update',
      fileCount: 3,
    });
    expect(status.stale.map(({ file }) => file)).toEqual([STALE]);
  });

  it("doesn't count one that's gone from disk: only its lockfile entry is left", () => {
    const { lockfile, componentsDir } = setup({ staleOnDisk: null });

    expect(componentStatus('card', componentsDir, lockfile, true)).toEqual({
      name: 'card',
      status: 'up-to-date',
      fileCount: 2,
      stale: [],
    });
  });
});

describe('componentStatusJson', () => {
  it('names the stale files', () => {
    const { lockfile, componentsDir } = setup();

    expect(
      componentStatusJson(
        componentStatus('card', componentsDir, lockfile, true),
      ),
    ).toEqual({
      name: 'card',
      status: 'auto-update',
      fileCount: 3,
      removedUpstream: [STALE],
    });
  });

  it('has no such key for a component without any', () => {
    const { lockfile, componentsDir } = setup({ staleOnDisk: null });

    expect(
      componentStatusJson(
        componentStatus('card', componentsDir, lockfile, true),
      ),
    ).toEqual({ name: 'card', status: 'up-to-date', fileCount: 2 });
  });
});
