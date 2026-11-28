/**
 * Build-time settings, defined by scripts/build.mjs (`ng build --define`) from the FIXTURE_ORIGIN
 * and BENCH_SCREEN environment variables. Undefined in `ng serve` and `ng test`, so read through
 * `typeof`.
 */
declare const __FIXTURE_ORIGIN__: string | undefined;
declare const __BENCH_SCREEN__: string | undefined;
