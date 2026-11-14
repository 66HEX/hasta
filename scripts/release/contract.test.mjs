import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import {
  assertPackMetadata,
  assertRegistryPublication,
  assertReleaseEvent,
  assertReleaseIdentity,
  assertTarball,
  assertWorkspaceVersions,
  classifyNpmViewResult,
  integrity,
  isTransientRegistryError,
  parseReleaseTag,
  readTarball,
  REGISTRY,
  REPOSITORY,
} from './contract.mjs';

const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('packages/hasta/package.json', root), 'utf8'));
const version = manifest.version;

function releaseEvent(tag = `v${version}`) {
  return { action: 'published', release: { draft: false, prerelease: false, tag_name: tag } };
}

function packedFixture() {
  const contents = new Map([
    ['package.json', Buffer.from(JSON.stringify(manifest))],
    ['README.md', Buffer.from('# hasta')],
    ['LICENSE', readFileSync(new URL('LICENSE', root))],
  ]);

  for (const entry of Object.values(manifest.exports)) {
    for (const target of Object.values(entry)) {
      contents.set(target.slice(2), Buffer.from('export {};\n'));
    }
  }

  const blocks = [];

  for (const [file, content] of contents) {
    const header = Buffer.alloc(512);
    header.write(`package/${file}`);
    header.write(`${content.length.toString(8).padStart(11, '0')}\0`, 124);
    header.write('0', 156);
    blocks.push(header, content, Buffer.alloc((512 - (content.length % 512)) % 512));
  }

  blocks.push(Buffer.alloc(1024));
  const tarball = gzipSync(Buffer.concat(blocks));
  const files = [...contents].map(([path, content]) => ({ path, size: content.length }));

  const artifact = {
    id: `hasta@${version}`,
    name: 'hasta',
    version,
    filename: `hasta-${version}.tgz`,
    size: tarball.length,
    unpackedSize: [...contents.values()].reduce((sum, value) => sum + value.length, 0),
    shasum: createHash('sha1').update(tarball).digest('hex'),
    integrity: integrity(tarball),
    files,
    entryCount: files.length,
  };

  return { tarball, artifact };
}

test('accepts only stable published releases and canonical tags', () => {
  assert.equal(assertReleaseEvent(releaseEvent('v1.2.3')), '1.2.3');

  for (const tag of [
    '1.2.3',
    'v01.2.3',
    'v1.2',
    'v1.2.3-rc.1',
    'v1.2.3+build',
    'v1.2.3\nmalicious',
  ]) {
    assert.throws(() => parseReleaseTag(tag));
  }

  assert.throws(() => assertReleaseEvent({ ...releaseEvent(), action: 'created' }));
  assert.throws(() =>
    assertReleaseEvent({ ...releaseEvent(), release: { ...releaseEvent().release, draft: true } }),
  );
  assert.throws(() =>
    assertReleaseEvent({
      ...releaseEvent(),
      release: { ...releaseEvent().release, prerelease: true },
    }),
  );
});

test('rejects wrong repository, version, private packages, and publication metadata', () => {
  assertReleaseIdentity(manifest, version, REPOSITORY);
  assert.throws(() => assertReleaseIdentity(manifest, version, 'fork/hasta'));
  assert.throws(() => assertReleaseIdentity(manifest, '999.0.0', REPOSITORY));

  for (const change of [
    { name: 'other' },
    { private: true },
    { repository: { ...manifest.repository, directory: '.' } },
    { publishConfig: { access: 'public', registry: 'https://example.com/' } },
    { publishConfig: { ...manifest.publishConfig, provenance: false } },
    { license: 'UNLICENSED' },
  ]) {
    assert.throws(() => assertReleaseIdentity({ ...manifest, ...change }, version, REPOSITORY));
  }
});

