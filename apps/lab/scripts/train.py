"""Train and evaluate the Hasta cursor-intent MLP using participant-grouped splits and chronological replay."""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np


# Exact D4 dihedral symmetry group (rotations & reflections) on cursor-24-12-v2 features.
# Candidate indices:
#   0:dx, 1:dy, 2:dist, 3:w, 4:h, 5:distGap, 6:vx, 7:vy, 8:speed, 9:acc,
#   10:dirChange, 11:age, 12:cos, 13:sin, 14:close32, 15:close96,
#   16:lag64, 17:lag128, 18:rayDist, 19:ttca, 20:disp, 21:path, 22:straight, 23:cov
# None indices:
#   0:vx, 1:vy, 2:speed, 3:acc, 4:dirChange, 5:age, 6:cov, 7:straight,
#   8:minDist, 9:maxCos, 10:maxClose32, 11:logCount
def apply_dihedral(
    cand: np.ndarray, none: np.ndarray, sym: int
) -> tuple[np.ndarray, np.ndarray]:
    if sym == 0:
        return cand, none
    c = cand.copy()
    n = none.copy()
    swap = (sym & 4) != 0
    flip_x = (sym & 1) != 0
    flip_y = (sym & 2) != 0
    handedness = 1.0

    if swap:
        c[:, [0, 1]] = c[:, [1, 0]]
        c[:, [3, 4]] = c[:, [4, 3]]
        c[:, [6, 7]] = c[:, [7, 6]]
        n[[0, 1]] = n[[1, 0]]
        handedness *= -1.0
    if flip_x:
        c[:, 0] *= -1.0
        c[:, 6] *= -1.0
        n[0] *= -1.0
        handedness *= -1.0
    if flip_y:
        c[:, 1] *= -1.0
        c[:, 7] *= -1.0
        n[1] *= -1.0
        handedness *= -1.0
    if handedness < 0.0:
        c[:, [10, 13, 16, 17]] *= -1.0
        n[4] *= -1.0
    return c, n


def init_mlp(rng: np.random.Generator, dims: list[int]) -> list[np.ndarray]:
    params: list[np.ndarray] = []
    for fan_in, fan_out in zip(dims[:-1], dims[1:]):
        scale = np.sqrt(2.0 / fan_in) if fan_out > 1 else np.sqrt(1.0 / fan_in)
        params.append(rng.normal(0.0, scale, (fan_in, fan_out)))
        params.append(np.zeros(fan_out, dtype=np.float64))
    return params


def forward_mlp(x: np.ndarray, params: list[np.ndarray]) -> tuple[np.ndarray, list[np.ndarray]]:
    activations = [x]
    h = x
    layers = len(params) // 2
    for idx in range(layers):
        w, b = params[2 * idx], params[2 * idx + 1]
        z = h @ w + b
        if idx < layers - 1:
            h = np.maximum(0.0, z)
            activations.append(h)
        else:
            return z.ravel(), activations
    raise RuntimeError("Empty MLP")


def backward_mlp(
    d_out: np.ndarray, activations: list[np.ndarray], params: list[np.ndarray]
) -> list[np.ndarray]:
    grads: list[np.ndarray] = [np.empty(0)] * len(params)
    layers = len(params) // 2
    dg = d_out[:, None]
    for idx in range(layers - 1, -1, -1):
        h_prev = activations[idx]
        w = params[2 * idx]
        grads[2 * idx] = h_prev.T @ dg
        grads[2 * idx + 1] = dg.sum(axis=0)
        if idx > 0:
            dg = (dg @ w.T) * (h_prev > 0.0)
    return grads


