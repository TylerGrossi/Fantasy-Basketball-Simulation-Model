"""
Ship the trained Will They Play models to the export (run locally after a retrain).

Writes engine/injury/:
  model.pkl            game-day model + calibration (train.py)
  model_lookahead.pkl  look-ahead model + calibration (train_lookahead.py)
  state.json           every player's record through the training cutoff - what score.py
                       starts from so the export never needs eight seasons of box scores:
      cutoff                      last date in the training data
      players[name_key]           career counters (games on roster / played, split by
                                  second nights of back-to-backs), missed streak, last-10
                                  minutes and starts, games this season, team
      listed["key|status"]        his record when listed with that status  [listed, played]
      team_listed["team|status"]  the team's record                         [listed, played]

The games after the cutoff are added at export time from ESPN (score.py), so the record
stays current between retrains; listing records refresh at the next retrain.

    python scripts/injury/export_state.py
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pandas as pd

from history import roster_games  # noqa: F401  (documents the source of roster_games.csv)
import train as T

OUT = Path(__file__).resolve().parents[2] / "engine" / "injury"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    rg = pd.read_csv(T.DATA / "roster_games.csv", parse_dates=["date"])
    ds = pd.read_csv(T.DATA / "dataset.csv", parse_dates=["date"])
    cutoff = rg["date"].max()

    # THIS season's team games after a player's last appearance (2026-11-03). A roster span
    # ends at his last box score, so a player hurt since then - Kawhi Leonard, out for
    # weeks - showed "missed his last 1 game": every miss before the cutoff fell outside
    # the span. For the current season, his team's later games count as missed.
    this_season = int(rg["season"].max())
    team_games = (rg[rg["season"] == this_season].groupby(["team", "date"])["b2b"].first()
                    .reset_index().sort_values("date"))
    by_team = {t: g for t, g in team_games.groupby("team")}

    players = {}
    for key, g in rg.sort_values("date").groupby("name_key"):
        if int(g["season"].iloc[-1]) == this_season:
            tail = by_team.get(g["team"].iloc[-1])
            if tail is not None:
                tail = tail[tail["date"] > g["date"].iloc[-1]]
                if len(tail):
                    g = pd.concat([g, pd.DataFrame({
                        "date": tail["date"].to_numpy(), "b2b": tail["b2b"].to_numpy(),
                        "played": 0, "minutes": 0.0, "starter": 0, "season": this_season,
                        "team": g["team"].iloc[-1]})], ignore_index=True)
        b = g["b2b"].to_numpy() == 1
        played = g["played"].to_numpy()
        # Missed in a row at the end of the data, and the last ten games he played.
        streak = 0
        for v in played[::-1]:
            if v:
                break
            streak += 1
        last = g[g["played"] == 1].tail(10)
        cur = g[g["season"] == g["season"].max()]
        players[key] = {
            "n": int(len(g)), "p": int(played.sum()),
            "nb": int(b.sum()), "pb": int(played[b].sum()),
            "streak": int(min(streak, 30)),
            "mins": [round(float(x), 1) for x in last["minutes"]],
            "starts": [int(x) for x in last["starter"]],
            "season": int(g["season"].max()),
            "season_games": int(len(cur)),
            "team": str(g["team"].iloc[-1]),
            "last": str(g["date"].iloc[-1].date()),
        }

    listed = ds.groupby(["name_key", "status"])["played"].agg(["size", "sum"])
    team_listed = ds.groupby(["team", "status"])["played"].agg(["size", "sum"])
    league = ds.groupby("status")["played"].agg(["size", "sum"])
    state = {
        "cutoff": str(cutoff.date()),
        "players": players,
        "listed": {f"{k}|{s}": [int(r["size"]), int(r["sum"])] for (k, s), r in listed.iterrows()},
        "team_listed": {f"{k}|{s}": [int(r["size"]), int(r["sum"])] for (k, s), r in team_listed.iterrows()},
        "league_listed": {s: [int(r["size"]), int(r["sum"])] for s, r in league.iterrows()},
    }
    (OUT / "state.json").write_text(json.dumps(state, separators=(",", ":")))
    for f in ("model.pkl", "model_lookahead.pkl"):
        shutil.copy(T.DATA / f, OUT / f)
    sizes = {p.name: f"{p.stat().st_size / 1024:.0f} KB" for p in OUT.iterdir()}
    print(f"cutoff {state['cutoff']}, {len(players)} players -> {OUT}: {sizes}")


if __name__ == "__main__":
    main()
