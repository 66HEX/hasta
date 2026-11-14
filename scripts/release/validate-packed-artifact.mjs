import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertPackMetadata,
  assertReleaseIdentity,
  assertTarball,
  parseReleaseTag,
  REPOSITORY,
} from './contract.mjs';

const [metadataPath, directory, version] = process.argv.slice(2);

if (!metadataPath || !directory || !version) {
  throw new Error(
    'Usage: node scripts/release/validate-packed-artifact.mjs <pack-json> <artifact-directory> <version>',
  );
}

parseReleaseTag(`v${version}`);

const manifest = JSON.parse(
  readFileSync(new URL('../../packages/hasta/package.json', import.meta.url), 'utf8'),
);

assertReleaseIdentity(manifest, version, REPOSITORY);

const artifact = assertPackMetadata(
  JSON.parse(readFileSync(metadataPath, 'utf8')),
  manifest,
  version,
);

const tarballPath = resolve(directory, artifact.filename);

assertTarball(readFileSync(tarballPath), artifact, manifest);

process.stdout.write(`tarball=${tarballPath}\nmetadata=${resolve(metadataPath)}\n`);
