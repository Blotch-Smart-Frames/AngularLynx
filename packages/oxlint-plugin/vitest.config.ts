import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // The oxlint rules are authored as .mjs (oxlint loads them directly), so
      // coverage must instrument .mjs, not .ts. This only yields real numbers
      // once the rule tests drive each rule IN-PROCESS via rule.create(context);
      // the legacy execSync('npx oxlint …') black-box tests run the rules in a
      // subprocess that V8 cannot observe.
      include: ['src/**/*.mjs'],
      exclude: ['src/index.mjs'], // pure re-export barrel
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
