import { pluginAngularLynx } from '@blotch/rsbuild-plugin-angular-lynx';
import { defineConfig } from '@lynx-js/rspeedy';

export default defineConfig({
  environments: {
    web: {
      output: { cleanDistPath: false },
    },
    lynx: {},
  },
  // Multi-page via Angular workspace: each project in angular.json with
  // projectType "application" becomes a separate entry/.lynx.bundle.
  // Use pages: ['home', 'settings'] to pick specific projects.
  plugins: [pluginAngularLynx({ pages: 'all' })],
});
