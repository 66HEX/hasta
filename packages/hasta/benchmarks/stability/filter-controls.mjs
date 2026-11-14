import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const FILTER_CONTROLS = Object.freeze(['fa9ac8d', '0a503bb', '5cf01cf']);

export async function loadFilterControl(name = 'fa9ac8d') {
  if (!FILTER_CONTROLS.includes(name)) {
    throw new Error(`Unknown frozen filter control: ${name}.`);
  }

  const root = new URL(`./baseline-${name}/`, import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));

  for (const [file, expected] of Object.entries(manifest.sha256)) {
    const actual = createHash('sha256')
      .update(await readFile(new URL(file, root)))
      .digest('hex');

    if (actual !== expected) {
      throw new Error(`Frozen control changed: ${name}/${file}.`);
    }
  }

  if (name !== 'fa9ac8d') {
    for (const [file, expected] of Object.entries(manifest.sourceSha256)) {
      const actual = createHash('sha256')
        .update(await readFile(new URL(`src/${file}`, root)))
        .digest('hex');

      if (actual !== expected) {
        throw new Error(`Frozen control source changed: ${name}/${file}.`);
      }
    }
  }

  const { KalmanPredictor } = await import(new URL('core/prediction/kalman-predictor.js', root));

  return {
    name,
    commit: manifest.baseCommit,
    description:
      name === 'fa9ac8d'
        ? 'Frozen fa9ac8d original Kalman predictor; current callback policy, not the frozen legacy Subscription.'
        : name === '0a503bb'
          ? 'Frozen 0a503bb accepted dense-input innovation weighting; current callback policy is identical on both sides.'
          : 'Frozen 5cf01cf accepted sparse-input correction; current callback policy is identical on both sides.',
    sourceFiles: [
      `benchmarks/stability/baseline-${name}/manifest.json`,
      ...Object.keys(manifest.sha256).map(
        (file) => `benchmarks/stability/baseline-${name}/${file}`,
      ),
      ...(name === 'fa9ac8d'
        ? []
        : Object.keys(manifest.sourceSha256).map(
            (file) => `benchmarks/stability/baseline-${name}/src/${file}`,
          )),
    ],
    create: () => new KalmanPredictor(),
  };
}
