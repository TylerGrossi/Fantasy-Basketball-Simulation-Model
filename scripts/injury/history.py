"""
Every team game a player was on the roster for - played or not - with his running record
going into it. Shared by both Will They Play models.

WHY EXPAND. A player ruled out is usually missing from ESPN's box score altogether, so
counting only box rows makes everyone look available (Embiid "played 94%"). Here a player
is on a team's roster from his first to his last box appearance for it that season, and
every team game in that span is a row; absent = did not play. On that table Embiid plays
68% of regular-season games and 57% of second nights of back-to-backs (2018-26).

RUNNING RECORD (all strictly BEFORE the game - shift(1) - so no row sees itself):
  avail_rate   his share of games played, shrunk toward 0.85 (a 28+ mpg regular's rate)
  rest_gap     how much more often he sits the second night of a back-to-back than other
               nights, shrunk toward 0.06 (the league gap for regulars). Kawhi Leonard ~0.33,
               Jokic ~0.06. 0.06 and 0.85 are measured on the 2018-26 box scores
               (2026-11-03) and used only as shrinkage targets.
  missed_streak team games missed in a row going in
  min_avg10    minutes in his last 10 games played
"""

from __future__ import annotations

import numpy as np
import pandas as pd

PRIOR_AVAIL = 0.85
PRIOR_GAP = 0.06
K_AVAIL = 20.0  # games before his own rate counts half
K_GAP = 15.0    # back-to-backs before his own gap counts half


def season_of(d: pd.Series) -> pd.Series:
    s = np.where(d.dt.month >= 10, d.dt.year, d.dt.year - 1)
    bubble = (d.dt.year == 2020) & (d.dt.month == 10) & (d.dt.day < 15)
    return pd.Series(np.where(bubble, 2019, s), index=d.index)


def roster_games(box: pd.DataFrame) -> pd.DataFrame:
    """box: ESPN rows with date (datetime), season, team, name_key, played, minutes,
    starter, home, season_type. Returns one row per (player, team game on his roster)."""
    tg = (box.groupby(["team", "date"], as_index=False)
             .agg(season=("season", "first"), home=("home", "first"),
                  season_type=("season_type", "first"), opp=("opp", "first"))
             .sort_values(["team", "date"]))
    tg["b2b"] = (tg.groupby("team")["date"].diff() == pd.Timedelta(days=1)).astype(int)

    span = box.groupby(["name_key", "team", "season"])["date"].agg(["min", "max"]).reset_index()
    x = span.merge(tg, on=["team", "season"])
    x = x[(x["date"] >= x["min"]) & (x["date"] <= x["max"])].drop(columns=["min", "max"])
    own = box[["name_key", "team", "date", "played", "minutes", "starter"]].drop_duplicates(
        ["name_key", "team", "date"])
    x = x.merge(own, on=["name_key", "team", "date"], how="left")
    x["played"] = x["played"].fillna(0).astype(int)
    x["minutes"] = x["minutes"].fillna(0.0)
    x["starter"] = x["starter"].fillna(0).astype(int)
    x = x.sort_values(["name_key", "date"]).reset_index(drop=True)
    return add_record(x)


def add_record(x: pd.DataFrame) -> pd.DataFrame:
    g = x.groupby("name_key", sort=False)
    # Cumulative counts strictly before each row (career, all seasons in the data).
    x["_one"] = 1
    x["_b"] = x["b2b"]
    x["_pb"] = x["played"] * x["b2b"]
    x["_n"] = 1 - x["b2b"]
    x["_pn"] = x["played"] * (1 - x["b2b"])
    for c in ["_one", "played", "_b", "_pb", "_n", "_pn"]:
        x["c" + c] = g[c].cumsum() - x[c]
    n_all, p_all = x["c_one"], x["cplayed"]
    x["avail_rate"] = (p_all + K_AVAIL * PRIOR_AVAIL) / (n_all + K_AVAIL)
    p0 = (x["c_pn"] + K_AVAIL * PRIOR_AVAIL) / (x["c_n"] + K_AVAIL)
    p1 = (x["c_pb"] + K_GAP * (p0 - PRIOR_GAP)) / (x["c_b"] + K_GAP)
    x["rest_gap"] = (p0 - p1).clip(-0.3, 0.8)

    # Missed in a row going into this game, and minutes in his last 10 games played.
    streak = np.zeros(len(x), dtype=int)
    mins = np.zeros(len(x))
    keys = x["name_key"].to_numpy()
    played = x["played"].to_numpy()
    minutes = x["minutes"].to_numpy()
    run, last = 0, []
    for i in range(len(x)):
        if i == 0 or keys[i] != keys[i - 1]:
            run, last = 0, []
        streak[i] = min(run, 30)
        mins[i] = np.mean(last) if last else 0.0
        if played[i]:
            run = 0
            last = (last + [minutes[i]])[-10:]
        else:
            run += 1
    x["missed_streak"] = streak
    x["min_avg10"] = mins
    return x.drop(columns=[c for c in x.columns if c.startswith("_") or c.startswith("c_")]
                  + ["cplayed"])
