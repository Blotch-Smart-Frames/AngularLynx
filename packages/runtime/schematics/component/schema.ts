export type Schema = {
  name: string;
  path?: string;
  project?: string;
  prefix?: string;
  inlineStyle?: boolean;
  inlineTemplate?: boolean;
  skipTests?: boolean;
  flat?: boolean;
};
