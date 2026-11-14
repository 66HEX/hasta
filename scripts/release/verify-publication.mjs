import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

import {
  assertRegistryPublication,
  integrity,
  isTransientRegistryError,
  PACKAGE_NAME,
  parseReleaseTag,
  REGISTRY,
  registryUrls,
} from './contract.mjs';

const [version, tarballPath] = process.argv.slice(2);

if (!version || !tarballPath) {
  throw new Error('Usage: node scripts/release/verify-publication.mjs <version> <tarball>');
}

parseReleaseTag(`v${version}`);

const expectedIntegrity = integrity(readFileSync(tarballPath));
const directory = mkdtempSync(join(tmpdir(), 'hasta-registry-audit-'));

async function registryDocument(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });

  assert.ok(response.ok, `Registry returned HTTP ${response.status}: ${url}`);

  return response.json();
}

async function verify(attempt = 1) {
  try {
    const urls = registryUrls(version);

    const [document, tags] = await Promise.all([
      registryDocument(urls.version),
      registryDocument(urls.tags),
    ]);

    const url = assertRegistryPublication(document, tags, version, expectedIntegrity);
    const attestations = await registryDocument(url);
    assert.ok(attestations.attestations?.length > 0, 'Registry has not exposed provenance data');
  } catch (error) {
    if (attempt === 12) {
      throw error;
    }

    console.error(`Registry verification ${attempt}/12: ${error.message}`);
    await setTimeout(10_000);

    return verify(attempt + 1);
  }
}

async function auditSignatures(attempt = 1) {
  try {
    execFileSync('npm', ['audit', 'signatures', '--prefer-online', '--registry', REGISTRY], {
      cwd: directory,
      stdio: 'pipe',
      timeout: 60_000,
    });
  } catch (error) {
    const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;

    if (attempt === 12 || !isTransientRegistryError(output)) {
      throw error;
    }

    console.error(`Signature audit ${attempt}/12: registry metadata is still propagating`);
    await setTimeout(10_000);

    return auditSignatures(attempt + 1);
  }
}

try {
  await verify();
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({ name: 'hasta-registry-audit', private: true }),
  );
  execFileSync(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--save-exact',
      '--prefer-online',
      '--no-fund',
      '--no-audit',
      '--registry',
      REGISTRY,
      `${PACKAGE_NAME}@${version}`,
    ],
    {
      cwd: directory,
      stdio: 'pipe',
      timeout: 120_000,
    },
  );
  const lock = JSON.parse(readFileSync(join(directory, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages[`node_modules/${PACKAGE_NAME}`].integrity, expectedIntegrity);
  await auditSignatures();
  console.log(`Verified ${PACKAGE_NAME}@${version}: latest, integrity, provenance, and signatures`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