test('keeps workspace dependencies, the lockfile, and distributed MIT license consistent', () => {
  const manifests = Object.fromEntries(
    ['', 'apps/web', 'apps/lab'].map((workspace) => [
      workspace,
      JSON.parse(
        readFileSync(new URL(`${workspace ? `${workspace}/` : ''}package.json`, root), 'utf8'),
      ),
    ]),
  );

  const lock = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8'));
  assertWorkspaceVersions(manifests, lock, version);
  const stale = structuredClone(lock);
  stale.packages['apps/lab'].dependencies.hasta = '999.0.0';
  assert.throws(() => assertWorkspaceVersions(manifests, stale, version));
  assert.throws(() => assertWorkspaceVersions(manifests, lock, '999.0.0'));
  const unsafe = structuredClone(manifests);
  unsafe['apps/web'].private = false;
  assert.throws(() => assertWorkspaceVersions(unsafe, lock, version));
  assert.equal(
    readFileSync(new URL('LICENSE', root), 'utf8'),
    readFileSync(new URL('packages/hasta/LICENSE', root), 'utf8'),
  );
  assert.equal(manifest.license, 'MIT');

  for (const [workspace, value] of Object.entries(manifests)) {
    assert.equal(value.license, 'MIT');
    assert.equal(lock.packages[workspace].license, 'MIT');
  }
});

test('only a structured npm E404 establishes that a version is unused', () => {
  assert.equal(classifyNpmViewResult({ status: 0, stdout: JSON.stringify(version) }), 'published');
  assert.equal(
    classifyNpmViewResult({ status: 1, stdout: '{"error":{"code":"E404"}}' }),
    'unpublished',
  );

  for (const stdout of [
    '{"error":{"code":"ECONNRESET"}}',
    'Proxy returned 404 Not Found',
    '',
    '{"error":{"code":"E401"}}',
  ]) {
    assert.equal(classifyNpmViewResult({ status: 1, stdout }), 'indeterminate');
  }
});

test('rejects extra files, missing exports, traversal, wrong identity, and oversized packs', () => {
  const { artifact } = packedFixture();
  assertPackMetadata([artifact], manifest, version);
  assert.throws(() => assertPackMetadata([artifact, artifact], manifest, version));

  for (const change of [
    { filename: '../hasta.tgz' },
    { name: 'other' },
    { unpackedSize: 1_000_000 },
    { integrity: 'sha512-invalid' },
    { files: artifact.files.slice(1) },
    {
      files: [...artifact.files, { path: 'docs/recording.json', size: 0 }],
      entryCount: artifact.entryCount + 1,
    },
    {
      files: [...artifact.files, { path: 'dist/../secret.js', size: 0 }],
      entryCount: artifact.entryCount + 1,
    },
  ]) {
    assert.throws(() => assertPackMetadata([{ ...artifact, ...change }], manifest, version));
  }
});

test('verifies the actual archive, hashes, file sizes, and packed manifest', () => {
  const { artifact, tarball } = packedFixture();
  assertTarball(tarball, artifact, manifest);
  assert.equal(readTarball(tarball).size, artifact.files.length);
  assert.throws(() =>
    assertTarball(Buffer.concat([tarball, Buffer.from('tampered')]), artifact, manifest),
  );
  assert.throws(() =>
    assertTarball(tarball, { ...artifact, integrity: 'sha512-invalid' }, manifest),
  );
  assert.throws(() =>
    assertTarball(tarball, { ...artifact, files: artifact.files.slice(1) }, manifest),
  );
  assert.throws(() => assertTarball(tarball, artifact, { ...manifest, private: true }));
});

test('requires the registry to expose the exact artifact, latest version, and npm provenance', () => {
  const expected = integrity(Buffer.from('release'));

  const document = {
    name: 'hasta',
    version,
    dist: {
      integrity: expected,
      attestations: {
        url: `${REGISTRY}-/npm/v1/attestations/hasta@${version}`,
        provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
      },
    },
  };

  assertRegistryPublication(document, { latest: version }, version, expected);
  assert.throws(() =>
    assertRegistryPublication(document, { latest: '999.0.0' }, version, expected),
  );
  assert.throws(() =>
    assertRegistryPublication(document, { latest: version }, version, 'sha512-tampered'),
  );
  assert.throws(() =>
    assertRegistryPublication(
      { ...document, dist: { integrity: expected } },
      { latest: version },
      version,
      expected,
    ),
  );
  document.dist.attestations.url = 'https://example.com/provenance';
  assert.throws(() => assertRegistryPublication(document, { latest: version }, version, expected));
});

test('retries registry propagation failures without retrying invalid signatures', () => {
  for (const error of ['npm error code E404', 'ECONNRESET', 'ETIMEDOUT', 'E503']) {
    assert.equal(isTransientRegistryError(error), true);
  }

  for (const error of ['EINTEGRITYSIGNATURE', 'EATTESTATIONVERIFY', 'E401', 'E403']) {
    assert.equal(isTransientRegistryError(error), false);
  }
});
