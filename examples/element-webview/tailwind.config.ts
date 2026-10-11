import type { Config } from 'tailwindcss';
import preset from '@lynx-js/tailwind-preset';

const config: Config = {
  content: ['./src/**/*.ts'],
  presets: [preset],
};

export default config;
