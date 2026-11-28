/// <reference path="./node_modules/@nativescript/types/index.d.ts" />

/** The fixture server's origin, or '' for the default (webpack.config.js, from FIXTURE_ORIGIN). */
declare const __FIXTURE_ORIGIN__: string;
/** A benchmark screen to open on at launch, such as 'mount?kind=view&count=1500', or '' (BENCH_SCREEN). */
declare const __BENCH_SCREEN__: string;

/**
 * The app's own Swift class (App_Resources/iOS/src/AppStartup.swift). NativeScript generates
 * metadata for it when it builds the app, so JavaScript calls it directly.
 */
declare class AppStartup extends NSObject {
  static reportFullyDrawn(): void;
  static reportMountStart(): void;
  static reportMountEnd(): void;
}
