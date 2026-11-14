import { spawnSync } from 'node:child_process';

import { classifyNpmViewResult, PACKAGE_NAME, parseReleaseTag, REGISTRY } from './contract.mjs';

const [version] = process.argv.slice(2);

parseReleaseTag(`v${version}`);

const result = spawnSync(
  'npm',
  ['view', `${PACKAGE_NAME}@${version}`, 'version', '--json', '--registry', REGISTRY],
  {
    encoding: 'utf8',
    timeout: 60_000,
  },
);

if (result.error) {
  throw result.error;
}

const status = classifyNpmViewResult(result);

if (status === 'published') {
  throw new Error(
    `${PACKAGE_NAME}@${version} already exists. Published versions cannot be reused.`,
  );
}

if (status !== 'unpublished') {
  throw new Error(
    `Could not establish whether ${PACKAGE_NAME}@${version} exists: ${result.stderr}`,
  );
}

console.log(`Confirmed ${PACKAGE_NAME}@${version} is unpublished`);
