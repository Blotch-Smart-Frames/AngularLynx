import type { Config } from 'tailwindcss';
import preset from '@lynx-js/tailwind-preset';
import { blotchPlugin } from './src/styles/tailwind-plugin';

const config: Config = {
  // Angular templates are TypeScript inline string literals — there are no .html files.
  // Tailwind v3 JIT scans file content as text and finds class="..." patterns in .ts files.
  content: ['./src/**/*.ts'],
  presets: [preset],
  plugins: [blotchPlugin],
};

export default config;
