import path from 'node:path';
import type { workspaces } from '@angular-devkit/core';
import { readTarget } from './options.js';

export type ResolvedPage = {
  name: string;
  browser: string;
};

/**
 * Resolves angular.json projects into entry points for multi-page builds.
 *
 * When `pages` is `'all'`, every project with `projectType: 'application'` is
 * included. When it's a `string[]`, only those named projects are used.
 * Each project's `architect.build.options.browser` field becomes the entry path.
 */
export const resolvePages = (
  workspace: workspaces.WorkspaceDefinition,
  basePath: string,
  pages: string[] | 'all',
): ResolvedPage[] => {
  const projectNames =
    pages === 'all'
      ? Array.from(workspace.projects.entries())
          .filter(([, def]) => def.extensions['projectType'] === 'application')
          .map(([name]) => name)
      : pages;

  if (projectNames.length === 0) {
    throw new Error(
      pages === 'all'
        ? 'No application-type projects found in angular.json. ' +
            'Add at least one project with "projectType": "application".'
        : 'The "pages" option is an empty array. Provide at least one project name.',
    );
  }

  const resolved: ResolvedPage[] = [];
  const tsconfigs = new Set<string>();

  for (const name of projectNames) {
    const project = workspace.projects.get(name);
    if (!project) {
      throw new Error(
        `Project "${name}" not found in angular.json. ` +
          `Available projects: ${Array.from(workspace.projects.keys()).join(', ')}`,
      );
    }

    const target = readTarget(project);
    if (!target?.options) {
      throw new Error(
        `Project "${name}" has no build target or options in angular.json. ` +
          'Make sure it has an architect.build.options section.',
      );
    }

    const browser = target.options['browser'] as string | undefined;
    if (!browser) {
      throw new Error(
        `Project "${name}" has no "browser" field in its build options. ` +
          'Set it to the entry file path (e.g., "src/main.ts").',
      );
    }

    const tsConfig = target.options['tsConfig'] as string | undefined;
    if (tsConfig) {
      tsconfigs.add(path.resolve(basePath, tsConfig));
    }

    resolved.push({
      name,
      browser: path.join(basePath, browser),
    });
  }

  // All pages must share one tsconfig — the Angular compilation runs a single
  // pass over all source files. Supporting multiple tsconfigs would require
  // separate compilation instances per page (a future enhancement).
  if (tsconfigs.size > 1) {
    throw new Error(
      'Multi-page builds require all projects to share the same tsConfig. ' +
        `Found ${tsconfigs.size} different tsconfigs: ${Array.from(tsconfigs).join(', ')}. ` +
        'Consolidate your projects to use a single tsconfig.',
    );
  }

  return resolved;
};
