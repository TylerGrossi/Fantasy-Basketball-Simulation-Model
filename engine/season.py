"""
Season-level data functions the JSON export runs on — everything scripts/build_data.py
calls out of what used to be `legacy/streamlit_app.py`.

EXTRACTED, NOT REWRITTEN. Every function below is verbatim from streamlit_app.py, minus
its `@st.cache_data`/`@st.cache_resource` decorator. They were proven pure by an AST scan
of the whole file before this module existed: zero `st.*` calls anywhere in their bodies,
their only module-level dependencies are `config`, `data` and `simulation` (already plain
Python, no Streamlit), plus a closed set of small helpers moved alongside them here
(`_category_record`, `_log5`, `_nine_cat_value`, the two playoff-date constants). None of
that touches `styles.py`, `visualizations.py`, `assistant.py` or `assets/` — the actual
Streamlit UI, which stayed in `legacy/` and is what made the split possible.

CACHING. `get_league_cached` and `get_week_box_scores` are each called many times in one
export run — once per team, or once per scored week — and were `@st.cache_data(...)` /
`@st.cache_resource(...)` for exactly that reason: without memoizing them, a single build
would reconnect to ESPN or refetch a week's box scores repeatedly instead of once.
`functools.lru_cache` is the correct standalone replacement: this module only ever runs
inside one short-lived script invocation, so there is no TTL to expire and no cross-run
staleness to worry about — the cache simply dies with the process. The other functions
here are each called once per run by build_data.py, so they carry no cache at all.

VERIFIED EQUIVALENT TO THE ORIGINAL: a full export run against the real ESPN league,
diffed against the pre-extraction league.json (every field but `generatedAt`), byte-for-
byte. See the commit that introduced this file for the diff.
"""

import functools
from datetime import date

import pandas as pd

from config import ESPN_LEAGUE_ID, ESPN_S2, ESPN_SEASON_YEAR, ESPN_SWID
from data import (
    build_stat_df,
    connect_to_espn,
    flatten_stat_dict,
    get_week_date_range,
)
from simulation import calculate_league_stats, simulate_playoff_probabilities

# ESPN-style periods: regular weeks 1-19, then playoff matchup 1 = periods 20-21,
# matchup 2 = 22-23.
REGULAR_SEASON_WEEKS = 19
PLAYOFF_SCORING_DATES = (
    (date(2026, 3, 9), date(2026, 3, 22)),   # Playoff matchup 1 (two-week scoring)
    (date(2026, 3, 23), date(2026, 4, 5)),   # Playoff matchup 2
)


def resolve_view_window(view_period, year):
    """
    Historical NBA game window for a chosen matchup period.
    Returns (window_start, window_end, week_span, period_end_date).
    """
    if view_period is not None and view_period > REGULAR_SEASON_WEEKS:
        idx = (view_period - REGULAR_SEASON_WEEKS - 1) // 2
        if 0 <= idx < len(PLAYOFF_SCORING_DATES):
            start, end = PLAYOFF_SCORING_DATES[idx]
            return start, end, 2, end
    start, end = get_week_date_range(view_period, year)
    return start, end, 1, None


@functools.lru_cache(maxsize=None)
def get_league_cached(league_id, year, espn_s2, swid):
    """Reused ESPN League object — one connection per (league, year, creds) per run."""
    return connect_to_espn(int(league_id), int(year), espn_s2, swid)


@functools.lru_cache(maxsize=None)
def get_week_box_scores(league_id, year, espn_s2, swid, week):
    """
    One week's box scores, cached per week. Season Stats, Schedule, and Power
    Rankings each independently loop the full season calling league.box_scores(week)
    — most weeks overlap across all three, so caching here means each week is only
    ever fetched from ESPN once per run, no matter how many callers ask for it.
    """
    league = get_league_cached(league_id, year, espn_s2, swid)
    return league.box_scores(matchup_period=week)


def get_season_stats(league_id, year, espn_s2, swid):
    """All-play records, win %, luck, and points-for per team."""
    league = get_league_cached(league_id, year, espn_s2, swid)
    return calculate_league_stats(league, year)


