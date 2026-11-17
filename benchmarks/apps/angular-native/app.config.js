// The benchmark harness installs every app on the same phone under one Personal Team, so the
// bundle ID and the team come from the environment at prebuild time rather than from app.json:
// a different team, or a second copy of the app, needs no edit to a tracked file.
//
//   BUNDLE_ID=com.angularlynx.bench.angularnative.mount APPLE_TEAM_ID=ABCDE12345 npx expo prebuild
//
// The fixture server's origin is not read here: EXPO_PUBLIC_FIXTURE_ORIGIN is inlined into the
// JavaScript bundle by Metro when the Release build embeds it (see src/app/data/config.ts).
module.exports = ({ config }) => {
  const bundleId = process.env.BUNDLE_ID || config.ios.bundleIdentifier;
  return {
    ...config,
    ios: {
      ...config.ios,
      bundleIdentifier: bundleId,
      appleTeamId: process.env.APPLE_TEAM_ID || 'F64LTK85F6',
    },
    android: {
      ...config.android,
      package: process.env.ANDROID_PACKAGE || bundleId,
    },
  };
};