class IntentModel:
    def __init__(self, seed: int = 17) -> None:
        rng = np.random.default_rng(seed)
        # 24 -> 32 -> 16 -> 1 (1345 params) + 12 -> 16 -> 1 (225 params) = 1570 params
        self.cand = init_mlp(rng, [24, 32, 16, 1])
        self.none = init_mlp(rng, [12, 16, 1])
        self.temperature = 1.0
        self.cm = np.zeros(24, dtype=np.float64)
        self.cs = np.ones(24, dtype=np.float64)
        self.nm = np.zeros(12, dtype=np.float64)
        self.ns = np.ones(12, dtype=np.float64)

    def all_params(self) -> list[np.ndarray]:
        return self.cand + self.none

    def parameter_count(self) -> int:
        return sum(p.size for p in self.all_params())

    def fit_normalization(self, rows: list[dict[str, Any]]) -> None:
        c_sum = np.zeros(24, dtype=np.float64)
        c_sq = np.zeros(24, dtype=np.float64)
        c_w = 0.0
        n_sum = np.zeros(12, dtype=np.float64)
        n_sq = np.zeros(12, dtype=np.float64)
        n_w = 0.0
        for row in rows:
            w = float(row["weight"])
            c = np.asarray(row["candidate"], dtype=np.float64)
            n = np.asarray(row["none"], dtype=np.float64)
            c_sum += w * c.mean(axis=0)
            c_sq += w * (c**2).mean(axis=0)
            c_w += w
            n_sum += w * n
            n_sq += w * (n**2)
            n_w += w
        self.cm = c_sum / max(c_w, 1e-12)
        self.cs = np.maximum(np.sqrt(np.maximum(c_sq / max(c_w, 1e-12) - self.cm**2, 0.0)), 1e-6)
        self.nm = n_sum / max(n_w, 1e-12)
        self.ns = np.maximum(np.sqrt(np.maximum(n_sq / max(n_w, 1e-12) - self.nm**2, 0.0)), 1e-6)

    def logits(self, cand_raw: np.ndarray, none_raw: np.ndarray) -> np.ndarray:
        c = (cand_raw - self.cm) / self.cs
        n = ((none_raw - self.nm) / self.ns)[None, :]
        cs, _ = forward_mlp(c, self.cand)
        ns, _ = forward_mlp(n, self.none)
        return np.concatenate([cs, ns])

    def probs(self, cand_raw: np.ndarray, none_raw: np.ndarray) -> np.ndarray:
        z = self.logits(cand_raw, none_raw) / self.temperature
        e = np.exp(z - z.max())
        return e / e.sum()

    def clone_weights(self) -> tuple[list[np.ndarray], list[np.ndarray]]:
        return [p.copy() for p in self.cand], [p.copy() for p in self.none]

    def load_weights(self, state: tuple[list[np.ndarray], list[np.ndarray]]) -> None:
        self.cand = [p.copy() for p in state[0]]
        self.none = [p.copy() for p in state[1]]


def evaluate_nll(model: IntentModel, rows: list[dict[str, Any]], temperature: float | None = None) -> float:
    temp = model.temperature if temperature is None else temperature
    total = 0.0
    weights = 0.0
    for row in rows:
        z = model.logits(np.asarray(row["candidate"], dtype=np.float64), np.asarray(row["none"], dtype=np.float64)) / temp
        z = z - z.max()
        log_p = z[row["label"]] - np.log(np.exp(z).sum())
        w = float(row["weight"])
        total -= w * log_p
        weights += w
    return total / max(weights, 1e-12)


def fit_temperature(model: IntentModel, val_rows: list[dict[str, Any]]) -> float:
    if not val_rows:
        return 1.0
    logits_list = [
        (
            model.logits(
                np.asarray(r["candidate"], dtype=np.float64),
                np.asarray(r["none"], dtype=np.float64),
            ),
            int(r["label"]),
            float(r["weight"]),
        )
        for r in val_rows
    ]

    def loss_at(t: float) -> float:
        tot, ws = 0.0, 0.0
        for z, label, w in logits_list:
            s = z / t
            s = s - s.max()
            tot -= w * (s[label] - np.log(np.exp(s).sum()))
            ws += w
        return tot / max(ws, 1e-12)

    grid = np.geomspace(0.25, 4.0, 49)
    best_t = float(min(grid, key=loss_at))
    fine = np.linspace(max(0.15, best_t * 0.8), best_t * 1.25, 25)
    best_t = float(min(fine, key=loss_at))
    model.temperature = best_t
    return best_t