def get_playoff_probabilities(year, sims, league_stats, blend_weight, injury_data):
    """
    Playoff / championship Monte Carlo. The season is over, so there's no live
    current-week matchup to seed — keying only on stable inputs lets this be computed
    once per run.
    """
    league = get_league_cached(ESPN_LEAGUE_ID, ESPN_SEASON_YEAR, ESPN_S2, ESPN_SWID)
    return simulate_playoff_probabilities(
        league, league_stats, year, sims=sims,
        regular_season_weeks=REGULAR_SEASON_WEEKS,
        blend_weight=blend_weight, injury_data=injury_data,
        current_week_matchup_outcomes=None,
        period_end_date=None,
        return_projected=True,
    )


def get_team_season_stats(league_id, year, espn_s2, swid, team_id):
    """
    Per-player season totals for one team, summed from the real matchup periods.
    Loops actual periods only — in the offseason currentMatchupPeriod is a huge
    phantom value.
    """
    league = get_league_cached(league_id, year, espn_s2, swid)
    matchup_ids = getattr(league, "matchup_ids", {}) or {}
    try:
        periods = sorted(int(k) for k in matchup_ids.keys())
    except Exception:
        periods = []
    if not periods:
        cw = int(getattr(league, "currentMatchupPeriod", 0) or 0)
        periods = list(range(1, min(max(cw, 1), 30) + 1))

    season_totals = {"FGM": 0, "FGA": 0, "FTM": 0, "FTA": 0, "3PM": 0, "3PA": 0,
                     "REB": 0, "AST": 0, "STL": 0, "BLK": 0, "TO": 0, "PTS": 0}
    player_season_stats = {}
    weekly_data = []

    for week in periods:
        try:
            boxscores = get_week_box_scores(league_id, year, espn_s2, swid, week)
            for matchup in boxscores:
                if matchup.home_team.team_id == team_id:
                    week_stats = flatten_stat_dict(matchup.home_stats)
                    opponent = matchup.away_team.team_name
                    lineup = matchup.home_lineup if hasattr(matchup, 'home_lineup') else []
                elif matchup.away_team.team_id == team_id:
                    week_stats = flatten_stat_dict(matchup.away_stats)
                    opponent = matchup.home_team.team_name
                    lineup = matchup.away_lineup if hasattr(matchup, 'away_lineup') else []
                else:
                    continue

                for stat in season_totals.keys():
                    season_totals[stat] += week_stats.get(stat, 0)

                weekly_data.append({
                    "Week": week, "Opponent": opponent,
                    "PTS": week_stats.get("PTS", 0),
                    "REB": week_stats.get("REB", 0),
                    "AST": week_stats.get("AST", 0),
                })

                for player_entry in (lineup or []):
                    try:
                        player_name = getattr(player_entry, 'name', None)
                        if not player_name:
                            continue
                        slot = getattr(player_entry, 'slot_position', "")
                        if slot in ["BE", "IR", "Bench", "IR+"]:
                            continue
                        if player_name not in player_season_stats:
                            player_season_stats[player_name] = {
                                "GP": 0, "PTS": 0, "REB": 0, "AST": 0,
                                "STL": 0, "BLK": 0, "3PM": 0, "TO": 0,
                                "FGM": 0, "FGA": 0, "FTM": 0, "FTA": 0,
                                "3PA": 0, "DD": 0, "TW": 0,
                            }
                        ps = player_season_stats[player_name]
                        if hasattr(player_entry, 'points_breakdown') and player_entry.points_breakdown:
                            pb = player_entry.points_breakdown
                            games_this_week = pb.get("GP", 0)
                            if games_this_week == 0 and pb.get("PTS", 0) > 0:
                                games_this_week = max(1, int(pb.get("MIN", 0) / 30)) if pb.get("MIN", 0) > 0 else 1
                            ps["GP"] += games_this_week if games_this_week > 0 else (1 if pb.get("PTS", 0) > 0 else 0)
                            for k in ("PTS", "REB", "AST", "STL", "BLK", "3PM", "TO",
                                      "FGM", "FGA", "FTM", "FTA", "3PA", "DD", "TW"):
                                ps[k] += pb.get(k, 0)
                        elif hasattr(player_entry, 'stats') and isinstance(player_entry.stats, dict):
                            stats = player_entry.stats
                            games_this_week = stats.get("GP", 0)
                            if games_this_week == 0 and stats.get("PTS", 0) > 0:
                                games_this_week = 1
                            ps["GP"] += games_this_week
                            for k in ("PTS", "REB", "AST", "STL", "BLK", "3PM", "TO",
                                      "FGM", "FGA", "TW"):
                                ps[k] += stats.get(k, 0)
                    except Exception:
                        continue
                break
        except Exception:
            continue

    return season_totals, player_season_stats, weekly_data


