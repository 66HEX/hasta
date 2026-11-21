# Changelog

Notable changes to Hasta, grouped by release.

This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Updated `@66hex/hasta/solid` and its `solid-js` peer dependency (`>=2.0 <3`) for Solid 2.0 (`onSettled`, split `createEffect`, and `runWithOwner`-deferred ref cleanup).

## [0.6.0] - 2026-11-20

### Added

- Exposed descriptive cancellation reasons on `AbortSignal.reason` (`'miss'`, `'expired'`, `'hidden'`, `'paused'`, `'untracked'`, `'destroyed'`, `'disposed'`, `'error'`).
- Added `SVGElement` target support across the core engine, controller, and React, Vue, Svelte, and Solid adapters (`TrackedElement = HTMLElement | SVGElement`).
- Added `pointerTypes?: readonly ('mouse' | 'pen')[]` to `HastaOptions` (defaulting to `['mouse']`) to optionally track hover-capable pen input.
- Added `minSpeedPxPerMs?: number` to `IntersectsCondition` to gate speculative intersection triggers on minimum forecast speed.

## [0.5.0] - 2026-11-20

### Fixed

- Guarded `IntersectionHysteresis.retain()` against zero prior or current speed so stationary forecasts reset cleanly without `NaN` arithmetic.
- Preserved `rule.debug` eligibility metadata in `getDebugSnapshot()` while an intersection rule is held by release hysteresis.
- Saturated `expand()` bounds to finite limits so huge `marginPx` values cannot overflow rectangle coordinates or abort active subscriptions.
- Separated dirty-marking (`markDirty()`) from frame scheduling (`invalidate()`) in `GeometryCache` so idle input resets no longer schedule and immediately cancel a redundant `requestAnimationFrame`.
- Guarded optional `document.fonts` and `getAnimations()` calls so restricted or partial DOM environments do not throw during initialization or frame evaluation.
- Prevented `NaN` in `ObservedPath.take()` when clipping segments whose coordinate difference overflows.

### Added

- Unit and browser regression tests covering zero-speed hysteresis retention, debug eligibility during retention, huge `marginPx` saturation, idle reset frame scheduling, missing `document.fonts` / `getAnimations()` APIs, and overflowing observed-path clipping.

## [0.4.0] - 2026-11-15

### Added

- Cached geometry tracking with automatic invalidation for DOM changes, resize, scrolling, and animations, including tracked shadow roots.
- `hasta.invalidate()` and `controller.invalidate()` to refresh all target bounds after changes such as CSSOM edits. `target.invalidate()` refreshes one target.
- Regression tests for geometry caching, spatial queries, active rules, and shared prediction misses.
- GitHub repository link in the documentation header.

### Changed

- Geometry is cached by default. Set `bounds: 'frame'` to retain the per-frame measurement policy of 0.3.0. Cached bounds preserve their actual `measuredAt` timestamp.
- Reduced runtime work with a spatial grid, reused target and rule snapshots, and shared miss bookkeeping while preserving callback stability and cancellation behavior.
- Demo controls use colored inset shadows for hover, focus, and prediction highlights.

### Fixed

- Limited documentation tests to essential behavior: framework selection, copying, navigation, preferences, demo callbacks, and social metadata. Removed visual and contrast checks; library coverage is unchanged.

## [0.3.0] - 2026-11-14

### Added

- Solid 1.9 support through `@66hex/hasta/solid`, with reactive options, controller switching, automatic target cleanup, SSR, and hydration.
- Solid documentation and examples, with browser, lifecycle, type, and packaged-consumer tests.
- Reproducible cursor-stability and CPU benchmarks covering noisy motion, maneuvers, and shared target queries.

### Changed

- Active speculative intersection callbacks can retain their signal through near-boundary prediction misses for up to 32 ms, using an additional 6 px release margin and direction and speed checks. Confirmed contact departure, expired input, target removal, and pause or disconnection still cancel immediately. Custom predicates still cancel on their first false result.
- Reduced repeated predictor work by reusing adaptation buffers, validated samples, and projections shared by queries with the same time and horizon.
- The documentation header now reads the library version from its package manifest.
- Updated the interactive demo's card animations and darkened the secondary and muted colors in the light theme.

### Fixed

- Reduced velocity and trajectory jitter during steady pointer movement while preserving responsiveness to turns, braking, and reversals.
- Kept the demo's reset button inside its settings column at narrow viewport widths across platforms.
- Made table resize tests independent of documentation text width while retaining checks for scrolling, keyboard access, masks, and scrollbar removal.
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

[unreleased]: https://github.com/66HEX/hasta/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/66HEX/hasta/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/66HEX/hasta/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/66HEX/hasta/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/66HEX/hasta/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/66HEX/hasta/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/66HEX/hasta/tree/v0.1.0
