import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export const PACKAGE_NAME = '@66hex/hasta';
export const REPOSITORY = '66HEX/hasta';
export const REGISTRY = 'https://registry.npmjs.org/';
export const MAX_UNPACKED_SIZE = 1_000_000;
export const ENTRYPOINTS = ['.', './core', './vanilla', './react', './vue', './svelte', './solid'];

export function registryUrls(version) {
  const packagePath = encodeURIComponent(PACKAGE_NAME);

  return {
    version: `${REGISTRY}${packagePath}/${version}`,
    tags: `${REGISTRY}-/package/${packagePath}/dist-tags`,
  };
}

export function parseReleaseTag(tag) {
  assert.match(tag, /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u, 'Expected a stable vX.Y.Z tag');

  return tag.slice(1);
}

export function assertReleaseEvent(event) {
  assert.equal(event.action, 'published', 'Only published releases can publish to npm');
  assert.equal(event.release?.draft, false, 'Draft releases cannot publish to npm');
  assert.equal(event.release?.prerelease, false, 'Prereleases cannot publish to latest');

  return parseReleaseTag(event.release.tag_name);
}

export function assertReleaseIdentity(manifest, version, repository) {
  assert.equal(repository, REPOSITORY, 'Unexpected GitHub repository');
  assert.equal(manifest.name, PACKAGE_NAME, 'Unexpected package name');
  assert.equal(manifest.version, version, 'Tag and package versions must match');
  assert.notEqual(manifest.private, true, 'The library must be publishable');
  assert.deepEqual(manifest.repository, {
    type: 'git',
    url: `https://github.com/${REPOSITORY}`,
    directory: 'packages/hasta',
  });
  assert.equal(manifest.homepage, 'https://hasta.madebyhex.com');
  assert.equal(manifest.bugs?.url, `https://github.com/${REPOSITORY}/issues`);
  assert.equal(manifest.publishConfig?.access, 'public');
  assert.equal(manifest.publishConfig?.registry, REGISTRY);
  assert.equal(manifest.license, 'MIT');
  assert.notEqual(manifest.publishConfig?.provenance, false);
}

export function assertWorkspaceVersions(manifests, lock, version) {
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.packages['packages/hasta']?.version, version, 'Stale library lockfile version');
  assert.deepEqual(lock.packages[`node_modules/${PACKAGE_NAME}`], {
    resolved: 'packages/hasta',
    link: true,
  });
  assert.equal(manifests[''].private, true, 'The monorepo must remain private');

  for (const workspace of ['apps/web', 'apps/lab']) {
    assert.equal(manifests[workspace].private, true, `${workspace} must remain private`);
    assert.equal(
      manifests[workspace].dependencies[PACKAGE_NAME],
      version,
      `${workspace} has a stale Hasta dependency`,
    );
    assert.equal(
      lock.packages[workspace]?.dependencies[PACKAGE_NAME],
      version,
      `${workspace} has a stale lockfile`,
    );
  }
}

export function classifyNpmViewResult(result) {
  if (result.status === 0) {
    return 'published';
  }

  try {
    const response = JSON.parse(result.stdout);

    return response.error?.code === 'E404' ? 'unpublished' : 'indeterminate';
  } catch {
    return 'indeterminate';
  }
}

export function integrity(buffer) {
  return `sha512-${createHash('sha512').update(buffer).digest('base64')}`;
}

