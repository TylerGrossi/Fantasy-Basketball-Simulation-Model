"""
The LOOK-AHEAD Will They Play model: a player's chance of playing a game no injury report
covers yet - Sunday's game, asked on Wednesday. This is where back-to-backs earn their
keep: on game day a rest night is usually already on the report ("Out - Rest"), but days
ahead the only warning is the schedule and the player's habit (Kawhi Leonard plays 83% of
normal nights and 49% of second nights; Jokic barely changes).

Rows: every regular-season team game a player averaging 15+ minutes was on the roster for
(history.py, written by build_dataset.py as roster_games.csv). Features are his record
going into the game - nothing from that night. Walk-forward by season with the same
held-out calibration as train.py. Baseline: his own availability rate (avail_rate).

    python scripts/injury/train_lookahead.py
"""

from __future__ import annotations

import json
import pickle

import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression

import train as T

T.CATS = []
T.NUMS = ["b2b", "rest_gap", "b2b_rest", "avail_rate", "missed_streak", "min_avg10", "home", "month"]


def main() -> None:
    rg = pd.read_csv(T.DATA / "roster_games.csv", parse_dates=["date"])
    df = rg[(rg["season_type"] == 2) & (rg["min_avg10"] >= 15)].copy()
    df["b2b_rest"] = df["b2b"] * df["rest_gap"]
    df["month"] = df["date"].dt.month
    seasons = sorted(df["season"].unique())
    print(f"{len(df)} player-games, seasons {seasons}")
    g = df.groupby("b2b")["played"].mean()
    print(f"play rate: other nights {g[0]:.3f}, second night of a back-to-back {g[1]:.3f}")

    preds = []
    for s in seasons[3:]:
        tr, te = df[df["season"] < s], df[df["season"] == s]
        raw, cal = T.fit_calibrated(tr, te, s)
        y = te["played"].to_numpy()
        base = te["avail_rate"].to_numpy()
        b = te["b2b"].to_numpy() == 1
        print(f"  {s}-{str(s + 1)[2:]}: n={len(te):6d}  log loss model {T.metrics(y, cal)['log_loss']:.4f} "
              f"vs baseline {T.metrics(y, base)['log_loss']:.4f}  |  2nd nights: "
              f"{T.metrics(y[b], cal[b])['log_loss']:.4f} vs {T.metrics(y[b], base[b])['log_loss']:.4f}")
        preds.append(te.assign(p=cal, base=base))

    allp = pd.concat(preds)
    y, p, base = allp["played"].to_numpy(), allp["p"].to_numpy(), allp["base"].to_numpy()
    b = allp["b2b"].to_numpy() == 1
    report = {
        "rows": int(len(df)),
        "pooled": {"model": T.metrics(y, p), "baseline": T.metrics(y, base),
                   "b2b_model": T.metrics(y[b], p[b]), "b2b_baseline": T.metrics(y[b], base[b])},
        "calibration": T.calibration(y, p),
    }
    P = report["pooled"]
    print("\nPOOLED")
    for k in P:
        print(f"  {k:13s} log loss {P[k]['log_loss']:.4f}  brier {P[k]['brier']:.4f}  AUC {P[k]['auc']:.3f}")
    print("\nCalibration (predicted vs actual):")
    for r in report["calibration"]:
        print(f"  {r['bin']}  n={r['n']:6d}  predicted {r['predicted']:.2f}  actual {r['actual']:.2f}")

    # Does it learn the habit? Predicted vs actual, normal vs second nights, for known cases.
    print("\nBy player, test seasons (predicted / actual):")
    for name in ["kawhileonard", "stephencurry", "joelembiid", "lebronjames", "nikolajokic"]:
        q = allp[allp["name_key"] == name]
        if len(q):
            r = q.groupby("b2b").agg(pred=("p", "mean"), act=("played", "mean"), n=("played", "size"))
            parts = [f"{'2nd night' if k else 'other'} {v.pred:.2f}/{v.act:.2f} (n={int(v.n)})" for k, v in r.iterrows()]
            print(f"  {name:14s} " + "   ".join(parts))

    (T.DATA / "report_lookahead.json").write_text(json.dumps(report, indent=2))

    # Final model + its calibration map, as in train.py.
    X_all, _ = T.encode(df, df.head(1))
    final = T.model().fit(X_all, df["played"])
    last = seasons[-1] if (df["season"] == seasons[-1]).sum() > 20000 else seasons[-2]
    early, cal = df[df["season"] < last], df[df["season"] == last]
    X_e, X_c = T.encode(early, cal)
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.001, y_max=0.999).fit(
        T.model().fit(X_e, early["played"]).predict_proba(X_c)[:, 1], cal["played"])
    with open(T.DATA / "model_lookahead.pkl", "wb") as f:
        pickle.dump({"model": final, "calibration": iso, "nums": T.NUMS, "cats": [],
                     "trained_through": str(df["date"].max().date())}, f)
    print(f"\nfinal look-ahead model -> {T.DATA / 'model_lookahead.pkl'}")


if __name__ == "__main__":
    main()
