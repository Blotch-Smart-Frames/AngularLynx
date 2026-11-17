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

// Rspack's import.meta.webpackContext(), which the benchmark charts read
// the results folder with. An interface, because only an interface merges
// into the global ImportMeta.
// oxlint-disable-next-line typescript/consistent-type-definitions
interface ImportMeta {
  webpackContext(
    request: string,
    options?: { recursive?: boolean; regExp?: RegExp },
  ): { keys(): string[]; (id: string): unknown };
}