export function assertPackMetadata(metadata, manifest, version) {
  assert.deepEqual(manifest.files, ['dist']);
  assert.equal(manifest.sideEffects, false);
  assert.deepEqual(Object.keys(manifest.exports), ENTRYPOINTS);
  assert.equal(metadata.length, 1, 'Expected exactly one npm artifact');
  const [artifact] = metadata;
  assert.equal(artifact.id, `${PACKAGE_NAME}@${version}`);
  assert.equal(artifact.name, PACKAGE_NAME);
  assert.equal(artifact.version, version);
  assert.equal(
    artifact.filename,
    `${PACKAGE_NAME.replace(/^@/u, '').replace('/', '-')}-${version}.tgz`,
  );
  assert.ok(Number.isSafeInteger(artifact.size) && artifact.size > 0);
  assert.ok(Number.isSafeInteger(artifact.unpackedSize) && artifact.unpackedSize > 0);
  assert.ok(artifact.unpackedSize < MAX_UNPACKED_SIZE, 'Package exceeds the unpacked size budget');
  assert.match(artifact.shasum, /^[a-f0-9]{40}$/u);
  assert.match(artifact.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/u);
  assert.equal(artifact.entryCount, artifact.files.length);
  const paths = new Set();
  let totalSize = 0;

  for (const file of artifact.files) {
    assert.match(
      file.path,
      /^(?:package\.json|README\.md|LICENSE|dist\/(?:[\w-]+\/)*[\w-]+(?:\.d\.ts|\.js))$/u,
      'Unexpected file in npm package',
    );
    assert.ok(Number.isSafeInteger(file.size) && file.size >= 0);
    assert.ok(!paths.has(file.path), `Duplicate packed file: ${file.path}`);
    paths.add(file.path);
    totalSize += file.size;
  }

  assert.equal(totalSize, artifact.unpackedSize);

  const required = [
    'package.json',
    'README.md',
    'LICENSE',
    manifest.main.slice(2),
    manifest.types.slice(2),
  ];

  for (const entry of Object.values(manifest.exports)) {
    for (const target of Object.values(entry)) {
      assert.match(target, /^\.\/dist\//u);
      required.push(target.slice(2));
    }
  }

  for (const file of required) {
    assert.ok(paths.has(file), `Missing public entrypoint or package file: ${file}`);
  }

  return artifact;
}

function tarString(buffer, start, length) {
  return buffer
    .subarray(start, start + length)
    .toString('utf8')
    .split('\0')[0];
}

export function readTarball(tarball) {
  const archive = gunzipSync(tarball, { maxOutputLength: MAX_UNPACKED_SIZE * 2 });
  const files = new Map();
  let offset = 0;

  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);

    if (header.every((byte) => byte === 0)) {
      break;
    }

    assert.ok(['', '0'].includes(tarString(header, 156, 1)), 'Only regular files may be published');
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    assert.ok(fullName.startsWith('package/'), 'Tarball files must be below package/');
    const file = fullName.slice('package/'.length);
    assert.ok(
      !file.split('/').some((part) => part === '..' || part === ''),
      'Invalid tarball path',
    );
    assert.ok(!files.has(file), `Duplicate tarball file: ${file}`);
    const sizeField = tarString(header, 124, 12).trim();
    assert.match(sizeField, /^[0-7]+$/u);
    const size = Number.parseInt(sizeField, 8);
    const start = offset + 512;
    assert.ok(start + size <= archive.length, 'Truncated tarball');
    files.set(file, archive.subarray(start, start + size));
    offset = start + Math.ceil(size / 512) * 512;
  }

  return files;
}

export function assertTarball(tarball, artifact, manifest) {
  assert.equal(tarball.length, artifact.size, 'Tarball size differs from pack metadata');
  assert.equal(
    integrity(tarball),
    artifact.integrity,
    'Tarball integrity differs from pack metadata',
  );
  assert.equal(createHash('sha1').update(tarball).digest('hex'), artifact.shasum);
  const files = readTarball(tarball);
  assert.deepEqual(
    [...files.keys()].toSorted(),
    artifact.files.map((file) => file.path).toSorted(),
  );

  for (const file of artifact.files) {
    assert.equal(files.get(file.path).length, file.size, `Incorrect size: ${file.path}`);
  }

  assert.deepEqual(
    JSON.parse(files.get('package.json').toString('utf8')),
    manifest,
    'Packed manifest differs from the checked-out package',
  );
}

export function assertRegistryPublication(document, tags, version, expectedIntegrity) {
  assert.equal(document.name, PACKAGE_NAME);
  assert.equal(document.version, version);
  assert.equal(tags.latest, version, 'Registry latest differs from the release version');
  assert.equal(
    document.dist?.integrity,
    expectedIntegrity,
    'Registry tarball differs from the tested artifact',
  );
  assert.equal(
    document.dist?.attestations?.provenance?.predicateType,
    'https://slsa.dev/provenance/v1',
  );
  const url = document.dist.attestations.url;
  assert.ok(url.startsWith(`${REGISTRY}-/npm/v1/attestations/`), 'Unexpected provenance URL');

  return url;
}

export function isTransientRegistryError(output) {
  return /\b(?:E404|E429|E50[0-9]|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND)\b/u.test(output);
}