def _category_record(a, b):
    """Category W-L-T for team a vs team b over the 15 scoring categories."""
    cats = ["FGM", "FGA", "FG%", "FT%", "3PM", "3PA", "3P%", "REB",
            "AST", "STL", "BLK", "TO", "DD", "PTS", "TW"]

    def val(s, cat):
        if cat == "FG%":
            return s.get("FGM", 0) / s.get("FGA", 1) if s.get("FGA", 0) else 0
        if cat == "FT%":
            return s.get("FTM", 0) / s.get("FTA", 1) if s.get("FTA", 0) else 0
        if cat == "3P%":
            return s.get("3PM", 0) / s.get("3PA", 1) if s.get("3PA", 0) else 0
        return s.get(cat, 0)

    yw = ow = tie = 0
    for cat in cats:
        x, y = val(a, cat), val(b, cat)
        hi = (x < y) if cat == "TO" else (x > y)
        lo = (x > y) if cat == "TO" else (x < y)
        if hi:
            yw += 1
        elif lo:
            ow += 1
        else:
            tie += 1
    return yw, ow, tie


def _log5(pa, pb):
    """Probability team A (win rate pa) beats team B (win rate pb)."""
    denom = pa + pb - 2 * pa * pb
    return (pa - pa * pb) / denom if denom > 0 else 0.5


def get_team_schedule_data(league_id, year, espn_s2, swid, team_id):
    """
    A team's full-season schedule: each matchup, the category result/score for
    completed weeks, or a projected win % for upcoming ones, plus opponent record
    and manager(s).
    """
    league = get_league_cached(league_id, year, espn_s2, swid)

    def rec(t):
        return f"{int(getattr(t, 'wins', 0))}-{int(getattr(t, 'losses', 0))}-{int(getattr(t, 'ties', 0) or 0)}"

    def winrate(t):
        w, l, ti = int(getattr(t, 'wins', 0)), int(getattr(t, 'losses', 0)), int(getattr(t, 'ties', 0) or 0)
        tot = w + l + ti
        return (w + 0.5 * ti) / tot if tot else 0.5

    def managers(t):
        names = []
        for o in (getattr(t, 'owners', None) or []):
            if isinstance(o, dict):
                full = (str(o.get('firstName', '')).strip() + ' ' + str(o.get('lastName', '')).strip()).strip()
                nm = full or o.get('displayName') or ''
                if nm:
                    names.append(nm)
            elif isinstance(o, str) and o.strip():
                names.append(o.strip())
        return ", ".join(dict.fromkeys(names))

    me = next((t for t in league.teams if t.team_id == team_id), None)
    my_wr = winrate(me) if me else 0.5

    periods = [(w, f"Matchup {w}") for w in range(1, REGULAR_SEASON_WEEKS + 1)]
    for r in range(1, len(PLAYOFF_SCORING_DATES) + 1):
        periods.append((REGULAR_SEASON_WEEKS + 1 + (r - 1) * 2, f"Playoff Round {r}"))

    rows = []
    for period, label in periods:
        try:
            boxscores = get_week_box_scores(league_id, year, espn_s2, swid, period)
        except Exception:
            continue
        for m in boxscores:
            hid, aid = m.home_team.team_id, m.away_team.team_id
            if team_id not in (hid, aid):
                continue
            is_home = hid == team_id
            my_stats = flatten_stat_dict(m.home_stats if is_home else m.away_stats)
            opp = m.away_team if is_home else m.home_team
            opp_stats = flatten_stat_dict(m.away_stats if is_home else m.home_stats)
            played = (float(my_stats.get("PTS", 0) or 0) + float(opp_stats.get("PTS", 0) or 0)) > 0

            if period > REGULAR_SEASON_WEEKS:
                idx = (period - REGULAR_SEASON_WEEKS - 1) // 2
                s, e = PLAYOFF_SCORING_DATES[idx] if 0 <= idx < len(PLAYOFF_SCORING_DATES) else (None, None)
            else:
                s, e = get_week_date_range(period, year)
            dates = f"{s:%b %d} - {e:%b %d}" if s and e else ""

            row = {"Matchup": label + (f" ({dates})" if dates else ""),
                   "Result": "", "Score": "", "Win %": "",
                   "Opponent": f"{'@ ' if not is_home else ''}{opp.team_name} ({rec(opp)})",
                   "Manager": managers(opp), "_period": period}
            if played:
                yw, ow, tie = _category_record(my_stats, opp_stats)
                row["Result"] = "W" if yw > ow else "L" if ow > yw else "T"
                row["Score"] = f"{yw}-{ow}-{tie}"
            else:
                row["Win %"] = f"{_log5(my_wr, winrate(opp)) * 100:.0f}%"
            rows.append(row)
            break
    rows.sort(key=lambda r: r["_period"])
    return rows


