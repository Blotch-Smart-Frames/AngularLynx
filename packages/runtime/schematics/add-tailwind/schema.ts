export type Schema = {
  project?: string;
  /**
   * The Tailwind CSS major version. Defaults to the project's own version,
   * else 4.
   */
  tailwindVersion?: '3' | '4' | 3 | 4;
};
