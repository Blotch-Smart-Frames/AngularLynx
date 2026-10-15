import { defineConfig, pluginAngularLynx } from '@blotch/angular-lynx-build';

export default defineConfig({
  // Multi-page via Angular workspace: each project in angular.json with
  // projectType "application" becomes a separate entry/.lynx.bundle, so
  // `ng build home` builds every page. Use pages: ['home', 'settings'] to
  // pick specific projects.
  plugins: [pluginAngularLynx({ pages: 'all' })],
});
