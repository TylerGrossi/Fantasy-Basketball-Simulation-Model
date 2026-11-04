"""
Train and evaluate the Will They Play model on dataset.csv (build_dataset.py).

WALK-FORWARD, BY SEASON. For each test season S the model is fit on every season before S
and scored on S alone - the way it will be used (trained on the past, run on a season it
has not seen). Never a random split: rows from the same injury stretch on both sides of a
random split would flatter it.

THE BAR TO CLEAR is the baseline the app could ship tomorrow without a model: "players
listed Questionable played X% of the time" - the play rate for each status, from the same
training seasons. The model is only worth wiring into the win probability if it beats that
on log loss AND stays calibrated (when it says 60%, about 60% play).

Writes %LOCALAPPDATA%/fbbsim-injury-data/report.json and prints the summary.

    python scripts/injury/train.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.inspection import permutation_importance
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score

DATA = Path(os.environ.get("LOCALAPPDATA", ".")) / "fbbsim-injury-data"
CATS = ["status", "kind", "body", "severity"]
NUMS = ["missed_streak", "b2b", "home", "min_avg10", "starter_rate10", "games_season",
        "month", "playoffs", "player_rate", "team_rate", "avail_rate", "rest_gap", "b2b_rest"]
STATUS_ORDER = ["Out", "Doubtful", "Questionable", "Probable", "Available"]


def encode(train: pd.DataFrame, test: pd.DataFrame):
    """Categories -> integer codes from the TRAINING levels; unseen levels -> missing."""
    X_tr, X_te = train[NUMS].copy(), test[NUMS].copy()
    for c in CATS:
        levels = {v: i for i, v in enumerate(sorted(train[c].unique()))}
        X_tr[c] = train[c].map(levels).astype(float)
        X_te[c] = test[c].map(levels).astype(float)
    return X_tr, X_te


def model():
    cat_mask = [False] * len(NUMS) + [True] * len(CATS)
    return HistGradientBoostingClassifier(
        max_iter=400, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=60,
        l2_regularization=1.0, categorical_features=cat_mask, early_stopping=True,
        validation_fraction=0.15, random_state=0,
    )


def fit_calibrated(tr: pd.DataFrame, te: pd.DataFrame, s: int):
    """CALIBRATION (2026-11-03): the first honest run was overconfident in the middle -
    said 25% where 34% played, 65% where 59% did. So a held-out season maps raw scores to
    observed rates: fit on seasons < s-1, learn the map (isotonic: any monotone curve) on
    season s-1, then refit on everything < s and pass its scores through the map.
    Returns (raw, calibrated) probabilities for `te`."""
    early, cal = tr[tr["season"] < s - 1], tr[tr["season"] == s - 1]
    X_e, X_c = encode(early, cal)
    m1 = model().fit(X_e, early["played"])
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.001, y_max=0.999)
    iso.fit(m1.predict_proba(X_c)[:, 1], cal["played"])
    X_tr, X_te = encode(tr, te)
    m = model().fit(X_tr, tr["played"])
    raw = m.predict_proba(X_te)[:, 1]
    return raw, iso.predict(raw)


def metrics(y, p):
    p = np.clip(p, 1e-4, 1 - 1e-4)
    out = {"n": int(len(y)), "log_loss": log_loss(y, p, labels=[0, 1]),
           "brier": brier_score_loss(y, p), "accuracy": float(((p >= 0.5) == y).mean())}
    out["auc"] = roc_auc_score(y, p) if 0 < y.sum() < len(y) else float("nan")
    return out


def calibration(y, p, bins=10):
    edges = np.linspace(0, 1, bins + 1)
    rows = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (p >= lo) & (p < hi if hi < 1 else p <= hi)
        if m.sum():
            rows.append({"bin": f"{lo:.1f}-{hi:.1f}", "n": int(m.sum()),
                         "predicted": float(p[m].mean()), "actual": float(y[m].mean())})
    return rows


def main() -> None:
    df = pd.read_csv(DATA / "dataset.csv", parse_dates=["date"])
    seasons = sorted(df["season"].unique())
    print(f"{len(df)} rows, seasons {seasons}")
    print(df.groupby("status")["played"].agg(["count", "mean"]).reindex(STATUS_ORDER).round(3).to_string())

    folds = []
    preds = []
    # Three seasons of history: two to fit on, the next one to CALIBRATE on.
    for s in seasons[3:]:
        tr, te = df[df["season"] < s], df[df["season"] == s]
        p_raw, p_model = fit_calibrated(tr, te, s)
        rate = tr.groupby("status")["played"].mean()
        p_base = te["status"].map(rate).fillna(tr["played"].mean()).to_numpy()
        y = te["played"].to_numpy()
        f = {"season": int(s), "model": metrics(y, p_model), "baseline": metrics(y, p_base),
             "raw": metrics(y, p_raw)}
        # Where the decision is actually hard: the uncertain statuses.
        q = te["status"].isin(["Questionable", "Doubtful", "Probable"]).to_numpy()
        f["uncertain_model"] = metrics(y[q], p_model[q])
        f["uncertain_baseline"] = metrics(y[q], p_base[q])
        folds.append(f)
        f["uncertain_raw"] = metrics(y[q], p_raw[q])
        preds.append(te.assign(p_model=p_model, p_base=p_base, p_raw=p_raw))
        print(f"  {s}-{str(s + 1)[2:]}: n={len(te):6d}  log loss model {f['model']['log_loss']:.4f} "
              f"vs baseline {f['baseline']['log_loss']:.4f}  |  Q/D/P only: "
              f"{f['uncertain_model']['log_loss']:.4f} vs {f['uncertain_baseline']['log_loss']:.4f}"
              f" (uncalibrated {f['uncertain_raw']['log_loss']:.4f})")

    allp = pd.concat(preds)
    y = allp["played"].to_numpy()
    q = allp["status"].isin(["Questionable", "Doubtful", "Probable"]).to_numpy()
    report = {
        "rows": int(len(df)),
        "seasons": [int(s) for s in seasons],
        "folds": folds,
        "pooled": {"model": metrics(y, allp["p_model"].to_numpy()),
                   "baseline": metrics(y, allp["p_base"].to_numpy()),
                   "uncertain_model": metrics(y[q], allp["p_model"].to_numpy()[q]),
                   "uncertain_baseline": metrics(y[q], allp["p_base"].to_numpy()[q])},
        "calibration_uncertain": calibration(y[q], allp["p_model"].to_numpy()[q]),
        "by_status": {
            st: {"n": int((allp["status"] == st).sum()),
                 "actual": float(allp.loc[allp["status"] == st, "played"].mean()),
                 "model_mean": float(allp.loc[allp["status"] == st, "p_model"].mean())}
            for st in STATUS_ORDER if (allp["status"] == st).any()
        },
    }

    # What the model leans on, from the last fold (permutation importance on log loss).
    s = seasons[-1]
    tr, te = df[df["season"] < s], df[df["season"] == s]
    X_tr, X_te = encode(tr, te)
    m = model().fit(X_tr, tr["played"])
    imp = permutation_importance(m, X_te, te["played"], scoring="neg_log_loss",
                                 n_repeats=5, random_state=0)
    report["importance"] = sorted(
        ({"feature": c, "drop_in_log_loss": float(v)} for c, v in zip(X_te.columns, imp.importances_mean)),
        key=lambda r: -r["drop_in_log_loss"],
    )

    (DATA / "report.json").write_text(json.dumps(report, indent=2))
    P = report["pooled"]
    print("\nPOOLED over test seasons")
    for k in ("model", "baseline"):
        print(f"  {k:9s} log loss {P[k]['log_loss']:.4f}  brier {P[k]['brier']:.4f}  "
              f"AUC {P[k]['auc']:.3f}  acc {P[k]['accuracy']:.3f}")
    for k in ("uncertain_model", "uncertain_baseline"):
        print(f"  {k:18s} log loss {P[k]['log_loss']:.4f}  brier {P[k]['brier']:.4f}  AUC {P[k]['auc']:.3f}")
    print("\nCalibration, Questionable/Doubtful/Probable (predicted vs actual):")
    for r in report["calibration_uncertain"]:
        print(f"  {r['bin']}  n={r['n']:5d}  predicted {r['predicted']:.2f}  actual {r['actual']:.2f}")
    print("\nTop features:", ", ".join(f"{r['feature']} {r['drop_in_log_loss']:.4f}" for r in report["importance"][:8]))

    # The model the app will run: fit on EVERY season, saved with the category levels it
    # was encoded with (score time must encode identically). Pickled next to the data,
    # not in the repo, until it has passed review.
    import pickle
    X_all, _ = encode(df, df.head(1))
    final = model().fit(X_all, df["played"])
    # Its calibration map: learned the same way, on the last complete season held out.
    last = seasons[-1] if (df["season"] == seasons[-1]).sum() > 3000 else seasons[-2]
    early, cal = df[df["season"] < last], df[df["season"] == last]
    X_e, X_c = encode(early, cal)
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.001, y_max=0.999).fit(
        model().fit(X_e, early["played"]).predict_proba(X_c)[:, 1], cal["played"])
    levels = {c: sorted(df[c].unique()) for c in CATS}
    with open(DATA / "model.pkl", "wb") as f:
        pickle.dump({"model": final, "calibration": iso, "levels": levels, "nums": NUMS, "cats": CATS,
                     "trained_through": str(df["date"].max().date()), "rows": int(len(df))}, f)
    print(f"\nfinal model (all {len(df)} rows, through {df['date'].max().date()}) -> {DATA / 'model.pkl'}")


if __name__ == "__main__":
    main()