def train_model(
    train_rows: list[dict[str, Any]],
    val_rows: list[dict[str, Any]],
    *,
    seed: int = 17,
    epochs: int = 80,
    batch_size: int = 128,
    lr: float = 1e-3,
    weight_decay: float = 1e-4,
    patience: int = 10,
    augment: bool = True,
) -> tuple[IntentModel, dict[str, float]]:
    model = IntentModel(seed=seed)
    model.fit_normalization(train_rows)
    rng = np.random.default_rng(seed + 1009)

    prepared = [
        (
            np.asarray(r["candidate"], dtype=np.float64),
            np.asarray(r["none"], dtype=np.float64),
            int(r["label"]),
            float(r["weight"]),
        )
        for r in train_rows
    ]

    params = model.all_params()
    m = [np.zeros_like(p) for p in params]
    v = [np.zeros_like(p) for p in params]
    step = 0
    best_val = float("inf")
    best_state = model.clone_weights()
    best_epoch = 0
    stale = 0

    for ep in range(1, epochs + 1):
        order = rng.permutation(len(prepared))
        for start in range(0, len(order), batch_size):
            batch_idx = order[start : start + batch_size]
            acc_grads = [np.zeros_like(p) for p in params]
            w_sum = 0.0
            for i in batch_idx:
                c_raw, n_raw, label, weight = prepared[i]
                if augment:
                    sym = int(rng.integers(0, 8))
                    c_raw, n_raw = apply_dihedral(c_raw, n_raw, sym)
                c = (c_raw - model.cm) / model.cs
                n = ((n_raw - model.nm) / model.ns)[None, :]
                cs, c_act = forward_mlp(c, model.cand)
                ns, n_act = forward_mlp(n, model.none)
                logits = np.concatenate([cs, ns])
                probs = np.exp(logits - logits.max())
                probs /= probs.sum()
                probs[label] -= 1.0
                d_logits = probs * weight
                g_cand = backward_mlp(d_logits[:-1], c_act, model.cand)
                g_none = backward_mlp(d_logits[-1:], n_act, model.none)
                for acc, g in zip(acc_grads, g_cand + g_none):
                    acc += g
                w_sum += weight

            step += 1
            scale = 1.0 / max(w_sum, 1e-12)
            for idx, (p, g) in enumerate(zip(params, acc_grads)):
                grad = g * scale
                if p.ndim == 2:
                    grad = grad + weight_decay * p
                m[idx] = 0.9 * m[idx] + 0.1 * grad
                v[idx] = 0.999 * v[idx] + 0.001 * (grad * grad)
                m_hat = m[idx] / (1.0 - 0.9**step)
                v_hat = v[idx] / (1.0 - 0.999**step)
                p -= lr * m_hat / (np.sqrt(v_hat) + 1e-8)

        val_loss = evaluate_nll(model, val_rows) if val_rows else evaluate_nll(model, train_rows)
        if val_loss < best_val - 1e-5:
            best_val = val_loss
            best_state = model.clone_weights()
            best_epoch = ep
            stale = 0
        else:
            stale += 1
            if stale >= patience:
                break

    model.load_weights(best_state)
    temp = fit_temperature(model, val_rows)
    return model, {
        "bestEpoch": best_epoch,
        "trainNll": evaluate_nll(model, train_rows),
        "valNll": evaluate_nll(model, val_rows) if val_rows else float("nan"),
        "temperature": temp,
    }


