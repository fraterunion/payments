import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_GROUPS = ['apps', 'packages'];

/**
 * Discover every workspace that owns an eslint.config.mjs, instead of
 * hard-coding the list. A workspace only needs to be added here by adding
 * its own eslint.config.mjs — nothing in this file has to change.
 */
function discoverLintableWorkspaces() {
  const workspaces = [];

  for (const group of WORKSPACE_GROUPS) {
    const groupDir = path.join(ROOT_DIR, group);
    if (!existsSync(groupDir)) continue;

    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const workspace = `${group}/${entry.name}`;
      const eslintConfigPath = path.join(ROOT_DIR, workspace, 'eslint.config.mjs');
      if (existsSync(eslintConfigPath)) {
        workspaces.push(workspace);
      }
    }
  }

  return workspaces;
}

const LINTABLE_WORKSPACES = discoverLintableWorkspaces();

function workspaceFor(file) {
  const relative = path.relative(ROOT_DIR, file);
  return LINTABLE_WORKSPACES.find((workspace) => relative.startsWith(`${workspace}/`));
}

/**
 * ESLint's flat config is resolved relative to the process cwd, but lint-staged
 * always runs from the repo root. Group staged files by their workspace and pass
 * each workspace's own eslint.config.mjs explicitly instead of relying on cwd-based discovery.
 *
 * The `eslint` binary itself is invoked via each workspace's own
 * `node_modules/.bin/eslint` rather than a bare `eslint` command: `eslint`
 * is only ever a devDependency of individual workspace packages, never of
 * the repo root, so a bare command name is not reliably resolvable via
 * PATH in the process lint-staged spawns tasks in.
 */
function eslintCommands(files) {
  const filesByWorkspace = new Map();

  for (const file of files) {
    const workspace = workspaceFor(file);
    if (workspace === undefined) continue;
    const group = filesByWorkspace.get(workspace) ?? [];
    group.push(file);
    filesByWorkspace.set(workspace, group);
  }

  return [...filesByWorkspace.entries()].map(([workspace, workspaceFiles]) => {
    const eslintBin = path.join(ROOT_DIR, workspace, 'node_modules', '.bin', 'eslint');
    return `${eslintBin} --fix --config ${workspace}/eslint.config.mjs ${workspaceFiles.join(' ')}`;
  });
}

export default {
  '**/*.{ts,tsx}': eslintCommands,
  '**/*.{ts,tsx,js,jsx,mjs,cjs,json,md,yml,yaml,css}': 'prettier --write',
};
