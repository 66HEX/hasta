import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../../.github/workflows/release.yml', import.meta.url),
  'utf8',
);

test('publishing requires a release event, OIDC, and the production environment', () => {
  assert.match(workflow, /on:\n  release:\n    types:\n      - published/u);
  assert.doesNotMatch(workflow, /workflow_dispatch|pull_request|NPM_TOKEN|NODE_AUTH_TOKEN/u);
  assert.deepEqual(
    [...workflow.matchAll(/secrets\.([A-Z_]+)/gu)].map((match) => match[1]),
    ['NUCLEO_LICENSE_KEY'],
  );
  assert.match(workflow, /environment: npm-production/u);
  assert.match(workflow, /id-token: write/u);
  assert.match(workflow, /contents: read/u);
  assert.doesNotMatch(workflow, /contents: write/u);
  assert.match(workflow, /cancel-in-progress: false/u);
  assert.match(workflow, /package-manager-cache: false/u);
  assert.match(
    workflow,
    /git merge-base --is-ancestor "\$TAG_COMMIT" refs\/remotes\/origin\/main/u,
  );

  for (const action of workflow.matchAll(/uses: (.+)/gu)) {
    assert.match(action[1], /@[a-f0-9]{40}(?:\s|$)/u);
  }
});

test('publication is gated by validation and tests of the exact tarball', () => {
  const commands = [
    'node scripts/release/preflight.mjs',
    'git merge-base --is-ancestor',
    'node scripts/release/assert-unpublished.mjs',
    'pnpm install --frozen-lockfile',
    'pnpm audit:dependencies',
    'pnpm check',
    'npm pack --json --ignore-scripts',
    'node scripts/release/validate-packed-artifact.mjs',
    'pnpm release:consumers -- "${{ steps.pack.outputs.tarball }}"',
    'npm publish "${{ steps.pack.outputs.tarball }}" --dry-run --ignore-scripts --access public --tag latest',
    'npm publish "${{ steps.pack.outputs.tarball }}" --ignore-scripts --access public --tag latest',
    'node scripts/release/verify-publication.mjs "${{ steps.release.outputs.version }}" "${{ steps.pack.outputs.tarball }}"',
    'pnpm release:consumers -- "${{ steps.release.outputs.version }}"',
  ];

  let previous = -1;

  for (const command of commands) {
    const index = workflow.indexOf(command);
    assert.ok(index > previous, `Missing or out-of-order release step: ${command}`);
    previous = index;
  }

  assert.doesNotMatch(workflow, /wrangler|deploy:lab/u);
  assert.match(workflow, /\.\/packages\/hasta > "\$PACK_METADATA"/u);
});
