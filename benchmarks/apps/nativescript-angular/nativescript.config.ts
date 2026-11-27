import { NativeScriptConfig } from '@nativescript/core';

export default {
  // The harness installs the app on the phone as com.angularlynx.bench.rival (benchmarks/README.md);
  // BUNDLE_ID sets it when the app is prepared.
  id: process.env.BUNDLE_ID || 'com.angularlynx.bench.nativescript',
  appPath: 'src',
  appResourcesPath: 'App_Resources',
  android: {
    v8Flags: '--expose_gc',
    markingMode: 'none',
  },
} as NativeScriptConfig;
