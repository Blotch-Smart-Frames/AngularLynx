export type Schema = {
  project?: string;
  /**
   * A string when it comes from `ng add`: the CLI parses the command line
   * before it has downloaded the package, so it doesn't know this option is a
   * boolean and passes `--tailwind=false` through as `"false"`. schema.json
   * accepts `"true"` and `"false"` for that reason (and makes the prompt a
   * yes/no confirmation explicitly, since a union type would otherwise turn it
   * into a text input).
   */
  tailwind?: boolean | 'true' | 'false';
  /**
   * The Tailwind CSS major version: a string, or a number when the CLI has
   * parsed `--tailwind-version 4` without the schema (see `tailwind`).
   * Defaults to the project's own version, else 4.
   */
  tailwindVersion?: '3' | '4' | 3 | 4;
};
