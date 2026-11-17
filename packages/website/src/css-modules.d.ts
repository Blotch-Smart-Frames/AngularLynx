declare module '*.module.scss' {
  const styles: Record<string, string>;
  export default styles;
}

// The benchmark results (benchmarks/results), which rspress.config.ts loads
// as text.
declare module '*.csv' {
  const text: string;
  export default text;
}

type ImportMeta = {
  webpackContext(
    request: string,
    options?: { recursive?: boolean; regExp?: RegExp },
  ): { keys(): string[]; (id: string): unknown };
}
