const { readFileSync, writeFileSync } = require('node:fs');

const main = () => {
  const angularBuildPackageJson =
    require.resolve('@angular/build/package.json');
  const fileContentsJson = JSON.parse(
    readFileSync(angularBuildPackageJson, 'utf8'),
  );
  // Angular 22.2 moved the transformer out of `src/tools/esbuild/`.
  fileContentsJson.exports['./src/tools/javascript-transformer'] =
    './src/tools/javascript-transformer/index.js';
  fileContentsJson.exports['./src/tools/angular/compilation'] =
    './src/tools/angular/compilation/index.js';
  fileContentsJson.exports[
    './src/tools/esbuild/angular/file-reference-tracker'
  ] = './src/tools/esbuild/angular/file-reference-tracker.js';
  fileContentsJson.exports[
    './src/tools/esbuild/angular/component-stylesheets'
  ] = './src/tools/esbuild/angular/component-stylesheets.js';

  writeFileSync(
    angularBuildPackageJson,
    JSON.stringify(fileContentsJson, null, 2),
  );
};

main();
