// Software Mansion's app.json named their own bundle ID and Apple team. The
// benchmark builds each app under the team of whoever runs it, so `expo
// prebuild` takes both from the environment when it writes the Xcode project:
// BENCH_BUNDLE_ID (default: app.json's) and BENCH_APPLE_TEAM_ID (default:
// none, which a simulator build doesn't need). They go into the project
// rather than onto xcodebuild's command line, where PRODUCT_BUNDLE_IDENTIFIER
// would also stamp the app's ID on every pod's resource bundle.
module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    bundleIdentifier: process.env.BENCH_BUNDLE_ID || config.ios.bundleIdentifier,
    ...(process.env.BENCH_APPLE_TEAM_ID && { appleTeamId: process.env.BENCH_APPLE_TEAM_ID }),
  },
});
