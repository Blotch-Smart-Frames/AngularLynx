import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // The ID `cap add ios` wrote into the Xcode project. The harness builds the app as
  // com.angularlynx.bench.rival instead (benchmarks/harness/build_ios_app.sh).
  appId: 'com.angularlynx.bench.ionic',
  appName: 'LaunchPerfIonic',
  webDir: 'www',
  plugins: {
    // The reference's screens are white, so dark status bar content always, set natively at
    // launch rather than by a call from the app.
    StatusBar: { style: 'LIGHT' },
  },
};

export default config;
