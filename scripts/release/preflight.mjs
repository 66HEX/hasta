import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { assertReleaseEvent, assertReleaseIdentity, assertWorkspaceVersions } from './contract.mjs';

const [eventPath, repository] = process.argv.slice(2);

if (!eventPath || !repository) {
  throw new Error('Usage: node scripts/release/preflight.mjs <event-json> <owner/repository>');
}

const root = resolve(import.meta.dirname, '../..');
const event = JSON.parse(readFileSync(eventPath, 'utf8'));
const version = assertReleaseEvent(event);

const manifests = Object.fromEntries(
  ['', 'packages/hasta', 'apps/web', 'apps/lab'].map((workspace) => [
    workspace,
    JSON.parse(readFileSync(resolve(root, workspace, 'package.json'), 'utf8')),
  ]),
);

assertReleaseIdentity(manifests['packages/hasta'], version, repository);

assertWorkspaceVersions(manifests, readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8'), version);

process.stdout.write(`version=${version}\n`);
