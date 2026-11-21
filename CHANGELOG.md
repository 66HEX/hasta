# Changelog

Notable changes to Hasta, grouped by release.

This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.1] - 2026-11-21

### Added

- Unit, browser, and framework regression tests covering every fix below.

### Changed

- Updated `@66hex/hasta/solid` and its `solid-js` peer dependency (`>=2.0 <3`) for Solid 2.0 (`onSettled`, split `createEffect`, and `runWithOwner`-deferred ref cleanup).
- Replacing only a predicate function through a controller target binding (`binding.update()`) now schedules a re-evaluation only while pointer input is active and no longer invalidates the target's cached geometry.
- Improved Kalman predictor performance by caching the shared projection for multiple horizons at the same timestamp and precomputing the measurement standard deviation.
- Improved `GridIndex` performance with packed numeric cell keys instead of string keys and queries that run without temporary arrays.
- Reduced per-frame allocations in the frame loop: there is no `Map` of forecasts for a single horizon, no `Object.values().every()`, no temporary query rectangles, no intersection caches for targets with a single rule, and no ShadowRoot set for pure light DOM. Intersection events are now built and frozen only when a callback actually fires (`Subscription.prepare()` / `commit()`).
- With `bounds: 'cached'` and no active rules, frames now evaluate only the targets returned by the spatial query instead of scanning every registered target.
- The debug overlay now compares cache keys structurally instead of using `JSON.stringify`, reuses a persistent `motion` layer, and only updates SVG/DOM attributes when their values change.
- `GeometryCache.consume()` and `observeRoots()` now skip allocations when there are no animations or shadow roots.

### Fixed

- A predicate that throws now aborts the active callback with `AbortSignal.reason === 'error'` instead of `'miss'`.
- `createHasta([])` and subscription options passed as `null`, arrays, or primitives now throw a `TypeError` instead of being silently accepted or failing later.
- A pointer switch rejected by the sample filter (unsupported `pointerType`, stale timestamp) no longer leaves the engine bound to the rejected `pointerId`.
- Synchronous nested frames (for example, a predicate dispatching input and flushing a frame) now track nesting depth, so the inner frame no longer flushes queued samples into the predictor while the outer frame is still evaluating.
- `untrack()` no longer invalidates all cached geometry (with `bounds: 'cached'`, the remaining targets are not re-measured), and scroll listeners on shadow roots that are no longer used are removed.
- Exhausted `once` intersection rules no longer widen the frame's maximum horizon and margin, and release hysteresis is reset when a target loses its bounds or forecast.
- The debug overlay no longer rewrites `data-hasta-status` on every frame; previously this triggered `MutationObserver` and invalidated cached geometry while debugging.
- React refs roll back `node.current` when the binding rejects an element. Vue refs throw a clean `TypeError` for `undefined` and primitive values. Solid no longer attaches a replacement binding early while a deferred attach is pending.

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

[unreleased]: https://github.com/66HEX/hasta/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/66HEX/hasta/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/66HEX/hasta/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/66HEX/hasta/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/66HEX/hasta/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/66HEX/hasta/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/66HEX/hasta/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/66HEX/hasta/tree/v0.1.0
