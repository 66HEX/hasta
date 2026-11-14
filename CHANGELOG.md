# Changelog

Notable changes to Hasta, grouped by release.

This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-11-14

### Added

- Solid 1.9 support through `@66hex/hasta/solid`, with reactive options, controller switching, automatic target cleanup, SSR, and hydration.
- Solid documentation and examples, with browser, lifecycle, type, and packaged-consumer tests.
- Reproducible cursor-stability and CPU benchmarks covering noisy motion, maneuvers, and shared target queries.

### Changed

- Active speculative intersection callbacks can retain their signal through near-boundary prediction misses for up to 32 ms, using an additional 6 px release margin and direction and speed checks. Confirmed contact departure, expired input, target removal, and pause or disconnection still cancel immediately. Custom predicates still cancel on their first false result.
- Reduced repeated predictor work by reusing adaptation buffers, validated samples, and projections shared by queries with the same time and horizon.
- The documentation header now reads the library version from its package manifest.

### Fixed

- Reduced velocity and trajectory jitter during steady pointer movement while preserving responsiveness to turns, braking, and reversals.
- Extended publication verification retries to allow npm package and provenance metadata to propagate after publishing.

## [0.2.0] - 2026-11-14

### Added

- Demo controls for prediction timing, target margins, current contact, stability, cooldown, and one-shot callbacks, arranged in two columns.
- Reproducible prediction and callback benchmarks covering sampling frequency, input noise, turns, reversals, and precise pointer movement.

### Changed

- New forecast callbacks require a fresh measurement timestamp. Animation frames, corrections with the same timestamp, and cooldown expiry alone no longer start or restart callbacks. This also applies to custom predicates.
- `stableForMs` measures the span of matching observations for forecasts. Confirmed current contact can still complete the delay while the pointer remains still when `includeCurrent` is enabled.
- Reduced CPU cost for sparse pointer updates by skipping redundant magnitude calculations when a conservative comparison proves the same result, preserving prediction and intersection outputs.

### Fixed

- Reduced the influence of isolated pointer outliers on Kalman position and velocity estimates for both dense and sparse input, while allowing consistent changes in motion through.
- Preserved genuine acceleration after turns by considering recent measured speed when checking sparse samples for outliers.
- Corrected release consumer checks to install registry versions as version ranges rather than local paths.

## [0.1.0] - 2026-11-14

### Added

- Initial stable release with element bounds tracking, Kalman pointer prediction, and trajectory intersection queries.
- Vanilla JavaScript, React, Vue, and Svelte adapters, plus DOM-independent core exports.
- Cancelable prediction callbacks, stability and cooldown settings, and debug visualization.
- Documentation site, interactive demo, and a pointer-trace collection app.

[unreleased]: https://github.com/66HEX/hasta/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/66HEX/hasta/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/66HEX/hasta/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/66HEX/hasta/tree/v0.1.0
