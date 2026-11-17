declare module '*.svg?raw' {
  const content: string;
  export default content;
}

declare module '*.png' {
  const url: string;
  export default url;
}

declare namespace NodeJS {
  interface ProcessEnv {
    readonly FIXTURE_ORIGIN: string;
    readonly BENCH_SCREEN: string;
  }
}
