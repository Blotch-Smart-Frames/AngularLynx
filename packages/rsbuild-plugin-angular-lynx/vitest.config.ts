import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __DEV__: false,
    __PROFILE__: false,
    __ENABLE_SSR__: false,
  },
  test: {
    include: ['src/**/*.spec.ts'],
  },
});
