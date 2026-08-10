import path from 'node:path';
import { workspaces } from '@angular-devkit/core';
import { NodeJsSyncHost } from '@angular-devkit/core/node';
import { findUp } from './find-up';

export type AngularWorkspace = {
  workspace: workspaces.WorkspaceDefinition;
  basePath: string;
};

const configNames = ['angular.json', '.angular.json'];

const findWorkspaceFile = () => {
  return findUp(configNames, process.cwd());
};

export const getAngularWorkspace = async (): Promise<AngularWorkspace> => {
  const host = workspaces.createWorkspaceHost(new NodeJsSyncHost());
  const workspaceFile = findWorkspaceFile();
  if (!workspaceFile) throw new Error("couldn't find workspace file");
  const { workspace } = await workspaces.readWorkspace(workspaceFile, host);
  return {
    basePath: path.dirname(workspaceFile),
    workspace,
  };
};

const findProjectByPath = (
  workspace: workspaces.WorkspaceDefinition,
  location: string,
  basePath: string,
): string | null => {
  const isInside = (base: string, potential: string): boolean => {
    const absoluteBase = path.resolve(basePath, base);
    const absolutePotential = path.resolve(basePath, potential);
    const relativePotential = path.relative(absoluteBase, absolutePotential);
    if (
      !relativePotential.startsWith('..') &&
      !path.isAbsolute(relativePotential)
    ) {
      return true;
    }

    return false;
  };

  // Sort by path depth (deepest first) so nested projects win over their parents.
  // Example: if cwd is inside both "app" (root: "") and "my-lib" (root: "my-lib"),
  // "my-lib" has a longer root path and sorts first — the more-specific project wins.
  const projects = Array.from(workspace.projects)
    .map(([name, project]) => [project.root, name] as [string, string])
    .filter((tuple) => isInside(tuple[0], location))
    // Sort tuples by depth, with the deeper ones first. Since the first member is a path and
    // we filtered all invalid paths, the longest will be the deepest (and in case of equality
    // the sort is stable and the first declared project will win).
    .sort((a, b) => b[0].length - a[0].length);

  if (projects.length === 0) {
    return null;
  }
  if (projects.length > 1) {
    const found = new Set<string>();
    const sameRoots = projects.filter((v) => {
      if (!found.has(v[0])) {
        found.add(v[0]);

        return false;
      }

      return true;
    });
    if (sameRoots.length > 0) {
      // Ambiguous location - cannot determine a project
      return null;
    }
  }

  return projects[0][1];
};

export const getProjectByCwd = (
  workspace: workspaces.WorkspaceDefinition,
  basePath: string,
): string | null => {
  if (workspace.projects.size === 1) {
    // If there is only one project, return that one.
    return Array.from(workspace.projects.keys())[0];
  }

  const project = findProjectByPath(workspace, process.cwd(), basePath);
  if (project) {
    return project;
  }

  return null;
};
