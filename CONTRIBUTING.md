# Contributing

Use the Node.js version in `.node-version` and npm 11.19.0. Install dependencies with `npm ci`.

The web apps use licensed Nucleo Pixel icons. Set `NUCLEO_LICENSE_KEY` before installing dependencies, as described in [Nucleo's installation instructions](https://nucleoapp.com/react-packages). If you keep the key in the ignored root `.env`, load it for installation with `node --env-file=.env "$(command -v npm)" ci`. The published Hasta library does not depend on Nucleo.

## Checks

```sh
npm run audit:dependencies
npx playwright install --with-deps chromium firefox webkit
npm run check
npm run release:consumers
```

`ci:quality` checks formatting, lint rules, release tooling, workspace types, builds, unit tests, and package contents. `ci:e2e` tests the library, framework adapters, documentation site, and collector in Chromium, Firefox, and WebKit. It requires a completed build. `check` runs both gates in order.

The `ci` workflow runs on pull requests, pushes to `main`, and manual dispatch. Its `quality` job also installs a packed copy of Hasta outside the monorepo and tests SSR, declarations, and browser bundling with current and minimum peer versions. After quality passes, the library, adapters, documentation site, and collector run in separate browser jobs. All four jobs finish even if one fails, and retain failure traces for 14 days.

GitHub Actions reads the `NUCLEO_LICENSE_KEY` repository secret only during dependency installation. Fork pull requests do not receive repository secrets, so a maintainer must review them and run the full checks from a trusted branch. Do not expose the key through `pull_request_target` or commit it to the repository.

## Releases

Publishing a stable GitHub Release starts `.github/workflows/release.yml`. Pushing a tag alone does not publish a package.

1. Choose an unused version and update the library and both workspace references together:

   ```sh
   RELEASE_VERSION=0.1.0
   npm pkg set "version=$RELEASE_VERSION" --workspace=hasta
   npm pkg set "dependencies.hasta=$RELEASE_VERSION" --workspace=@hasta/web --workspace=@hasta/lab
   npm install --package-lock-only --ignore-scripts
   npm run format
   ```

2. Run the checks above. Commit the manifests and lockfile, and merge to `main` after CI passes.
3. Publish a GitHub Release with tag `vX.Y.Z` pointing to that commit. Use the same version as `packages/hasta/package.json`, include release notes, and leave the prerelease option unchecked.

The workflow checks the repository identity, tag version, workspace references, lockfile, ancestry on `main`, and whether npm already has that version. It then audits dependencies and runs the full quality and browser gates. It packs one release tarball, validates its contents and hashes, tests installations with current and minimum peers, and dry-runs publication. The same tarball is published as `latest` through npm trusted publishing.

After publication, the workflow checks the registry version, `latest`, tarball integrity, provenance, and signatures, then tests the exact registry version in isolated consumers. Registry propagation failures are retried; invalid signatures fail the run. The tested tarball and pack metadata remain available as a GitHub Actions artifact for 90 days.

If a check fails after publication, inspect the registry before taking further action. An npm version cannot be overwritten. The unpublished-version check deliberately rejects reruns that would publish an existing version. Fix the cause, verify the existing artifact with `verify-publication.mjs` and `release:consumers`, and use a new version if package contents need to change.

Library releases do not deploy either web app. Keep the deployed Lab build unchanged throughout a collection study. Use the separate deployment commands in the README when a web deployment is intended.

## npm setup

The release job uses the `npm-production` GitHub environment with `contents: read` and `id-token: write`. No npm token secret is needed for normal releases. Configure the npm trusted publisher for `hasta` with:

| Setting              | Value                                |
| -------------------- | ------------------------------------ |
| Provider             | GitHub Actions                       |
| Organization or user | `66HEX`                              |
| Repository           | `hasta`                              |
| Workflow filename    | `release.yml`                        |
| Environment          | `npm-production`                     |
| Allowed action       | Direct publishing with `npm publish` |

Create this connection when the next release is ready. npm requires its first successful publish within two days of configuration. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for account settings and expiry rules.

### First publication

Hasta has no public npm version yet. The package owner must first establish the package on npm through an authenticated publication, then add the trusted publisher in its package settings. Do this once from a reviewed, versioned commit after the full checks pass. Pack and test the artifact before publishing it:

```sh
RELEASE_DIRECTORY="$(mktemp -d)"
RELEASE_VERSION="$(node -p 'require("./packages/hasta/package.json").version')"
npm pack --json --ignore-scripts --workspace hasta --pack-destination "$RELEASE_DIRECTORY" > "$RELEASE_DIRECTORY/npm-pack.json"
node scripts/release/validate-packed-artifact.mjs "$RELEASE_DIRECTORY/npm-pack.json" "$RELEASE_DIRECTORY" "$RELEASE_VERSION"
npm run release:consumers -- "$RELEASE_DIRECTORY/hasta-$RELEASE_VERSION.tgz"
npm publish "$RELEASE_DIRECTORY/hasta-$RELEASE_VERSION.tgz" --dry-run --ignore-scripts --access public --tag latest
```

The package owner can then run `npm login` and publish that exact tarball with `npm publish "$RELEASE_DIRECTORY/hasta-$RELEASE_VERSION.tgz" --ignore-scripts --access public --tag latest`, completing npm's authentication prompts. A local bootstrap publication does not have GitHub Actions provenance. Subsequent versions use the release workflow above; do not trigger it for the already published bootstrap version.

## License

The repository and published library use the MIT license. `packages/hasta/LICENSE` is included in the npm tarball and must match the root `LICENSE`.
