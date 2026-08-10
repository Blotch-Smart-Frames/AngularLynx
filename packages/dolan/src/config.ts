import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type DolanConfig = {
  aliases: {
    components: string;
    theme: string;
    utils?: string;
  };
};

const CONFIG_FILE = 'dolan.config.json';

export const getConfigPath = (cwd: string): string => {
  return resolve(cwd, CONFIG_FILE);
};

export const configExists = (cwd: string): boolean => {
  return existsSync(getConfigPath(cwd));
};

export const readConfig = (cwd: string): DolanConfig => {
  const path = getConfigPath(cwd);
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as DolanConfig;
};

export const writeConfig = (cwd: string, config: DolanConfig): void => {
  const path = getConfigPath(cwd);
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
};
