import { defineConfig, pluginAngularLynx } from '@blotch/angular-lynx-build';

// `ng build` and `ng serve` take the entry and environments from angular.json
// and add the AngularLynx plugin themselves. It's listed here only to pass
// it options; they use this instance instead of adding their own.
export default defineConfig({
  plugins: [pluginAngularLynx({ enableSSR: true })],
});
