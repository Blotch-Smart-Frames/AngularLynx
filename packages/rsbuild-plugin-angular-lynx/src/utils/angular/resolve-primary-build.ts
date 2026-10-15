import type { workspaces } from '@angular-devkit/core';
import type { AngularCliContext } from '../../angular-cli-context.js';
import {
  type NormalizedOptions,
  normalizeBuildOptions,
  readBuildOptions,
} from './options.js';
import { getProjectByCwd } from './read-workspace.js';

/**
 * Picks the project whose build target configures the compile (tsconfig,
 * polyfills, global styles, output path), and normalizes its options.
 *
 * The project is the one Angular CLI is building, when there is one: one of
 * the `pages` if the plugin builds several, otherwise any. Without Angular
 * CLI it is the first of the `pages`, or the project the working directory
 * is in.
 *
 * The options are the ones Angular CLI resolved for that project (with `-c`
 * and command-line overrides applied) when it is the one being built, and
 * otherwise the target's options in angular.json under its default
 * configuration.
 */
export const resolvePrimaryBuild = async ({
  workspace,
  basePath,
  pages,
  cli,
}: {
  workspace: workspaces.WorkspaceDefinition;
  basePath: string;
  pages: string[] | 'all' | undefined;
  cli: AngularCliContext | undefined;
}): Promise<{ projectName: string; buildOptions: NormalizedOptions }> => {
  let projectName: string | null;
  if (pages) {
    const candidates =
      pages === 'all'
        ? Array.from(workspace.projects.entries())
            .filter(
              ([, project]) =>
                project.extensions['projectType'] === 'application',
            )
            .map(([name]) => name)
        : pages;
    projectName =
      cli && candidates.includes(cli.project)
        ? cli.project
        : (candidates[0] ?? null);
  } else {
    projectName = cli?.project ?? getProjectByCwd(workspace, basePath);
  }

  if (!projectName) {
    throw new Error("couldn't find the project");
  }
  const project = workspace.projects.get(projectName);
  if (!project) {
    throw new Error(`Project "${projectName}" not found in workspace`);
  }
  const buildOptions =
    cli?.project === projectName
      ? await normalizeBuildOptions(cli.buildOptions, project, basePath)
      : await readBuildOptions(project, basePath);
  return { projectName, buildOptions };
};
