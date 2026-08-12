import { beforeEach, describe, expect, it, vi } from 'vitest';

// The rule reads real package.json files off disk via node:fs. Mocking node:fs lets us
// deterministically drive both the "versions match" and "versions mismatch" branches
// without depending on (or being broken by) the actual versions checked into the repo.
vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));

const createContext = () => ({ report: vi.fn() });

describe('consistent-package-versions', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  it('reports nothing when every checked package.json has the same version', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: '1.2.3' }));
    const { default: rule } = await import('./consistent-package-versions.mjs');
    const context = createContext();
    const visitors = rule.create(context as never);

    visitors.Program();

    expect(context.report).not.toHaveBeenCalled();
    expect(readFileSync).toHaveBeenCalledTimes(3);
  });

  it('memoizes the check so a second Program() in the same lint run re-reads nothing', async () => {
    const { readFileSync } = await import('node:fs');
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: '1.2.3' }));
    const { default: rule } = await import('./consistent-package-versions.mjs');
    const context = createContext();
    const visitors = rule.create(context as never);

    visitors.Program();
    visitors.Program();

    // Only the first Program() call should have actually read the filesystem; the
    // second must hit the `checked` memoization guard instead.
    expect(readFileSync).toHaveBeenCalledTimes(3);
    expect(context.report).not.toHaveBeenCalled();
  });

  it('reports a versionMismatch diagnostic (repeatedly, once per Program() call) when versions differ', async () => {
    const { readFileSync } = await import('node:fs');
    let callCount = 0;
    vi.mocked(readFileSync).mockImplementation(() => {
      callCount += 1;
      return JSON.stringify({ version: callCount === 1 ? '1.0.0' : '2.0.0' });
    });
    const { default: rule } = await import('./consistent-package-versions.mjs');
    const context = createContext();
    const visitors = rule.create(context as never);

    visitors.Program();

    expect(context.report).toHaveBeenCalledTimes(1);
    const report = context.report.mock.calls[0][0];
    expect(report.messageId).toBe('versionMismatch');
    expect(report.loc).toEqual({ line: 1, column: 0 });
    expect(report.data.detail).toContain('1.0.0');
    expect(report.data.detail).toContain('2.0.0');

    // A second call re-reports using the memoized mismatch instead of re-reading disk.
    visitors.Program();
    expect(context.report).toHaveBeenCalledTimes(2);
    expect(readFileSync).toHaveBeenCalledTimes(3);
  });
});
