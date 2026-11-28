const webpack = require('@nativescript/webpack');

module.exports = (env) => {
  webpack.init(env);

  // The benchmark's build-time settings (README): the fixture server's origin, and a screen to
  // open on at launch. Instruments launches an app with no URL, so a benchmark screen is a build
  // of its own. The values are inlined into the bundle, as Expo inlines EXPO_PUBLIC_* variables.
  webpack.chainWebpack((config) => {
    config.plugin('DefinePlugin').tap((args) => {
      Object.assign(args[0], {
        __FIXTURE_ORIGIN__: JSON.stringify(process.env.FIXTURE_ORIGIN ?? ''),
        __BENCH_SCREEN__: JSON.stringify(process.env.BENCH_SCREEN ?? ''),
      });
      return args;
    });
  });

  return webpack.resolveConfig();
};