def get_power_rankings(league_id, year, espn_s2, swid):
    """
    Week-by-week power rankings from cumulative all-play. For each regular-season
    week we score every team against every other team across the 15 categories, add
    it to a running all-play total, then re-rank. That yields each team's rank each
    week (movement), recent form (hot/cold), and strength-of-schedule (average
    all-play % of the opponents they actually faced).
    """
    league = get_league_cached(league_id, year, espn_s2, swid)
    team_names = {t.team_id: t.team_name for t in league.teams}
    tids = list(team_names.keys())
    n_teams = len(tids)

    cum = {t: {"w": 0, "l": 0, "t": 0} for t in tids}
    weekly_pct = {t: [] for t in tids}      # this-week all-play % (for form)
    opponents = {t: [] for t in tids}       # opponents faced (for SoS)
    rank_hist = {t: [] for t in tids}       # rank after each scored week
    week_labels = []

    def _pct(rec):
        tot = rec["w"] + rec["l"] + rec["t"]
        return (rec["w"] + 0.5 * rec["t"]) / tot if tot else 0.0

    for week in range(1, REGULAR_SEASON_WEEKS + 1):
        try:
            boxscores = get_week_box_scores(league_id, year, espn_s2, swid, week)
        except Exception:
            continue
        wk_stats, wk_opp = {}, {}
        for m in boxscores:
            hid, aid = m.home_team.team_id, m.away_team.team_id
            hs = flatten_stat_dict(m.home_stats)
            as_ = flatten_stat_dict(m.away_stats)
            if (float(hs.get("PTS", 0) or 0) + float(as_.get("PTS", 0) or 0)) <= 0:
                continue  # week not played yet
            wk_stats[hid], wk_stats[aid] = hs, as_
            wk_opp[hid], wk_opp[aid] = aid, hid
        # Skip weeks without broad participation (playoff-only weeks etc.).
        if len(wk_stats) < max(4, n_teams // 2):
            continue

        ids = list(wk_stats)
        for t1 in ids:
            ww = wl = wt = 0
            for t2 in ids:
                if t1 == t2:
                    continue
                yw, ow, tie = _category_record(wk_stats[t1], wk_stats[t2])
                ww += yw; wl += ow; wt += tie
            cum[t1]["w"] += ww; cum[t1]["l"] += wl; cum[t1]["t"] += wt
            tot = ww + wl + wt
            weekly_pct[t1].append((ww + 0.5 * wt) / tot if tot else 0.0)
            if t1 in wk_opp:
                opponents[t1].append(wk_opp[t1])

        ranked = sorted(ids, key=lambda t: _pct(cum[t]), reverse=True)
        pos = {t: i + 1 for i, t in enumerate(ranked)}
        for t in tids:
            rank_hist[t].append(pos.get(t) or (rank_hist[t][-1] if rank_hist[t] else None))
        week_labels.append(week)

    final_pct = {t: _pct(cum[t]) for t in tids}
    teams = []
    for t in tids:
        hist = [r for r in rank_hist[t] if r is not None]
        cur = hist[-1] if hist else 0
        prev = hist[-2] if len(hist) >= 2 else cur
        recent = weekly_pct[t][-3:]
        recent_pct = sum(recent) / len(recent) if recent else final_pct[t]
        diff = recent_pct - final_pct[t]
        form = "Hot" if diff > 0.05 else "Cold" if diff < -0.05 else "Steady"
        opp_pcts = [final_pct[o] for o in opponents[t] if o in final_pct]
        sos = sum(opp_pcts) / len(opp_pcts) if opp_pcts else 0.0
        teams.append({
            "team_id": t, "team_name": team_names[t],
            "rank": cur, "prev_rank": prev, "delta": (prev - cur) if cur else 0,
            "power_pct": final_pct[t], "recent_pct": recent_pct,
            "form": form, "form_diff": diff, "sos": sos,
            "record": (cum[t]["w"], cum[t]["l"], cum[t]["t"]),
            "rank_history": rank_hist[t],
        })
    teams.sort(key=lambda r: r["rank"] if r["rank"] else 999)
    return {"teams": teams, "weeks": week_labels}


_VALUE_COUNT_CATS = ["PTS", "REB", "AST", "STL", "BLK", "3PM"]
_AGG_KEYS = ["FGM", "FGA", "FTM", "FTA", "3PM", "3PA", "REB", "AST", "STL", "BLK", "TO", "PTS"]


def _nine_cat_value(df, ref):
    """
    Standard 9-category z-score value for each row of ``df``, scored against the
    distribution in ``ref`` (so season and last-30 are on the same scale and can be
    differenced into a trend). Percentage categories use volume-weighted impact.
    """
    if df is None or df.empty:
        return pd.Series([], dtype=float)
    val = pd.Series(0.0, index=df.index)
    for c in _VALUE_COUNT_CATS:
        sd = ref[c].std(ddof=0)
        if sd > 0:
            val = val + (df[c] - ref[c].mean()) / sd
    sd_to = ref["TO"].std(ddof=0)
    if sd_to > 0:
        val = val - (df["TO"] - ref["TO"].mean()) / sd_to
    for made, att, pct in (("FGM", "FGA", "FG%"), ("FTM", "FTA", "FT%")):
        lg = ref[made].sum() / ref[att].sum() if ref[att].sum() > 0 else 0.0
        imp_ref = (ref[pct] - lg) * ref[att]
        sd = imp_ref.std(ddof=0)
        if sd > 0:
            val = val + ((df[pct] - lg) * df[att] - imp_ref.mean()) / sd
    return val


def get_player_pool(league_id, year, espn_s2, swid, fa_size=150):
    """
    Every rostered player (all teams) plus the top free agents, each with per-game
    category stats, a 9-cat z-score **Value**, last-30/last-15 **Recent**/**Recent15**
    values on the same scale, and **Trend**/**Trend15** (Recent[15] - Value). Powers
    Player Value / Trade Simulator / the JSON export.
    """
    league = get_league_cached(league_id, year, espn_s2, swid)
    owner = {}
    status = {}  # player -> raw ESPN injuryStatus (for the availability badge / filter)
    pid = {}     # player -> ESPN playerId (for the headshot image on the mobile card)
    slot = {}    # player -> current lineup slot (PG/SG/.../Bench/IR), for the League Rosters view
    acq = {}     # player -> raw ESPN acquisitionType (DRAFT/FREEAGENCY/TRADE/WAIVER), same view
    season_frames, last30_frames, last15_frames = [], [], []
    for t in league.teams:
        for p in t.roster:
            owner[p.name] = t.team_name
            status[p.name] = getattr(p, "injuryStatus", "") or ""
            pid[p.name] = getattr(p, "playerId", None)
            slot[p.name] = getattr(p, "lineupSlot", "") or ""
            acq[p.name] = getattr(p, "acquisitionType", "") or ""
        season_frames.append(build_stat_df(t.roster, f"{year}_total", "Season", t.team_name, year))
        last30_frames.append(build_stat_df(t.roster, f"{year}_last_30", "Last30", t.team_name, year))
        last15_frames.append(build_stat_df(t.roster, f"{year}_last_15", "Last15", t.team_name, year))
    try:
        fas = league.free_agents(size=fa_size)
    except Exception:
        fas = []
    for p in fas:
        nm = getattr(p, "name", "")
        owner.setdefault(nm, "FA")
        status.setdefault(nm, getattr(p, "injuryStatus", "") or "")
        pid.setdefault(nm, getattr(p, "playerId", None))
    season_frames.append(build_stat_df(fas, f"{year}_total", "Season", "FA", year))
    last30_frames.append(build_stat_df(fas, f"{year}_last_30", "Last30", "FA", year))
    last15_frames.append(build_stat_df(fas, f"{year}_last_15", "Last15", "FA", year))

    season_df = pd.concat([f for f in season_frames if not f.empty], ignore_index=True) \
        if any(not f.empty for f in season_frames) else pd.DataFrame()
    last30_df = pd.concat([f for f in last30_frames if not f.empty], ignore_index=True) \
        if any(not f.empty for f in last30_frames) else pd.DataFrame()
    last15_df = pd.concat([f for f in last15_frames if not f.empty], ignore_index=True) \
        if any(not f.empty for f in last15_frames) else pd.DataFrame()
    if season_df.empty:
        return []
    season_df = season_df.drop_duplicates("Player", keep="first").reset_index(drop=True)
    if not last30_df.empty:
        last30_df = last30_df.drop_duplicates("Player", keep="first").reset_index(drop=True)
    if not last15_df.empty:
        last15_df = last15_df.drop_duplicates("Player", keep="first").reset_index(drop=True)

    season_df["Value"] = _nine_cat_value(season_df, season_df).values
    if not last30_df.empty:
        recent = _nine_cat_value(last30_df, season_df)
        recent_map = dict(zip(last30_df["Player"], recent))
    else:
        recent_map = {}
    season_df["Recent"] = season_df["Player"].map(recent_map)
    season_df["Recent"] = season_df["Recent"].fillna(season_df["Value"])
    season_df["Trend"] = season_df["Recent"] - season_df["Value"]

    if not last15_df.empty:
        recent15 = _nine_cat_value(last15_df, season_df)
        recent15_map = dict(zip(last15_df["Player"], recent15))
    else:
        recent15_map = {}
    season_df["Recent15"] = season_df["Player"].map(recent15_map)
    season_df["Recent15"] = season_df["Recent15"].fillna(season_df["Value"])
    season_df["Trend15"] = season_df["Recent15"] - season_df["Value"]

    # Draft-projection inputs: the last-30 window's OWN per-game line, carried alongside
    # the season line instead of being collapsed into the Recent z-score. `Trend` says a
    # player finished hot; only the raw last-30 categories say in what, and a next-season
    # projection blends categories, not a single number. Prefixed so they can never
    # collide with the season columns. Read by scripts/build_data.py -> the draft board;
    # nothing in this app uses them.
    if not last30_df.empty:
        l30 = last30_df.drop_duplicates("Player", keep="first").set_index("Player")
        for c in _AGG_KEYS + ["DD", "TW", "FG%", "FT%", "3P%", "GP"]:
            if c in l30.columns:
                season_df[f"L30_{c}"] = season_df["Player"].map(l30[c])
    # Same again for the last-15 window. `Recent15` already collapses it to one z-score;
    # these are the raw per-game categories behind it, which is what the Player Card's
    # averages block needs to show a 15D line rather than just a 15D number.
    if not last15_df.empty:
        l15 = last15_df.drop_duplicates("Player", keep="first").set_index("Player")
        for c in _AGG_KEYS + ["DD", "TW", "FG%", "FT%", "3P%", "GP"]:
            if c in l15.columns:
                season_df[f"L15_{c}"] = season_df["Player"].map(l15[c])

    season_df["Owner"] = season_df["Player"].map(owner).fillna("FA")
    # Raw injuryStatus can be a list on some API responses - stringify so it stays
    # serializable; the display/severity mapping happens on the read side.
    season_df["Status"] = season_df["Player"].map(status).fillna("")
    season_df["Status"] = season_df["Status"].apply(
        lambda s: ",".join(str(x) for x in s) if isinstance(s, (list, tuple)) else str(s or ""))
    season_df["PlayerId"] = season_df["Player"].map(pid)
    # Free agents were never on a roster, so `slot`/`acq` have no entry for them - leave
    # blank rather than guessing, same treatment as `owner.setdefault(nm, "FA")` above.
    season_df["LineupSlot"] = season_df["Player"].map(slot).fillna("")
    season_df["AcquisitionType"] = season_df["Player"].map(acq).fillna("")

    keep = (["Player", "NBA_Team", "Position", "EligibleSlots", "Owner", "Status", "PlayerId",
             "LineupSlot", "AcquisitionType", "Value",
             "Recent", "Trend", "Recent15", "Trend15", "FG%", "FT%", "3P%", "DD", "TW",
             "GP"] + _AGG_KEYS
            + [c for c in season_df.columns
               if c.startswith("L30_") or c.startswith("L15_")])
    keep = list(dict.fromkeys([c for c in keep if c in season_df.columns]))
    return season_df[keep].to_dict("records")
