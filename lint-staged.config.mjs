import path from 'node:path';

const LINTABLE_WORKSPACES = [
  'apps/api',
  'apps/admin',
  'apps/docs',
  'apps/worker',
  'packages/config',
  'packages/payment-core',
  'packages/provider-contracts',
  'packages/sdk-typescript',
  'packages/shared',
  'packages/ui',
];

function workspaceFor(file) {
  const relative = path.relative(process.cwd(), file);
  return LINTABLE_WORKSPACES.find((workspace) => relative.startsWith(`${workspace}/`));
}

/**
 * ESLint's flat config is resolved relative to the process cwd, but lint-staged
 * always runs from the repo root. Group staged files by their workspace and pass
 * each workspace's own eslint.config.mjs explicitly instead of relying on cwd-based discovery.
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

  return [...filesByWorkspace.entries()].map(
    ([workspace, workspaceFiles]) =>
      `eslint --fix --config ${workspace}/eslint.config.mjs ${workspaceFiles.join(' ')}`,
  );
}

export default {
  '**/*.{ts,tsx}': eslintCommands,
  '**/*.{ts,tsx,js,jsx,mjs,cjs,json,md,yml,yaml,css}': 'prettier --write',
};
