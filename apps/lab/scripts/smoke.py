"""Exercise feature normalization and a tiny shared scorer. Not a model evaluation."""
import argparse
import json
from pathlib import Path
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('dataset', type=Path)
parser.add_argument('--out', required=True, type=Path)
args = parser.parse_args()
manifest = json.loads((args.dataset / 'manifest.json').read_text())
if not manifest['automated'] or not all(item['automated'] for item in manifest['sessions']):
    raise SystemExit('This smoke test requires explicitly marked automated recordings.')
rows = [json.loads(line) for line in (args.dataset / 'examples.jsonl').read_text().splitlines() if line]
if not rows:
    raise SystemExit('No eligible examples.')
# Fixed subsample keeps the smoke test short. This is a training check, not a held-out score.
rows = rows[::max(1, len(rows) // 600)]
rng = np.random.default_rng(19)
candidate = np.array([item for row in rows for item in row['candidate']], dtype=np.float64)
none = np.array([row['none'] for row in rows], dtype=np.float64)
cm, cs = candidate.mean(0), np.maximum(candidate.std(0), 1e-6)
nm, ns = none.mean(0), np.maximum(none.std(0), 1e-6)
models = []
for inputs, hidden in [(24, 16), (12, 8)]:
    models.append([rng.normal(0, 0.1, (inputs, hidden)), np.zeros(hidden), rng.normal(0, 0.1, (hidden, 1)), np.zeros(1)])
examples = [((np.array(row['candidate']) - cm) / cs, ((np.array(row['none']) - nm) / ns)[None, :], row['label'], row['weight']) for row in rows]

def forward(x, model):
    w, b, v, c = model
    hidden = np.maximum(0, x @ w + b)
    return (hidden @ v + c).ravel(), hidden


def epoch(rate):
    total, weights = 0.0, 0.0
    for index in rng.permutation(len(examples)):
        x, n, label, weight = examples[index]
        scores, h = forward(x, models[0])
        no_score, nh = forward(n, models[1])
        logits = np.concatenate([scores, no_score])
        probs = np.exp(logits - logits.max())
        probs /= probs.sum()
        total -= weight * np.log(max(probs[label], 1e-12))
        weights += weight
        if rate:
            probs[label] -= 1
            # Trial weights prevent long movements from dominating the optimizer.
            gradient = probs * weight * 12
            for values, hidden, grad, model in [(x, h, gradient[:-1], models[0]), (n, nh, gradient[-1:], models[1])]:
                w, b, v, c = model
                dg = grad[:, None]
                dh = (dg @ v.T) * (hidden > 0)
                gradients = [values.T @ dh, dh.sum(0), hidden.T @ dg, dg.sum(0)]
                for parameter, delta in zip(model, gradients):
                    parameter -= rate * np.clip(delta, -5, 5)
    return total / weights

initial = epoch(0)
for _ in range(40):
    epoch(0.006)
final = epoch(0)
if not np.isfinite(final) or final >= initial:
    raise SystemExit(f'Training smoke check failed: {initial} -> {final}')
result = {'purpose': 'pipeline-smoke-only; automated motion; no estimate of human accuracy', 'featureVersion': manifest['featureVersion'], 'examples': len(examples), 'parameters': sum(p.size for model in models for p in model), 'initialTrainingLoss': initial, 'finalTrainingLoss': final,
          'normalization': {'candidateMean': cm.tolist(), 'candidateScale': cs.tolist(), 'noneMean': nm.tolist(), 'noneScale': ns.tolist()}, 'weights': [[p.tolist() for p in model] for model in models]}
args.out.parent.mkdir(parents=True, exist_ok=True)
with args.out.open('x') as output:
    json.dump(result, output, indent=2)
print(json.dumps({key: result[key] for key in ['purpose', 'parameters', 'initialTrainingLoss', 'finalTrainingLoss']}, indent=2))
