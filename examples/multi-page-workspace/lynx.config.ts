import { defineConfig, pluginAngularLynx } from '@blotch/angular-lynx-build';

export default defineConfig({
  // Multi-page via Angular workspace: each project in angular.json with
  // projectType "application" becomes a separate entry/.lynx.bundle, so
  // `ng build main` builds every page. Use pages: ['main', 'settings'] to
  // pick specific projects. The first project is called "main" because the
  // app `ng build --platform ios|android` generates opens main.lynx.bundle.
  plugins: [pluginAngularLynx({ pages: 'all' })],
});