def evaluate_policy_on_replays(
    model: IntentModel | None,
    replays: list[dict[str, Any]],
    *,
    threshold: float = 0.7,
    margin: float = 0.1,
    stable_ms: float = 30.0,
) -> dict[str, Any]:
    """Chronological one-action replay for ML (model != None) or native Hasta baseline (model is None)."""
    total = len(replays)
    select_trials = 0
    none_trials = 0
    correct = 0
    wrong = 0
    none_wrong = 0
    abstained = 0
    useful_leads: list[float] = []
    raw_leads: list[float] = []
    cov50 = cov100 = cov200 = 0

    for trial in replays:
        is_none = trial["selectedIndex"] == trial["count"]
        if is_none:
            none_trials += 1
        else:
            select_trials += 1
        cutoff = float(trial["cutoff"])

        fired_target: int | None = None
        fired_at: float | None = None

        if model is None:
            for cb in trial["baselineCallbacks"]:
                if float(cb["at"]) < cutoff:
                    fired_target = int(cb["targetIndex"])
                    fired_at = float(cb["at"])
                    break
        else:
            winner: int | None = None
            winner_since: float | None = None
            for frame in trial["frames"]:
                at = float(frame["at"])
                if at >= cutoff:
                    break
                probs = model.probs(
                    np.asarray(frame["candidate"], dtype=np.float64),
                    np.asarray(frame["none"], dtype=np.float64),
                )
                order = np.argsort(probs)[::-1]
                best = int(order[0])
                second = int(order[1])
                inside = frame["inside"]
                # Block speculative callbacks for `none` or for targets already under the cursor
                qualifies = (
                    best < trial["count"]
                    and not inside[best]
                    and float(probs[best]) >= threshold
                    and float(probs[best] - probs[second]) >= margin
                )
                if qualifies:
                    if winner == best and winner_since is not None:
                        if at - winner_since >= stable_ms:
                            fired_target = best
                            fired_at = at
                            break
                    else:
                        winner = best
                        winner_since = at
                        if stable_ms <= 0.0:
                            fired_target = best
                            fired_at = at
                            break
                else:
                    winner = None
                    winner_since = None

        if fired_target is None or fired_at is None:
            abstained += 1
            if not is_none:
                useful_leads.append(0.0)
        elif not is_none and fired_target == trial["selectedIndex"]:
            correct += 1
            lead = max(0.0, cutoff - fired_at)
            raw_leads.append(lead)
            useful_leads.append(min(300.0, lead))
            if lead >= 50.0:
                cov50 += 1
            if lead >= 100.0:
                cov100 += 1
            if lead >= 200.0:
                cov200 += 1
        else:
            wrong += 1
            if is_none:
                none_wrong += 1
            else:
                useful_leads.append(0.0)

    return {
        "trials": total,
        "selectTrials": select_trials,
        "noneTrials": none_trials,
        "correct": correct,
        "wrong": wrong,
        "abstained": abstained,
        "wrongPer100": (100.0 * wrong / total) if total else 0.0,
        "noneWrongRate": (none_wrong / none_trials) if none_trials else 0.0,
        "usefulLeadMs": float(np.mean(useful_leads)) if useful_leads else 0.0,
        "medianHitLeadMs": float(np.median(raw_leads)) if raw_leads else 0.0,
        "coverage50": (cov50 / select_trials) if select_trials else 0.0,
        "coverage100": (cov100 / select_trials) if select_trials else 0.0,
        "coverage200": (cov200 / select_trials) if select_trials else 0.0,
    }


def select_policy(
    model: IntentModel, val_replays: list[dict[str, Any]], budget_per_100: float = 5.0
) -> tuple[dict[str, float], dict[str, Any]]:
    best_cfg = {"threshold": 0.99, "margin": 0.2, "stableMs": 60.0}
    best_metrics: dict[str, Any] | None = None

    for threshold in [0.5, 0.6, 0.7, 0.8, 0.9, 0.95]:
        for margin in [0.0, 0.1, 0.2]:
            for stable_ms in [0.0, 30.0, 60.0]:
                metrics = evaluate_policy_on_replays(
                    model, val_replays, threshold=threshold, margin=margin, stable_ms=stable_ms
                )
                if metrics["wrongPer100"] <= budget_per_100:
                    if best_metrics is None or (
                        metrics["usefulLeadMs"],
                        -metrics["wrongPer100"],
                        metrics["coverage100"],
                    ) > (
                        best_metrics["usefulLeadMs"],
                        -best_metrics["wrongPer100"],
                        best_metrics["coverage100"],
                    ):
                        best_metrics = metrics
                        best_cfg = {
                            "threshold": threshold,
                            "margin": margin,
                            "stableMs": stable_ms,
                        }

    if best_metrics is None:
        best_metrics = evaluate_policy_on_replays(
            model,
            val_replays,
            threshold=best_cfg["threshold"],
            margin=best_cfg["margin"],
            stable_ms=best_cfg["stableMs"],
        )
    return best_cfg, best_metrics


