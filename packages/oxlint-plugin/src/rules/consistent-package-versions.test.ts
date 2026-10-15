import { beforeEach, describe, expect, it, vi } from 'vitest';

// The rule reads real package.json files through the shared publish list.
// Mocking readVersions lets us deterministically drive both the "versions
// match" and "versions mismatch" branches without depending on (or being
// broken by) the actual versions checked into the repo.
vi.mock('../../../release/src/packages.ts', () => ({
  readVersions: vi.fn(),
  findPackageGroupMismatches: vi.fn(() => []),
}));

const createContext = () => ({ report: vi.fn() });

const versionsOf = (...versions: string[]) =>
  versions.map((version, i) => ({ name: `pkg-${i}`, version }));

describe('consistent-package-versions', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    const { findPackageGroupMismatches } =
      await import('../../../release/src/packages.ts');
    vi.mocked(findPackageGroupMismatches).mockReturnValue([]);
  });

  it('reports nothing when every published package has the same version', async () => {
    const { readVersions } = await import('../../../release/src/packages.ts');
    vi.mocked(readVersions).mockReturnValue(versionsOf('1.2.3', '1.2.3'));
    const { default: rule } = await import('./consistent-package-versions.mjs');
    const context = createContext();
    const visitors = rule.create(context as never);

    visitors.Program();

    expect(context.report).not.toHaveBeenCalled();
    expect(readVersions).toHaveBeenCalledTimes(1);
  });

  it('memoizes the check so a second Program() in the same lint run re-reads nothing', async () => {
    const { readVersions } = await import('../../../release/src/packages.ts');
    vi.mocked(readVersions).mockReturnValue(versionsOf('1.2.3', '1.2.3'));
    const { default: rule } = await import('./consistent-package-versions.mjs');
    const context = createContext();
    const visitors = rule.create(context as never);

    visitors.Program();
    visitors.Program();

    // Only the first Program() call should have actually read the versions;
    // the second must hit the `checked` memoization guard instead.
    expect(readVersions).toHaveBeenCalledTimes(1);
    expect(context.report).not.toHaveBeenCalled();
  });

  it('reports a versionMismatch diagnostic (repeatedly, once per Program() call) when versions differ', async () => {
    const { readVersions } = await import('../../../release/src/packages.ts');
    vi.mocked(readVersions).mockReturnValue(versionsOf('1.0.0', '2.0.0'));
    const { default: rule } = await import('./consistent-package-versions.mjs');
    const context = createContext();
    const visitors = rule.create(context as never);

    visitors.Program();

    expect(context.report).toHaveBeenCalledTimes(1);
    const report = context.report.mock.calls[0][0];
    expect(report.messageId).toBe('versionMismatch');
    expect(report.loc).toEqual({ line: 1, column: 0 });
    expect(report.data.detail).toBe('pkg-0@1.0.0, pkg-1@2.0.0');

    // A second call re-reports using the memoized mismatch instead of re-reading.
    visitors.Program();
    expect(context.report).toHaveBeenCalledTimes(2);
    expect(readVersions).toHaveBeenCalledTimes(1);
  });

  it('reports packages whose ng update package group differs from the shared list', async () => {
    const { readVersions, findPackageGroupMismatches } =
      await import('../../../release/src/packages.ts');
    vi.mocked(readVersions).mockReturnValue(versionsOf('1.2.3', '1.2.3'));
    vi.mocked(findPackageGroupMismatches).mockReturnValue([
      '@blotch/angular-lynx-build',
    ]);
    const { default: rule } = await import('./consistent-package-versions.mjs');
    const context = createContext();

    rule.create(context as never).Program();

    expect(context.report).toHaveBeenCalledTimes(1);
    const report = context.report.mock.calls[0][0];
    expect(report.messageId).toBe('packageGroupMismatch');
    expect(report.data.detail).toBe('@blotch/angular-lynx-build');
  });
});
