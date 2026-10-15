/** The options in schema.json. Keep the two in sync. */
export type DevServerBuilderOptions = {
  readonly buildTarget?: string;
  readonly port?: number;
  readonly host?: string;
  readonly environment?: string[];
};