def main() -> None:
    parser = argparse.ArgumentParser(description="Train and evaluate Hasta cursor-intent MLP.")
    parser.add_argument("dataset", type=Path, help="Prepared dataset directory from prepare.mjs")
    parser.add_argument("--out", required=True, type=Path, help="Output JSON model & report path")
    parser.add_argument("--seed", type=int, default=17)
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--budget", type=float, default=5.0, help="Max wrong callbacks / 100 trials")
    parser.add_argument("--no-augment", action="store_true", help="Disable D4 symmetry augmentation")
    parser.add_argument("--allow-automated", action="store_true", help="Allow automated test data")
    args = parser.parse_args()

    manifest = json.loads((args.dataset / "manifest.json").read_text())
    if manifest.get("automated") and not args.allow_automated:
        raise SystemExit(
            "Dataset contains automated recordings. Pass --allow-automated only for pipeline checks."
        )

    examples = [
        json.loads(line)
        for line in (args.dataset / "examples.jsonl").read_text().splitlines()
        if line.strip()
    ]
    replays = [
        json.loads(line)
        for line in (args.dataset / "replay.jsonl").read_text().splitlines()
        if line.strip()
    ]
    if not examples or not replays:
        raise SystemExit("Dataset has no eligible examples or replay trials.")

    participants = sorted({row["participant"] for row in examples})
    augment = not args.no_augment
    folds_report: list[dict[str, Any]] = []

    if len(participants) >= 3:
        for fold_idx, test_p in enumerate(participants):
            others = [p for p in participants if p != test_p]
            val_p = others[fold_idx % len(others)]
            train_ps = {p for p in others if p != val_p}

            tr_ex = [r for r in examples if r["participant"] in train_ps]
            va_ex = [r for r in examples if r["participant"] == val_p]
            va_rp = [r for r in replays if r["participant"] == val_p]
            te_rp = [r for r in replays if r["participant"] == test_p]

            model, info = train_model(
                tr_ex, va_ex, seed=args.seed + fold_idx, epochs=args.epochs, augment=augment
            )
            policy, _ = select_policy(model, va_rp, budget_per_100=args.budget)
            ml_test = evaluate_policy_on_replays(
                model,
                te_rp,
                threshold=policy["threshold"],
                margin=policy["margin"],
                stable_ms=policy["stableMs"],
            )
            base_test = evaluate_policy_on_replays(None, te_rp)
            folds_report.append(
                {
                    "testParticipant": test_p,
                    "valParticipant": val_p,
                    "training": info,
                    "policy": policy,
                    "ml": ml_test,
                    "baseline": base_test,
                }
            )

    # Train final exportable model (holding out last participant for calibration/policy if >=2 people)
    if len(participants) >= 2:
        val_p = participants[-1]
        tr_ex = [r for r in examples if r["participant"] != val_p]
        va_ex = [r for r in examples if r["participant"] == val_p]
        va_rp = [r for r in replays if r["participant"] == val_p]
    else:
        tr_ex = examples
        va_ex = examples
        va_rp = replays

    final_model, final_info = train_model(
        tr_ex, va_ex, seed=args.seed, epochs=args.epochs, augment=augment
    )
    final_policy, final_val_metrics = select_policy(final_model, va_rp, budget_per_100=args.budget)
    baseline_all = evaluate_policy_on_replays(None, replays)

    by_layout: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in replays:
        by_layout[r["layout"]].append(r)

    artifact = {
        "protocol": manifest["protocol"],
        "featureVersion": manifest["featureVersion"],
        "automated": bool(manifest.get("automated", False)),
        "build": manifest["build"],
        "architecture": {"candidate": [24, 32, 16, 1], "none": [12, 16, 1]},
        "parameters": final_model.parameter_count(),
        "participants": participants,
        "augmentD4": augment,
        "training": final_info,
        "recommendedPolicy": final_policy,
        "validationMetrics": final_val_metrics,
        "baselineAll": baseline_all,
        "lopoFolds": folds_report,
        "layoutCounts": {k: len(v) for k, v in sorted(by_layout.items())},
        "normalization": {
            "candidateMean": final_model.cm.tolist(),
            "candidateScale": final_model.cs.tolist(),
            "noneMean": final_model.nm.tolist(),
            "noneScale": final_model.ns.tolist(),
        },
        "temperature": final_model.temperature,
        "weights": {
            "candidate": [p.tolist() for p in final_model.cand],
            "none": [p.tolist() for p in final_model.none],
        },
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(artifact, indent=2) + "\n")
    summary = {
        "parameters": artifact["parameters"],
        "participants": len(participants),
        "lopoFolds": len(folds_report),
        "training": final_info,
        "recommendedPolicy": final_policy,
        "validationMetrics": final_val_metrics,
        "baselineAll": baseline_all,
        "out": str(args.out.resolve()),
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
