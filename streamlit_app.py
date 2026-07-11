"""
Fantasy Basketball Win Percentage Simulation - Streamlit App
================================================================
A web-based Monte Carlo simulation tool for ESPN Fantasy Basketball
"""

import streamlit as st
import pandas as pd
import numpy as np
import threading
from concurrent.futures import ThreadPoolExecutor
import plotly.graph_objects as go
from datetime import datetime, date
from zoneinfo import ZoneInfo

from config import (
    CATEGORIES, NUMERIC_COLS, STREAMER_RECORD_PLAYOFF_SIMS,
    ESPN_LEAGUE_ID, ESPN_SEASON_YEAR, ESPN_S2, ESPN_SWID,
    DEFAULT_TEAM_ID, DEFAULT_TEAM_NAME,
)
from data import (
    connect_to_espn,
    resolve_team_id,
    get_matchup_info,
    get_current_totals,
    build_stat_df,
    blend_season_last30,
    add_games_left_with_injury,
    flatten_stat_dict,
    get_espn_injury_data,
    build_injury_table,
    get_game_count_window,
    get_week_date_range,
    prefetch_team_schedules_for_rosters,
)
from simulation import (
    simulate_team,
    add_current_to_sim,
    compare_matchups,
    analyze_streamers,
    analyze_bench_strategy,
    calculate_league_stats,
    simulate_playoff_probabilities,
    current_matchup_period_effective,
    _get_matchup_variance_multiplier,
)
from visualizations import (
    create_scoreboard,
    create_win_probability_gauge,
    create_category_chart,
    create_outcome_distribution,
    create_championship_chart,
    create_rank_trend_chart,
)
from styles import CUSTOM_CSS
from assets.icon_font import ICON_FONT_CSS

# The background cache-warming threads (and pooled schedule prefetch) call
# Streamlit-cached functions off the main thread, which logs a harmless
# "missing ScriptRunContext" warning for each call. Silence just those loggers.
import logging as _logging
for _n in (
    "streamlit.runtime.scriptrunner_utils.script_run_context",
    "streamlit.runtime.scriptrunner.script_run_context",
):
    _logging.getLogger(_n).setLevel(_logging.ERROR)

# Must be the first Streamlit command
st.set_page_config(
    page_title="Fantasy Basketball Simulator",
    page_icon="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='45' fill='%23E06A3B' stroke='%23000' stroke-width='2'/><path d='M50 5 Q50 50 50 95' stroke='%23000' stroke-width='2' fill='none'/><path d='M5 50 Q50 50 95 50' stroke='%23000' stroke-width='2' fill='none'/><path d='M15 20 Q50 35 85 20' stroke='%23000' stroke-width='2' fill='none'/><path d='M15 80 Q50 65 85 80' stroke='%23000' stroke-width='2' fill='none'/></svg>",
    layout="wide",
    # Sidebar is the "This Week" side rail (shown only on those pages). "auto" = expanded
    # on desktop, collapsed on mobile; CSS force-shows it as a rail / sub-bar when it holds nav.
    initial_sidebar_state="auto"
)
st.markdown(CUSTOM_CSS, unsafe_allow_html=True)
# Bootstrap Icons font is self-hosted (embedded base64), injected separately so a slow
# asset can never render-block the layout stylesheet the way a CDN @import did.
st.markdown(f"<style>{ICON_FONT_CSS}</style>", unsafe_allow_html=True)

# ESPN-style periods: regular weeks 1–19, then playoff matchup 1 = periods 20–21, matchup 2 = 22–23.
REGULAR_SEASON_WEEKS = 19
PLAYOFF_SCORING_DATES = (
    (date(2026, 3, 9), date(2026, 3, 22)),   # Playoff matchup 1 (two-week scoring)
    (date(2026, 3, 23), date(2026, 4, 5)),   # Playoff matchup 2
)

# The season is over once we're past the final playoff scoring date.
SEASON_END_DATE = PLAYOFF_SCORING_DATES[-1][1]
SEASON_SUMMARY_VIEW = "Season Summary"


def build_week_views():
    """Ordered {label: matchup_period}. Season Summary maps to None."""
    views = {SEASON_SUMMARY_VIEW: None}
    for w in range(1, REGULAR_SEASON_WEEKS + 1):
        views[f"Week {w}"] = w
    for i in range(1, len(PLAYOFF_SCORING_DATES) + 1):
        views[f"Playoffs - Round {i}"] = REGULAR_SEASON_WEEKS + 1 + (i - 1) * 2
    return views


def period_to_view_label(period, view_map):
    """Reverse lookup: matchup period -> view label (None if not found)."""
    for label, p in view_map.items():
        if p == period:
            return label
    return None


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


# =============================================================================
# MAIN APP
# =============================================================================

@st.cache_data(ttl=3600, show_spinner="Loading league from ESPN...")
def get_league_meta(league_id, year, espn_s2, swid):
    """
    Lightweight league info for the sidebar and the Season Summary page.
    Cached 1 hour. Returns a dict of plain (serializable) values.
    """
    league = connect_to_espn(int(league_id), int(year), espn_s2, swid)
    seen, names = set(), []
    rows = []
    for t in league.teams:
        name = (t.team_name or "").strip()
        if name and name not in seen:
            seen.add(name)
            names.append(name)
        rows.append({
            "team_id": int(getattr(t, "team_id", 0) or 0),
            "name": name,
            "wins": int(getattr(t, "wins", 0) or 0),
            "losses": int(getattr(t, "losses", 0) or 0),
            "ties": int(getattr(t, "ties", 0) or 0),
            "standing": int(getattr(t, "standing", 0) or 0),
            "final_standing": int(getattr(t, "final_standing", 0) or 0),
        })
    has_final = any(r["final_standing"] > 0 for r in rows)
    if has_final:
        rows.sort(key=lambda r: r["final_standing"] if r["final_standing"] > 0 else 999)
    else:
        rows.sort(key=lambda r: r["standing"] if r["standing"] > 0 else 999)
    for i, r in enumerate(rows, 1):
        r["rank"] = (r["final_standing"] if r["final_standing"] > 0
                     else r["standing"] if r["standing"] > 0 else i)
    return {
        "names": names,
        "league_name": getattr(league.settings, "name", "Your League"),
        "current_period": current_matchup_period_effective(league),
        "standings": rows,
        "has_final_standings": has_final,
    }


@st.cache_data(ttl=3600, show_spinner="Crunching season stats...")
def get_season_stats(league_id, year, espn_s2, swid):
    """All-play records, win %, luck, and points-for per team. Cached 1 hour."""
    league = connect_to_espn(int(league_id), int(year), espn_s2, swid)
    return calculate_league_stats(league, year)


def _ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1:'st', 2:'nd', 3:'rd'}.get(n % 10, 'th')}"


def _leader_card(label, name, detail):
    """A single 'category leader' card in the Analyst Sheet style (hairline, ink name, mono figure)."""
    return (
        "<div style='background:var(--card); border:1px solid var(--line); border-radius:10px; "
        "padding:0.85rem 1rem; margin-bottom:0.6rem;'>"
        "<div style='color:var(--ink-2); font-size:0.64rem; letter-spacing:0.09em; text-transform:uppercase; "
        f"font-family:system-ui,Segoe UI,sans-serif;'>{label}</div>"
        "<div style='color:var(--ink); font-weight:700; font-size:1.1rem; margin-top:0.15rem; "
        f"font-family:system-ui,Segoe UI,sans-serif;'>{name}</div>"
        "<div style='color:var(--ink-2); font-family:ui-monospace,Consolas,monospace; font-size:0.88rem; "
        f"margin-top:0.15rem;'>{detail}</div></div>"
    )


def render_fitted_table(df, max_height=520):
    """
    Compact Analyst-styled HTML table that fills the container width (small mono
    figures) instead of Streamlit's fixed-width grid, so wide stat tables fit.
    Text columns align left (sans); numeric columns align right (mono figures).
    """
    cols = list(df.columns)
    ink, ink2, line, card, surf2 = "var(--ink)", "var(--ink-2)", "var(--line)", "var(--card)", "var(--surface-2)"
    aligns, fonts = [], []
    for i, c in enumerate(cols):
        is_num = (i != 0) and pd.to_numeric(df[c], errors="coerce").notna().mean() >= 0.6
        aligns.append("right" if is_num else "left")
        fonts.append("ui-monospace,Consolas,monospace" if is_num else "system-ui,Segoe UI,sans-serif")
    thead = ""
    for i, c in enumerate(cols):
        thead += (
            f"<th style='padding:7px 8px; text-align:{aligns[i]}; font-size:0.62rem; letter-spacing:0.03em; "
            f"text-transform:uppercase; color:{ink2}; white-space:nowrap; position:sticky; top:0; "
            f"background:{surf2};'>{c}</th>"
        )
    body = ""
    for _, r in df.iterrows():
        tds = ""
        for i, c in enumerate(cols):
            al = aligns[i]
            fam = fonts[i]
            wt = "600" if i == 0 else "400"
            tds += (
                f"<td style='padding:6px 8px; text-align:{al}; font-family:{fam}; font-weight:{wt}; "
                f"color:{ink}; white-space:nowrap;'>{r[c]}</td>"
            )
        body += f"<tr style='border-bottom:1px solid var(--line-2);'>{tds}</tr>"
    return (
        f"<div style='border:1px solid {line}; border-radius:10px; overflow:auto; "
        f"max-height:{max_height}px; background:{card};'>"
        f"<table style='width:100%; border-collapse:collapse; font-size:0.72rem;'>"
        f"<thead><tr>{thead}</tr></thead><tbody>{body}</tbody></table></div>"
    )


def _sort_df(df, col, ascending):
    """Sort a DataFrame by a column, treating numeric-looking strings as numbers."""
    keycol = pd.to_numeric(df[col], errors="coerce")
    if keycol.notna().any():
        return (df.assign(_k=keycol)
                  .sort_values("_k", ascending=ascending, kind="mergesort")
                  .drop(columns="_k").reset_index(drop=True))
    return df.sort_values(col, ascending=ascending, kind="mergesort").reset_index(drop=True)


def render_sortable_table(df, key, default_col=None, default_desc=True, max_height=560,
                          selectable=False):
    """
    Interactive table with **clickable-header sorting** via Streamlit's native grid.
    Numeric-looking columns are coerced to real numbers so a header click sorts
    numerically (not alphabetically); columns that were percentages keep a % format.
    When ``selectable`` is set, single-row selection is enabled and the event is
    returned (row indices refer to the passed row order).
    """
    df = df.copy()
    cols = list(df.columns)
    if not cols:
        st.dataframe(df, width='stretch', hide_index=True, key=f"srt_{key}")
        return
    pct_cols = []
    for i, c in enumerate(cols):
        if i == 0:
            continue  # keep the first (label) column as text
        s = df[c].astype(str)
        nonempty = s[s.str.strip() != ""]
        if nonempty.empty:
            continue
        pct_frac = nonempty.str.contains("%", regex=False).mean()
        # A column that mixes "%" and plain values has no single unit (e.g. per-
        # category projections: 47.8% next to 21.6 next to 660) - leave it as text
        # so numeric coercion doesn't strip the "%" and mangle the display.
        if 0.05 < pct_frac < 0.95:
            continue
        stripped = (s.str.replace("%", "", regex=False)
                     .str.replace("+", "", regex=False)
                     .str.replace(",", "", regex=False))
        num = pd.to_numeric(stripped, errors="coerce")
        if num.loc[nonempty.index].notna().mean() >= 0.9:
            df[c] = num
            if pct_frac >= 0.95:
                pct_cols.append(c)
    if default_col in cols:
        df = df.sort_values(default_col, ascending=not default_desc, kind="mergesort").reset_index(drop=True)

    cfg = {cols[0]: st.column_config.TextColumn(width="medium")}
    for c in pct_cols:
        cfg[c] = st.column_config.NumberColumn(format="%.1f%%")
    kwargs = dict(width='stretch', hide_index=True, column_config=cfg, key=f"srt_{key}")
    rows = len(df)
    # Size the grid to show every row with headroom so it never scrolls internally.
    # Glide rows are 35px (header + rows) plus ~12px chrome; a too-tight height
    # leaves a few px of vertical overflow, which shows BOTH scrollbars. Overshoot
    # slightly so clientHeight clears the content and no scrollbars appear.
    if 0 < rows <= 25:
        kwargs["height"] = (rows + 1) * 35 + 22
    if selectable:
        kwargs["on_select"] = "rerun"
        kwargs["selection_mode"] = "single-row"
    return st.dataframe(df, **kwargs)


def format_roster_for_display(df, cols):
    """Select + format roster columns for the fitted table (percentages, rounding)."""
    out = df[[c for c in cols if c in df.columns]].copy()
    for pct_col in ["FG%", "FT%", "3P%"]:
        if pct_col in out.columns:
            out[pct_col] = out[pct_col].apply(lambda x: f"{x*100:.1f}%" if pd.notna(x) else "")
    for col in out.columns:
        if col not in ["FG%", "FT%", "3P%", "Player", "NBA_Team"] and out[col].dtype in [np.float64, np.float32]:
            out[col] = out[col].round(1)
    return out.rename(columns={"NBA_Team": "NBA"})


def render_season_summary(meta, your_team_name):
    """Final-standings landing page (season is over), with all-play stats."""
    standings = meta.get("standings", []) if meta else []
    league_name = meta.get("league_name", "Your League") if meta else "Your League"
    champ = standings[0] if standings else None
    you = next((r for r in standings if r["name"] == your_team_name), None)

    # All-play / luck stats keyed by team id (best-effort; graceful without it).
    try:
        season_stats = get_season_stats(ESPN_LEAGUE_ID, ESPN_SEASON_YEAR, ESPN_S2, ESPN_SWID)
    except Exception:
        season_stats = []
    stats_by_id = {s["team_id"]: s for s in (season_stats or [])}
    has_all_play = any(
        (s["all_play_wins"] + s["all_play_losses"] + s["all_play_ties"]) > 0
        for s in (season_stats or [])
    )

    st.markdown(
        f"""
        <div style="text-align:center; padding:0.1rem 1rem 0.35rem;">
            <div class="main-header" style="font-size:1.7rem;">
                {ESPN_SEASON_YEAR - 1}&ndash;{str(ESPN_SEASON_YEAR)[2:]} Season Complete
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    if champ:
        champ_label = "Champion" if meta.get("has_final_standings") else "Regular-Season Leader"
        st.markdown(
            f"""
            <div style="max-width:960px; margin:0 auto 0.9rem; background:var(--card);
                        border:1px solid var(--line); border-left:4px solid var(--cobalt); border-radius:12px;
                        padding:1.2rem 1.5rem; text-align:center;">
                <div style="font-family: system-ui, Segoe UI, sans-serif; font-size:0.7rem;
                            letter-spacing:0.12em; text-transform:uppercase; color:var(--ink-2);">{champ_label}</div>
                <div style="font-family: ui-monospace, Consolas, monospace; font-weight:700;
                            font-size:1.6rem; color:var(--ink); margin-top:0.25rem;">{champ['name']}</div>
                <div style="font-family: ui-monospace, Consolas, monospace; color:var(--ink-2); margin-top:0.15rem;">
                    {champ['wins']}&ndash;{champ['losses']}{('&ndash;' + str(champ['ties'])) if champ['ties'] else ''}
                </div>
            </div>
            """,
            unsafe_allow_html=True,
        )

    # Your team: headline stat tiles
    if you is not None:
        rec = f"{you['wins']}-{you['losses']}" + (f"-{you['ties']}" if you['ties'] else "")
        sd = stats_by_id.get(you["team_id"], {})
        st.markdown(
            f"<p style='text-align:center; color:var(--ink-2); margin:0.3rem 0 0.6rem;'>"
            f"<strong style='color:var(--ink);'>{you['name']}</strong> finished "
            f"<strong style='color:var(--cobalt);'>{_ordinal(you['rank'])}</strong>.</p>",
            unsafe_allow_html=True,
        )
        if sd:
            luck = sd.get("luck", 0.0)
            with st.container(key="ss_metrics"):
                c1, c2, c3, c4 = st.columns(4)
                with c1:
                    st.metric("Category Record", rec, help="Total category wins–losses across the season.")
                with c2:
                    st.metric("Win %", f"{sd.get('actual_pct', 0) * 100:.1f}%",
                              help="Share of categories you won (ties count as half).")
                with c3:
                    st.metric("All-Play Win %", f"{sd.get('all_play_pct', 0) * 100:.1f}%",
                              help="How you'd score if you played every team every week - schedule luck removed.")
                with c4:
                    st.metric("Luck", f"{luck:+.1f}",
                              help="Win % minus all-play win %. Positive = better record than performance.")

    # League table
    good, bad, ink, ink2 = "var(--good)", "var(--bad)", "var(--ink)", "var(--ink-2)"

    def _cell(v, align="right", color=ink, mono=True):
        fam = "ui-monospace,Consolas,monospace" if mono else "system-ui,Segoe UI,sans-serif"
        return f"<td style='padding:6px 12px; text-align:{align}; font-family:{fam}; color:{color};'>{v}</td>"

    head_cells = [("Rank", "left"), ("Team", "left"), ("Record", "right"), ("Win %", "right")]
    if has_all_play:
        head_cells += [("All-Play %", "right"), ("Luck", "right")]
    thead = "".join(
        f"<th style='padding:8px 12px; text-align:{al}; font-size:0.68rem; letter-spacing:0.06em; "
        f"text-transform:uppercase; color:{ink2}; white-space:nowrap;'>{lbl}</th>"
        for lbl, al in head_cells
    )

    body = ""
    for r in standings:
        is_you = (r["name"] == your_team_name)
        rec = f"{r['wins']}-{r['losses']}" + (f"-{r['ties']}" if r['ties'] else "")
        sd = stats_by_id.get(r["team_id"], {})
        row_bg = "background:var(--row-highlight);" if is_you else ""
        name_wt = "700" if is_you else "500"
        bar = "border-left:3px solid var(--cobalt);" if is_you else "border-left:3px solid transparent;"
        cells = (
            f"<td style='{bar} padding:6px 12px; text-align:left; font-family:ui-monospace,Consolas,monospace; color:{ink2};'>{r['rank']}</td>"
            f"<td style='padding:6px 12px; text-align:left; font-weight:{name_wt}; color:{ink};'>{r['name']}</td>"
            + _cell(rec)
            + _cell(f"{sd.get('actual_pct', 0) * 100:.1f}%" if sd else "&ndash;")
        )
        if has_all_play:
            luck = sd.get("luck", 0.0) if sd else 0.0
            luck_color = good if luck > 0 else bad if luck < 0 else ink2
            cells += _cell(f"{sd.get('all_play_pct', 0) * 100:.1f}%" if sd else "&ndash;")
            cells += _cell(f"{luck:+.1f}" if sd else "&ndash;", color=luck_color)
        body += f"<tr style='{row_bg} border-bottom:1px solid var(--line-2);'>{cells}</tr>"

    st.markdown(
        f"""
        <div style="max-width:960px; margin:0.7rem auto 0; border:1px solid var(--line);
                    border-radius:12px; overflow-x:auto; background:var(--card);">
            <table style="width:100%; border-collapse:collapse; font-family:system-ui, Segoe UI, sans-serif; min-width:520px;">
                <thead><tr style="background:var(--surface-2); border-bottom:1px solid var(--line);">{thead}</tr></thead>
                <tbody>{body}</tbody>
            </table>
        </div>
        """,
        unsafe_allow_html=True,
    )


@st.cache_resource(ttl=3600, show_spinner=False)
def get_league_cached(league_id, year, espn_s2, swid):
    """Reused ESPN League object, cached across reruns so navigation stays fast."""
    return connect_to_espn(int(league_id), int(year), espn_s2, swid)


@st.cache_data(ttl=1800, show_spinner=False)
def get_injury_cached():
    """ESPN injury feed, cached so page switches don't refetch it."""
    return get_espn_injury_data()


@st.cache_data(ttl=3600, show_spinner=False)
def get_playoff_probabilities(year, sims, league_stats, blend_weight, injury_data):
    """
    Cached playoff / championship Monte Carlo. The season is over, so there's no
    live current-week matchup to seed - keying only on stable inputs lets this be
    computed once and even pre-warmed in the background.
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


@st.cache_data(ttl=3600, show_spinner=False)
def get_team_season_stats(league_id, year, espn_s2, swid, team_id):
    """
    Per-player season totals for one team, summed from the real matchup periods.
    Cached (and pre-warmed) so the Season Stats page is instant. Loops actual
    periods only - in the offseason currentMatchupPeriod is a huge phantom value.
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
            boxscores = league.box_scores(matchup_period=week)
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


@st.cache_data(ttl=3600, show_spinner="Loading schedule...")
def get_team_schedule_data(league_id, year, espn_s2, swid, team_id):
    """
    A team's full-season schedule: each matchup, the category result/score for
    completed weeks, or a projected win % for upcoming ones, plus opponent record
    and manager(s). Cached (and pre-warmed).
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
            boxscores = league.box_scores(matchup_period=period)
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


def render_schedule(meta, team_name):
    """Team schedule page: results for completed weeks, win % for upcoming ones."""
    st.markdown('<h2><i class="bi bi-calendar3" style="color: var(--cobalt);"></i> Schedule</h2>', unsafe_allow_html=True)
    resolved = team_name
    try:
        league = get_league_cached(ESPN_LEAGUE_ID, ESPN_SEASON_YEAR, ESPN_S2, ESPN_SWID)
        team_id, resolved = resolve_team_id(league, team_name, DEFAULT_TEAM_ID)
        rows = get_team_schedule_data(ESPN_LEAGUE_ID, ESPN_SEASON_YEAR, ESPN_S2, ESPN_SWID, team_id)
    except Exception:
        rows = []
    if not rows:
        st.info("Schedule unavailable.")
        return
    df = pd.DataFrame(rows)
    periods = df["_period"].tolist()
    df = df.drop(columns=["_period"])
    # Drop columns that are entirely blank (e.g. Win % once the season is complete).
    df = df.loc[:, df.astype(str).apply(lambda c: c.str.strip().ne("")).any()]
    st.caption(
        f"**{resolved}**'s season. Click a matchup to open it. Completed matchups show the "
        "category score (W-L-T); upcoming matchups show a projected win %."
    )

    # A new key each time we navigate away clears any stale row selection.
    nonce = st.session_state.get("_sched_nonce", 0)
    event = render_sortable_table(df, f"schedule_{nonce}", default_col=None,
                                  max_height=1000, selectable=True)
    selected = []
    if event is not None:
        sel = event["selection"] if isinstance(event, dict) else getattr(event, "selection", None)
        if sel is not None:
            rows_sel = sel["rows"] if isinstance(sel, dict) else getattr(sel, "rows", None)
            selected = list(rows_sel or [])
    if selected:
        idx = selected[0]
        if 0 <= idx < len(periods):
            label = period_to_view_label(periods[idx], build_week_views())
            if label:
                st.session_state.week_sel = label
                st.session_state.active_page = "Matchup"
                st.session_state["_sched_nonce"] = nonce + 1
                st.rerun()


# =============================================================================
# POWER RANKINGS
# =============================================================================

@st.cache_data(ttl=3600, show_spinner="Computing power rankings...")
def get_power_rankings(league_id, year, espn_s2, swid):
    """
    Week-by-week power rankings from cumulative all-play. For each regular-season
    week we score every team against every other team across the 15 categories, add
    it to a running all-play total, then re-rank. That yields each team's rank each
    week (movement), recent form (hot/cold), and strength-of-schedule (average
    all-play % of the opponents they actually faced). Cached and pre-warmed.
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
            boxscores = league.box_scores(matchup_period=week)
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


def render_power_rankings(meta, team_name):
    """Power rankings: current standing, weekly movement, form, strength of schedule."""
    st.markdown('<h2><i class="bi bi-graph-up-arrow" style="color: var(--cobalt);"></i> Power Rankings</h2>', unsafe_allow_html=True)
    resolved = team_name
    try:
        league = get_league_cached(ESPN_LEAGUE_ID, ESPN_SEASON_YEAR, ESPN_S2, ESPN_SWID)
        _, resolved = resolve_team_id(league, team_name, DEFAULT_TEAM_ID)
        data = get_power_rankings(ESPN_LEAGUE_ID, ESPN_SEASON_YEAR, ESPN_S2, ESPN_SWID)
    except Exception:
        data = None
    teams = (data or {}).get("teams", [])
    weeks = (data or {}).get("weeks", [])
    if not teams:
        st.info("Power rankings unavailable.")
        return

    st.caption(
        "Ranked by **all-play win %** - how each team would score against the whole league "
        "every week, so schedule luck is stripped out. **Move** is the change from last week, "
        "**Form** compares the last three weeks to the season, and **SoS** is the average "
        "all-play strength of the opponents faced."
    )

    def _arrow(d):
        if d > 0:
            return f"+{d}"
        if d < 0:
            return f"{d}"
        return "0"

    rows = []
    for t in teams:
        w, l, ti = t["record"]
        rows.append({
            "Rank": t["rank"],
            "Move": _arrow(t["delta"]),
            "Team": t["team_name"],
            "Power %": f"{t['power_pct'] * 100:.1f}%",
            "Form": t["form"],
            "L3 %": f"{t['recent_pct'] * 100:.1f}%",
            "SoS %": f"{t['sos'] * 100:.1f}%",
            "All-Play": f"{w}-{l}-{ti}",
        })
    render_sortable_table(pd.DataFrame(rows), "power_rank", default_col="Rank",
                          default_desc=False, max_height=1000)

    if weeks and len(weeks) >= 2:
        st.markdown('<h3><i class="bi bi-activity" style="color: var(--cobalt);"></i> Rank Movement</h3>', unsafe_allow_html=True)
        st.caption(f"Weekly power-rank path. **{resolved}** is highlighted.")
        st.plotly_chart(create_rank_trend_chart(teams, weeks, resolved), width='stretch')


# =============================================================================
# TRADE ANALYZER / PLAYER VALUE
# =============================================================================

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


@st.cache_data(ttl=3600, show_spinner="Valuing players...")
def get_player_pool(league_id, year, espn_s2, swid, fa_size=150):
    """
    Every rostered player (all teams) plus the top free agents, each with per-game
    category stats, a 9-cat z-score **Value**, a last-30 **Recent** value on the same
    scale, and their **Trend** (Recent - Value). Powers the Trade Analyzer. Cached.
    """
    league = get_league_cached(league_id, year, espn_s2, swid)
    owner = {}
    season_frames, last30_frames = [], []
    for t in league.teams:
        for p in t.roster:
            owner[p.name] = t.team_name
        season_frames.append(build_stat_df(t.roster, f"{year}_total", "Season", t.team_name, year))
        last30_frames.append(build_stat_df(t.roster, f"{year}_last_30", "Last30", t.team_name, year))
    try:
        fas = league.free_agents(size=fa_size)
    except Exception:
        fas = []
    for p in fas:
        owner.setdefault(getattr(p, "name", ""), "FA")
    season_frames.append(build_stat_df(fas, f"{year}_total", "Season", "FA", year))
    last30_frames.append(build_stat_df(fas, f"{year}_last_30", "Last30", "FA", year))

    season_df = pd.concat([f for f in season_frames if not f.empty], ignore_index=True) \
        if any(not f.empty for f in season_frames) else pd.DataFrame()
    last30_df = pd.concat([f for f in last30_frames if not f.empty], ignore_index=True) \
        if any(not f.empty for f in last30_frames) else pd.DataFrame()
    if season_df.empty:
        return []
    season_df = season_df.drop_duplicates("Player", keep="first").reset_index(drop=True)
    if not last30_df.empty:
        last30_df = last30_df.drop_duplicates("Player", keep="first").reset_index(drop=True)

    season_df["Value"] = _nine_cat_value(season_df, season_df).values
    if not last30_df.empty:
        recent = _nine_cat_value(last30_df, season_df)
        recent_map = dict(zip(last30_df["Player"], recent))
    else:
        recent_map = {}
    season_df["Recent"] = season_df["Player"].map(recent_map)
    season_df["Recent"] = season_df["Recent"].fillna(season_df["Value"])
    season_df["Trend"] = season_df["Recent"] - season_df["Value"]
    season_df["Owner"] = season_df["Player"].map(owner).fillna("FA")

    keep = (["Player", "NBA_Team", "Owner", "Value", "Recent", "Trend",
             "FG%", "FT%", "3P%"] + _AGG_KEYS)
    keep = list(dict.fromkeys([c for c in keep if c in season_df.columns]))
    return season_df[keep].to_dict("records")


def _team_agg(records):
    """Sum per-game category production over a set of player records."""
    return {k: float(sum(float(r.get(k, 0) or 0) for r in records)) for k in _AGG_KEYS}


def _cat9_record(a, b):
    """9-cat W-L-T for aggregate a vs aggregate b (TO lower = better; % from makes/attempts)."""
    def pct(s, made, att):
        return s.get(made, 0) / s[att] if s.get(att, 0) else 0.0
    yw = ow = tie = 0
    comps = [("PTS", 1), ("REB", 1), ("AST", 1), ("STL", 1), ("BLK", 1), ("3PM", 1), ("TO", -1)]
    for cat, direction in comps:
        x, y = a.get(cat, 0) * direction, b.get(cat, 0) * direction
        if x > y:
            yw += 1
        elif x < y:
            ow += 1
        else:
            tie += 1
    for made, att in (("FGM", "FGA"), ("FTM", "FTA")):
        x, y = pct(a, made, att), pct(b, made, att)
        if x > y:
            yw += 1
        elif x < y:
            ow += 1
        else:
            tie += 1
    return yw, ow, tie


def _all_play_cats(you_agg, other_aggs):
    """Sum of 9-cat wins / losses / ties of you_agg against every other team aggregate."""
    w = l = t = 0
    for oa in other_aggs:
        yw, ow, tie = _cat9_record(you_agg, oa)
        w += yw; l += ow; t += tie
    return w, l, t


def render_trade_analyzer(meta, team_name):
    """Player value (9-cat), buy-low / sell-high trends, and a live trade simulator."""
    st.markdown('<h2><i class="bi bi-arrow-left-right" style="color: var(--cobalt);"></i> Trade Analyzer</h2>', unsafe_allow_html=True)
    resolved = team_name
    try:
        league = get_league_cached(ESPN_LEAGUE_ID, ESPN_SEASON_YEAR, ESPN_S2, ESPN_SWID)
        _, resolved = resolve_team_id(league, team_name, DEFAULT_TEAM_ID)
        pool = get_player_pool(ESPN_LEAGUE_ID, ESPN_SEASON_YEAR, ESPN_S2, ESPN_SWID)
    except Exception:
        pool = []
    if not pool:
        st.info("Player values unavailable.")
        return

    df = pd.DataFrame(pool)
    by_name = {r["Player"]: r for r in pool}
    mine = df[df["Owner"] == resolved]
    if mine.empty:
        st.warning(f"No rostered players found for {resolved}.")
        return

    st.caption(
        "**Value** is a 9-category z-score (points above/below an average leaguer, turnovers "
        "and percentages included). **Trend** is the last 30 days versus the season on that same "
        "scale: positive = heating up. Values cover every rostered player plus the top free agents."
    )

    disp_cats = ["PTS", "REB", "AST", "STL", "BLK", "3PM", "TO"]

    def _value_rows(sub):
        out = []
        for _, r in sub.iterrows():
            row = {"Player": r["Player"], "NBA": r.get("NBA_Team", ""),
                   "Value": round(float(r["Value"]), 1), "Trend": round(float(r["Trend"]), 1)}
            for c in disp_cats:
                row[c] = round(float(r.get(c, 0) or 0), 1)
            row["FG%"] = f"{float(r.get('FG%', 0) or 0) * 100:.1f}%"
            row["FT%"] = f"{float(r.get('FT%', 0) or 0) * 100:.1f}%"
            out.append(row)
        return pd.DataFrame(out)

    st.markdown(f'<h3><i class="bi bi-person-badge" style="color: var(--cobalt);"></i> {resolved} - Player Value</h3>', unsafe_allow_html=True)
    render_sortable_table(_value_rows(mine), "tv_mine", default_col="Value")

    # Buy-low / sell-high
    st.markdown('<h3><i class="bi bi-arrow-down-up" style="color: var(--clay);"></i> Buy Low / Sell High</h3>', unsafe_allow_html=True)
    c1, c2 = st.columns(2, gap="large")
    with c1:
        st.markdown('<h4 style="color: var(--good);">Sell High - your risers</h4>', unsafe_allow_html=True)
        risers = mine.sort_values("Trend", ascending=False).head(5)
        risers = risers[risers["Trend"] > 0.3]
        if risers.empty:
            st.markdown('<p style="color: var(--ink-2);">No one clearly overperforming right now.</p>', unsafe_allow_html=True)
        else:
            for _, r in risers.iterrows():
                st.markdown(
                    f"<div style='padding:0.5rem 0; border-bottom:1px solid var(--line-2);'>"
                    f"<strong style='color:var(--ink);'>{r['Player']}</strong> "
                    f"<span style='color:var(--good); font-family:ui-monospace,Consolas,monospace;'>+{r['Trend']:.1f}</span> "
                    f"<span style='color:var(--ink-2);'>trend, value {r['Value']:.1f}</span></div>",
                    unsafe_allow_html=True,
                )
    with c2:
        st.markdown('<h4 style="color: var(--cobalt);">Buy Low - slumping targets</h4>', unsafe_allow_html=True)
        others = df[(df["Owner"] != resolved) & (df["Owner"] != "FA")]
        targets = others[(others["Value"] > 3.0) & (others["Trend"] < -0.3)].sort_values("Trend").head(5)
        if targets.empty:
            st.markdown('<p style="color: var(--ink-2);">No obviously slumping quality players on other rosters.</p>', unsafe_allow_html=True)
        else:
            for _, r in targets.iterrows():
                st.markdown(
                    f"<div style='padding:0.5rem 0; border-bottom:1px solid var(--line-2);'>"
                    f"<strong style='color:var(--ink);'>{r['Player']}</strong> "
                    f"<span style='color:var(--bad); font-family:ui-monospace,Consolas,monospace;'>{r['Trend']:.1f}</span> "
                    f"<span style='color:var(--ink-2);'>trend, value {r['Value']:.1f} ({r['Owner']})</span></div>",
                    unsafe_allow_html=True,
                )

    # Trade simulator
    st.markdown('<h3><i class="bi bi-shuffle" style="color: var(--cobalt);"></i> Trade Simulator</h3>', unsafe_allow_html=True)
    st.caption("Pick players to give and receive, then see how your category strength moves.")
    my_names = sorted(mine["Player"].tolist())
    other_names = sorted(df[df["Owner"] != resolved]["Player"].tolist())
    cg1, cg2 = st.columns(2, gap="large")
    with cg1:
        give = st.multiselect("You give", my_names, key="trade_give")
    with cg2:
        get = st.multiselect("You get", other_names, key="trade_get")

    # Other teams' aggregates (for an all-play category record).
    other_team_records = {}
    for r in pool:
        o = r["Owner"]
        if o in (resolved, "FA"):
            continue
        other_team_records.setdefault(o, []).append(r)
    other_aggs = [_team_agg(v) for v in other_team_records.values()]

    before_records = list(mine.to_dict("records"))
    after_records = [r for r in before_records if r["Player"] not in set(give)]
    after_records += [by_name[n] for n in get if n in by_name]

    before_agg = _team_agg(before_records)
    after_agg = _team_agg(after_records)

    give_val = sum(float(by_name[n]["Value"]) for n in give if n in by_name)
    get_val = sum(float(by_name[n]["Value"]) for n in get if n in by_name)

    if give or get:
        net = get_val - give_val
        net_color = "var(--good)" if net > 0 else "var(--bad)" if net < 0 else "var(--ink-2)"
        bw, bl, bt = _all_play_cats(before_agg, other_aggs) if other_aggs else (0, 0, 0)
        aw, al, at = _all_play_cats(after_agg, other_aggs) if other_aggs else (0, 0, 0)

        m1, m2, m3 = st.columns(3)
        with m1:
            st.metric("Value out", f"{give_val:.1f}", help="Combined 9-cat value you send away.")
        with m2:
            st.metric("Value in", f"{get_val:.1f}", help="Combined 9-cat value you receive.")
        with m3:
            st.metric("Net value", f"{net:+.1f}", delta=f"{net:+.1f}")
        st.markdown(
            f"<p style='color:var(--ink-2);'>All-play category record "
            f"<strong style='color:var(--ink);'>{bw}-{bl}-{bt}</strong> "
            f"&rarr; <strong style='color:{net_color};'>{aw}-{al}-{at}</strong> "
            f"(vs the rest of the league every week).</p>",
            unsafe_allow_html=True,
        )

        # Per-category shift table
        cat_disp = [("PTS", "PTS"), ("REB", "REB"), ("AST", "AST"), ("STL", "STL"),
                    ("BLK", "BLK"), ("3PM", "3PM"), ("TO", "TO")]
        rows = []
        for key, lab in cat_disp:
            b, a = before_agg.get(key, 0), after_agg.get(key, 0)
            d = a - b
            good = (d < 0) if key == "TO" else (d > 0)
            color = "var(--good)" if abs(d) > 1e-9 and good else "var(--bad)" if abs(d) > 1e-9 else "var(--ink-2)"
            rows.append((lab, b, a, d, color))
        for made, att, lab in (("FGM", "FGA", "FG%"), ("FTM", "FTA", "FT%")):
            b = before_agg.get(made, 0) / before_agg[att] if before_agg.get(att, 0) else 0
            a = after_agg.get(made, 0) / after_agg[att] if after_agg.get(att, 0) else 0
            d = a - b
            color = "var(--good)" if d > 1e-9 else "var(--bad)" if d < -1e-9 else "var(--ink-2)"
            rows.append((lab, b * 100, a * 100, d * 100, color, True))

        ink2, line = "var(--ink-2)", "var(--line)"
        head = "".join(
            f"<th style='padding:7px 10px; text-align:{al}; font-size:0.64rem; letter-spacing:0.05em; "
            f"text-transform:uppercase; color:{ink2};'>{h}</th>"
            for h, al in [("Category", "left"), ("Now", "right"), ("After", "right"), ("Change", "right")]
        )
        body = ""
        for row in rows:
            lab, b, a, d, color = row[0], row[1], row[2], row[3], row[4]
            is_pct = len(row) > 5
            bf = f"{b:.1f}%" if is_pct else f"{b:.1f}"
            af = f"{a:.1f}%" if is_pct else f"{a:.1f}"
            df_ = (f"{d:+.1f}%" if is_pct else f"{d:+.1f}") if abs(d) > 1e-9 else "-"
            body += (
                f"<tr style='border-bottom:1px solid var(--line-2);'>"
                f"<td style='padding:6px 10px; color:var(--ink); font-weight:600;'>{lab}</td>"
                f"<td style='padding:6px 10px; text-align:right; font-family:ui-monospace,Consolas,monospace; color:var(--ink-2);'>{bf}</td>"
                f"<td style='padding:6px 10px; text-align:right; font-family:ui-monospace,Consolas,monospace; color:var(--ink);'>{af}</td>"
                f"<td style='padding:6px 10px; text-align:right; font-family:ui-monospace,Consolas,monospace; color:{color};'>{df_}</td></tr>"
            )
        st.markdown(
            f"<div style='border:1px solid {line}; border-radius:10px; overflow-x:auto; "
            f"background:var(--card); max-width:560px;'>"
            f"<table style='width:100%; border-collapse:collapse; font-size:0.8rem;'>"
            f"<thead><tr style='background:var(--surface-2);'>{head}</tr></thead>"
            f"<tbody>{body}</tbody></table></div>",
            unsafe_allow_html=True,
        )
        st.caption("Per-game team totals (sum of projected per-game production). "
                   "Green = the trade helps that category; red = it hurts.")
    else:
        st.markdown('<p style="color: var(--ink-2);">Select at least one player to simulate a trade.</p>', unsafe_allow_html=True)


def warm_caches(sim_count, blend_weight, team_name):
    """
    Kick off the heavy computations in a background thread on app load, so League
    Stats / Season Summary / Playoff Odds are ready (or nearly) by the time they're
    clicked. Streamlit's cache lock means a click that lands mid-warm waits for the
    in-flight result instead of recomputing.
    """
    if st.session_state.get("_caches_warmed"):
        return
    st.session_state["_caches_warmed"] = True
    lid, yr, s2, swid = ESPN_LEAGUE_ID, ESPN_SEASON_YEAR, ESPN_S2, ESPN_SWID

    def _warm():
        try:
            league = get_league_cached(lid, yr, s2, swid)
            try:
                tid, _ = resolve_team_id(league, team_name, DEFAULT_TEAM_ID)
                get_team_season_stats(lid, yr, s2, swid, tid)
                get_team_schedule_data(lid, yr, s2, swid, tid)
            except Exception:
                pass
            try:
                get_power_rankings(lid, yr, s2, swid)
                get_player_pool(lid, yr, s2, swid)
            except Exception:
                pass
            injury = get_injury_cached()
            stats = get_season_stats(lid, yr, s2, swid)
            get_playoff_probabilities(yr, int(sim_count), stats, blend_weight, injury)
        except Exception:
            pass

    threading.Thread(target=_warm, daemon=True).start()


WEEK_PAGES = ("Matchup", "Streamers", "Bench", "Roster")
SEASON_PAGES = ("Season Summary", "Season Stats", "League Stats", "Playoff Odds")
TOOLS_PAGES = ("Schedule", "Power Rankings", "Trade Analyzer")

# Section-based navigation. Each section groups related pages. The top bar (desktop)
# and the fixed bottom icon bar (mobile) show one control per section; a labeled
# sub-row exposes the pages inside a multi-page section. Section icons are attached by
# key in styles.py (CSS ::before with Bootstrap Icons) so the buttons keep their click
# handling. Home is the brand lockup; Settings is the gear.  key -> (label, pages)
NAV_SECTIONS = (
    ("home",     "Home",      ("Home",)),
    ("week",     "This Week", WEEK_PAGES),
    ("season",   "Season",    SEASON_PAGES),
    ("tools",    "Tools",     TOOLS_PAGES),
    ("settings", "Settings",  ("Settings",)),
)


def _section_for_page(page):
    """Which nav section owns a page (defaults to Home)."""
    for key, _label, pages in NAV_SECTIONS:
        if page in pages:
            return key
    return "home"


def _section_landing(key, pages, season_over):
    """The page a section opens to. Season skips the (offseason-only) Summary until it exists."""
    if key == "season" and not season_over:
        return "Season Stats"
    return pages[0]


# App settings (formerly the sidebar). Kept in session_state under cfg_* keys so
# they persist when the Settings page's widgets aren't rendered.
SETTINGS_DEFAULTS = {
    "cfg_team": DEFAULT_TEAM_NAME,
    "cfg_sims": 10000,
    "cfg_streamers": 50,
    "cfg_trust_returns": False,
    "cfg_open_spot": False,
    "cfg_untouchables": "",
    "cfg_watchlist": "",
}


def init_settings():
    """Seed defaults and re-register values so Streamlit keeps them across pages."""
    for k, v in SETTINGS_DEFAULTS.items():
        st.session_state[k] = st.session_state.get(k, v)


def render_settings(meta):
    """Settings page - everything that used to live in the sidebar."""
    st.markdown('<h2><i class="bi bi-gear-fill"></i> Settings</h2>', unsafe_allow_html=True)
    st.caption("Applies to every page. Choices persist while the app is open.")

    c1, c2 = st.columns(2, gap="large")
    with c1:
        st.markdown('<h4><i class="bi bi-person-badge"></i> Team</h4>', unsafe_allow_html=True)
        options = list(meta["names"]) if meta else []
        if st.session_state["cfg_team"] not in options:
            options = [st.session_state["cfg_team"]] + options
        st.selectbox("Team Name", options, key="cfg_team",
                     help="Which team in your ESPN league to analyze.")
        if not meta:
            st.caption("Couldn't load teams from ESPN - using the saved team name.")

        st.markdown('<h4><i class="bi bi-sliders"></i> Simulation</h4>', unsafe_allow_html=True)
        st.slider("Simulations", 1000, 50000, step=1000, key="cfg_sims",
                  help="Monte Carlo draws for the matchup gauge. The Playoff page uses a capped "
                       "count, so very high values mainly affect the matchup view.")
        st.slider("Streamers to Analyze", 5, 100, step=5, key="cfg_streamers",
                  help="Number of free agents to analyze on the Streamers page.")

        st.markdown('<h4><i class="bi bi-shield-fill"></i> Roster</h4>', unsafe_allow_html=True)
        st.checkbox("Trust injury return dates", key="cfg_trust_returns",
                    help="When checked, injured players with a listed return date are projected to "
                         "play on/after that date. Unchecked treats them as out for the week.")
        st.checkbox("I have an open roster spot", key="cfg_open_spot",
                    help="Check if you can add a player without dropping anyone.")
    with c2:
        st.markdown('<h4><i class="bi bi-lock-fill"></i> Untouchable Players</h4>', unsafe_allow_html=True)
        st.text_area("Untouchable Players", key="cfg_untouchables", height=170,
                     label_visibility="collapsed",
                     help="One name per line. Never recommended as drops.",
                     placeholder="Shai Gilgeous-Alexander\nJalen Williams\nAlex Caruso")

        st.markdown('<h4><i class="bi bi-star-fill"></i> Watchlist</h4>', unsafe_allow_html=True)
        st.text_area("Manual Watchlist", key="cfg_watchlist", height=170,
                     label_visibility="collapsed",
                     help="One name per line. Prioritized in streamer analysis and marked with 'W'.",
                     placeholder="Paste player names from your ESPN watchlist here\nOne name per line")


def render_home(meta, team_name):
    """Landing page: a short overview plus quick links into the app."""
    league_name = meta.get("league_name", "Your League") if meta else "Your League"
    today = datetime.now(ZoneInfo("America/New_York")).date()
    status = "Season complete" if today > SEASON_END_DATE else "Season in progress"

    st.markdown(
        f"""
        <div style="text-align:center; padding:2.6rem 1rem 1.4rem;">
            <div style="font-family: system-ui, Segoe UI, sans-serif; font-size:0.72rem;
                        letter-spacing:0.16em; text-transform:uppercase; color:var(--ink-2);">
                {league_name} &middot; {status}
            </div>
            <div class="main-header" style="font-size:2.6rem; margin-top:0.3rem;">FANTASY BASKETBALL SIMULATOR</div>
            <p style="color:var(--ink-2); max-width:560px; margin:0.7rem auto 0;">
                Monte Carlo projections and season analytics for your ESPN league.
                You're analyzing <strong style="color:var(--ink);">{team_name}</strong>.
            </p>
        </div>
        """,
        unsafe_allow_html=True,
    )

    def _go(page):
        st.session_state.active_page = page

    links = [
        ("Season Summary", "Final standings, champion &amp; all-play", "Season Summary", "bi-trophy-fill"),
        ("Current Matchup", "Weekly matchup, win % &amp; category sims", "Matchup", "bi-bar-chart-fill"),
        ("League Stats", "Team records &amp; category totals", "League Stats", "bi-table"),
        ("Playoff Odds", "Championship probabilities", "Playoff Odds", "bi-diagram-3-fill"),
    ]
    with st.container(key="home_links"):
        cols = st.columns(4, gap="medium")
        for col, (title, desc, target, icon) in zip(cols, links):
            with col:
                st.markdown(
                    f"""
                    <div class="home-card">
                        <div class="home-card-icon"><i class="bi {icon}"></i></div>
                        <div class="home-card-title">{title}</div>
                        <div class="home-card-desc">{desc}</div>
                    </div>
                    """,
                    unsafe_allow_html=True,
                )
                st.button("Open", key=f"home_{target}", on_click=_go, args=(target,),
                          width='stretch')


# Desktop header items. Each is either a plain page link or a dropdown menu:
#   ("link", label, page)
#   ("menu", label, ((sub-label, page), ...))   -> a st.popover dropdown
# The This Week pages (Matchup/Streamers/Bench/Roster) are NOT here — they live in the
# left "This Week" side rail, entered via "Current Matchup". Season Summary only over.
FLAT_NAV = (
    ("link", "Season Summary", "Season Summary"),
    ("link", "Current Matchup", "Matchup"),
    ("link", "Schedule", "Schedule"),
    ("menu", "Stats", (("Season", "Season Stats"), ("League", "League Stats"))),
    ("menu", "Tools", (("Power Rankings", "Power Rankings"),
                       ("Playoff Odds", "Playoff Odds"),
                       ("Trade Analyzer", "Trade Analyzer"))),
)


def render_top_nav(meta, team_name):
    """
    Navigation. Desktop and mobile intentionally differ.

    - Desktop: ONE fixed flat header row — brand (= Home), a text link per page (no
      icons), Settings gear on the right; scrolls sideways if it can't all fit. Plus a
      **left "This Week" side rail** (Streamlit's sidebar) that appears only on the This
      Week pages (Matchup/Streamers/Bench/Roster) with the Week picker + those four links.
    - Mobile: the header keeps only the brand; sections are reached from a fixed bottom
      ICON bar, Season/Tools sub-pages from a sub-row, and This Week from the same side
      rail turned into a fixed sub-bar under the header. All hidden/adapted via CSS.
    """
    view_map = build_week_views()
    week_labels = [l for l in view_map if l != SEASON_SUMMARY_VIEW]

    if "active_page" not in st.session_state:
        st.session_state.active_page = "Home"
    # Keep the week choice alive even when the picker (a rail widget) isn't rendered.
    if "week_sel" not in st.session_state:
        dl = period_to_view_label(meta["current_period"], view_map) if meta else None
        st.session_state.week_sel = dl if dl in week_labels else week_labels[-1]
    else:
        st.session_state.week_sel = st.session_state.week_sel

    active = st.session_state.active_page
    season_over = datetime.now(ZoneInfo("America/New_York")).date() > SEASON_END_DATE
    active_section = _section_for_page(active)

    def _go(page):
        st.session_state.active_page = page

    items = [it for it in FLAT_NAV if it[1] != "Season Summary" or season_over]

    # -------- Desktop header: brand(Home) | page links + dropdowns | Settings gear ----
    # Centered cluster (no growing spacer) so the nav doesn't stretch across the whole bar.
    with st.container(key="nav_top"):
        # a menu label needs a touch more room for its dropdown caret
        ratios = ([2.2]
                  + [round(0.55 + 0.072 * (len(it[1]) + (2 if it[0] == "menu" else 0)), 2)
                     for it in items]
                  + [0.55])
        cols = st.columns(ratios, gap="small", vertical_alignment="center")
        cols[0].button("Fantasy Basketball", key="nav_brand", width='stretch',
                       on_click=_go, args=("Home",),
                       type="primary" if active == "Home" else "secondary")
        for i, item in enumerate(items):
            col = cols[i + 1]
            if item[0] == "link":
                lab, pg = item[1], item[2]
                # "Current Matchup" stays highlighted for any This Week page.
                is_active = (active in WEEK_PAGES) if pg == "Matchup" else (active == pg)
                col.button(lab, key=f"navf_{i}", width='stretch',
                           on_click=_go, args=(pg,),
                           type="primary" if is_active else "secondary")
            else:  # dropdown menu (st.popover)
                lab, subs = item[1], item[2]
                sub_pages = [p for _, p in subs]
                on = active in sub_pages
                # unique per-menu key; the `_active` suffix drives the underline via CSS
                slug = lab.lower().replace(" ", "")
                with col:
                    with st.container(key=f"navmenu_{slug}" + ("_active" if on else "")):
                        with st.popover(lab, use_container_width=True):
                            for sl, sp in subs:
                                st.button(sl, key=f"navm_{sp.replace(' ', '_')}", width='stretch',
                                          on_click=_go, args=(sp,),
                                          type="primary" if active == sp else "secondary")
        cols[-1].button("Settings", key="navp_settings", width='stretch',
                        on_click=_go, args=("Settings",),
                        type="primary" if active == "Settings" else "secondary")

    # -------- "This Week" side rail: only on This Week pages (left rail / mobile sub-bar) --
    if active in WEEK_PAGES:
        with st.sidebar:
            st.markdown("<div class='nav-scope-label'>This Week</div>", unsafe_allow_html=True)
            st.selectbox("Week / Round", week_labels, key="week_sel",
                         label_visibility="collapsed")
            for i, pg in enumerate(WEEK_PAGES):
                st.button(pg, key=f"navw_{i}", width='stretch',
                          on_click=_go, args=(pg,),
                          type="primary" if active == pg else "secondary")

    # -------- Mobile bottom bar: one icon per section (CSS hides it on desktop) --------
    with st.container(key="nav_bottom"):
        bcols = st.columns(len(NAV_SECTIONS), gap="small")
        for i, (key, label, pages) in enumerate(NAV_SECTIONS):
            bcols[i].button(label, key=f"navb_{key}", width='stretch',
                            on_click=_go, args=(_section_landing(key, pages, season_over),),
                            type="primary" if active_section == key else "secondary")

    # -------- Mobile sub-row: Season/Tools sub-pages (This Week uses the rail above) -----
    sub_label, sub_pages = None, None
    for key, label, pages in NAV_SECTIONS:
        if key == active_section and key in ("season", "tools") and len(pages) > 1:
            sub_label, sub_pages = label, list(pages)
    if sub_pages and active_section == "season" and not season_over:
        sub_pages = [p for p in sub_pages if p != "Season Summary"]
    if sub_pages:
        with st.container(key="nav_sub"):
            cols = st.columns([1.1] + [1.0] * len(sub_pages), gap="small",
                              vertical_alignment="center")
            cols[0].markdown(f"<div class='nav-scope-label'>{sub_label}</div>",
                             unsafe_allow_html=True)
            for i, pg in enumerate(sub_pages):
                cols[i + 1].button(pg, key=f"navsub_{i}", width='stretch',
                                   on_click=_go, args=(pg,),
                                   type="primary" if active == pg else "secondary")

    return st.session_state.active_page, st.session_state.week_sel, view_map[st.session_state.week_sel]


def main():
    # Settings live on their own nav page; values persist in session_state.
    init_settings()

    try:
        league_meta = get_league_meta(ESPN_LEAGUE_ID, ESPN_SEASON_YEAR, ESPN_S2, ESPN_SWID)
    except Exception:
        league_meta = None

    team_name = st.session_state["cfg_team"]
    sim_count = int(st.session_state["cfg_sims"])
    num_streamers = int(st.session_state["cfg_streamers"])
    trust_return_dates = bool(st.session_state["cfg_trust_returns"])
    has_open_spot = bool(st.session_state["cfg_open_spot"])
    untouchables = [p.strip() for p in st.session_state["cfg_untouchables"].split("\n") if p.strip()]
    manual_watchlist = [p.strip() for p in st.session_state["cfg_watchlist"].split("\n") if p.strip()]

    # Warm the heavy season/league/playoff caches in the background on first load.
    warm_caches(sim_count, 0.7, team_name)

    # Two-tier top navigation: season pages up top, week pages (with a picker) below.
    active_page, selected_view_label, selected_view_period = render_top_nav(league_meta, team_name)

    # Standalone pages - no week context needed.
    if active_page == "Home":
        render_home(league_meta, team_name)
        return
    if active_page == "Season Summary":
        render_season_summary(league_meta, team_name)
        return
    if active_page == "Schedule":
        render_schedule(league_meta, team_name)
        return
    if active_page == "Power Rankings":
        render_power_rankings(league_meta, team_name)
        return
    if active_page == "Trade Analyzer":
        render_trade_analyzer(league_meta, team_name)
        return
    if active_page == "Settings":
        render_settings(league_meta)
        return

    if active_page:
        try:
            year = ESPN_SEASON_YEAR
            with st.spinner("Loading from ESPN..."):
                league = get_league_cached(ESPN_LEAGUE_ID, ESPN_SEASON_YEAR, ESPN_S2, ESPN_SWID)
                injury_data = get_injury_cached()
                team_id, resolved_team_name = resolve_team_id(league, team_name, DEFAULT_TEAM_ID)
            
            # League's live period, and the period the user chose to view.
            league_cw = current_matchup_period_effective(league)
            st.session_state["league_matchup_period"] = league_cw
            view_period = selected_view_period if selected_view_period is not None else league_cw

            eastern = ZoneInfo("America/New_York")
            today_date = datetime.now(eastern).date()
            season_over = today_date > SEASON_END_DATE
            is_live_view = (not season_over) and (view_period == league_cw)

            blend_weight = 0.7  # used for bracket projection + stat merge below
            # Get matchup info for the selected period
            with st.spinner("Loading matchup data..."):
                your_team_obj, opp_team_obj, matchup, current_week = get_matchup_info(
                    league, team_id, matchup_period=view_period
                )
                your_team_name = your_team_obj.team_name
                opp_team_name = opp_team_obj.team_name
                current_you, current_opp = get_current_totals(matchup, team_id)

            playoff_round = None
            week_in_round = None
            if is_live_view:
                # Live period: game window runs from today through the period end.
                period_end_date = None
                for round_idx, (p_start, p_end) in enumerate(PLAYOFF_SCORING_DATES, start=1):
                    if p_start <= today_date <= p_end:
                        period_end_date = p_end
                        playoff_round = round_idx
                        week_in_round = (today_date - p_start).days // 7 + 1
                        break
                if period_end_date is not None:
                    week_span = 2 if (period_end_date - today_date).days >= 7 else 1
                else:
                    week_span = 2 if league_cw > REGULAR_SEASON_WEEKS else 1
                game_window_start, game_window_end = get_game_count_window(
                    year, current_week, league_cw,
                    period_end_date=period_end_date, week_span=week_span,
                )
            else:
                # Historical (or non-current) view: use that period's own date range.
                # Completed weeks have no games left, so results show as final.
                game_window_start, game_window_end, week_span, period_end_date = resolve_view_window(view_period, year)

            if active_page in WEEK_PAGES:
                # (Week/Round picker lives in the left "This Week" side rail, not here.)
                col1, col2, col3 = st.columns([2, 1, 2], vertical_alignment="center")
                with col1:
                    st.markdown(f'<h3><i class="bi bi-house-fill" style="color: var(--cobalt);"></i> {your_team_name}</h3>', unsafe_allow_html=True)
                with col2:
                    st.markdown(f"<h3 style='text-align: center; color: var(--cobalt);'>{selected_view_label}</h3>", unsafe_allow_html=True)
                with col3:
                    st.markdown(f'<h3><i class="bi bi-person-fill" style="color: var(--clay);"></i> {opp_team_name}</h3>', unsafe_allow_html=True)
                if is_live_view:
                    st.caption(
                        f"NBA games in this projection: **{game_window_start:%b %d} – {game_window_end:%b %d}**"
                    )
                else:
                    st.caption(
                        f"Final results for **{selected_view_label}** "
                        f"(NBA games **{game_window_start:%b %d} – {game_window_end:%b %d}**). "
                        f"Completed matchups show final totals - no games remain to simulate."
                    )

            # Build player stats
            status_text = st.empty()
            progress = st.progress(0)
            status_text.text("Loading player stats...")
            
            your_roster = your_team_obj.roster
            opp_roster = opp_team_obj.roster
            
            your_season = build_stat_df(your_roster, f"{year}_total", "Season", your_team_name, year)
            your_last30 = build_stat_df(your_roster, f"{year}_last_30", "Last30", your_team_name, year)
            opp_season = build_stat_df(opp_roster, f"{year}_total", "Season", opp_team_name, year)
            opp_last30 = build_stat_df(opp_roster, f"{year}_last_30", "Last30", opp_team_name, year)
            
            progress.progress(25)
            status_text.text("NBA schedules & games left...")
            
            _ag_kw = dict(
                trust_return_dates=trust_return_dates,
                week_span=week_span,
                period_end_date=period_end_date,
                window_start=game_window_start,
                window_end=game_window_end,
            )
            # Warm cache in parallel, then one schedule pass per fantasy team (was four).
            prefetch_team_schedules_for_rosters(your_roster, opp_roster)
            your_merged = blend_season_last30(your_season, your_last30, blend_weight)
            opp_merged = blend_season_last30(opp_season, opp_last30, blend_weight)
            your_merged = add_games_left_with_injury(your_merged, your_roster, injury_data, **_ag_kw)
            opp_merged = add_games_left_with_injury(opp_merged, opp_roster, injury_data, **_ag_kw)
            
            progress.progress(50)
            status_text.text("Preparing matchup simulation...")
            
            your_team_df = your_merged.copy()
            opp_team_df = opp_merged.copy()
            
            your_team_df = your_team_df[your_team_df["Games Left"] > 0]
            opp_team_df = opp_team_df[opp_team_df["Games Left"] > 0]
            
            progress.progress(75)
            status_text.text(f"Running {sim_count:,} simulations...")
            
            # Run simulation (higher variance early in week - Mon/Tue - when 95% is too confident)
            matchup_variance = _get_matchup_variance_multiplier()
            your_sim_raw = simulate_team(your_team_df, sims=sim_count, variance_multiplier=matchup_variance)
            opp_sim_raw = simulate_team(opp_team_df, sims=sim_count, variance_multiplier=matchup_variance)
            
            your_sim = add_current_to_sim(current_you, your_sim_raw)
            opp_sim = add_current_to_sim(current_opp, opp_sim_raw)
            
            matchup_results, category_results, outcome_counts = compare_matchups(your_sim, opp_sim, CATEGORIES)
            
            progress.progress(100)
            status_text.text("Complete!")
            progress.empty()
            status_text.empty()
            
            # Calculate key metrics
            total_sims = sum(matchup_results.values())
            win_pct = matchup_results["you"] / total_sims * 100
            baseline_avg_cats = sum(your_w * count for (your_w, opp_w), count in outcome_counts.items()) / total_sims
            
            # Store data in session state for tabs
            st.session_state['simulation_done'] = True
            st.session_state['league'] = league
            st.session_state['year'] = year
            st.session_state['team_id'] = team_id
            
            # League stats power the League Stats, Playoff, and Streamer pages (cached).
            league_stats = None
            if active_page in ("League Stats", "Playoff Odds", "Streamers"):
                with st.spinner("Calculating league statistics..."):
                    league_stats = get_season_stats(ESPN_LEAGUE_ID, ESPN_SEASON_YEAR, ESPN_S2, ESPN_SWID)
            
            # Pages are chosen by the top nav (active_page).
            
            # ==================== TAB 1: MATCHUP ANALYSIS ====================
            if active_page == "Matchup":
                st.markdown('<h2><i class="bi bi-bar-chart-fill" style="color: var(--cobalt);"></i> Simulation Results</h2>', unsafe_allow_html=True)
                
                # Current Scoreboard
                st.markdown('<h3><i class="bi bi-trophy-fill" style="color: var(--clay);"></i> Current Scoreboard</h3>', unsafe_allow_html=True)
                st.markdown(create_scoreboard(current_you, current_opp, your_team_name, opp_team_name), unsafe_allow_html=True)
                
                # Key metrics row
                st.markdown('<h3><i class="bi bi-graph-up-arrow" style="color: var(--good);"></i> Key Metrics</h3>', unsafe_allow_html=True)
                your_roster_games = int(your_team_df["Games Left"].sum())
                opp_roster_games = int(opp_team_df["Games Left"].sum())
                metric_cols = st.columns(5)
                with metric_cols[0]:
                    st.metric("Expected Cats", f"{baseline_avg_cats:.1f}", delta=f"{baseline_avg_cats - 7.5:.1f} vs even")
                with metric_cols[1]:
                    sorted_outcomes = sorted(outcome_counts.items(), key=lambda x: x[1], reverse=True)
                    most_likely = sorted_outcomes[0][0]
                    st.metric("Most Likely", f"{most_likely[0]}-{most_likely[1]}")
                with metric_cols[2]:
                    st.metric("Simulations", f"{sim_count:,}")
                with metric_cols[3]:
                    st.metric("Your Games Left", your_roster_games, help=f"{your_team_name}")
                with metric_cols[4]:
                    st.metric("Opp Games Left", opp_roster_games, help=f"{opp_team_name}")
                
                # Win probability gauge and Score Distribution side by side
                col1, col2 = st.columns([1, 1])
                
                with col1:
                    st.markdown('<h3><i class="bi bi-bullseye" style="color: var(--cobalt);"></i> Win Probability</h3>', unsafe_allow_html=True)
                    st.plotly_chart(create_win_probability_gauge(win_pct), width='stretch')
                
                with col2:
                    st.markdown('<h3><i class="bi bi-dice-5-fill" style="color: var(--clay);"></i> Score Distribution</h3>', unsafe_allow_html=True)
                    st.plotly_chart(create_outcome_distribution(outcome_counts, total_sims), width='stretch')
                
                # Category breakdown
                st.markdown('<h3><i class="bi bi-clipboard-data-fill" style="color: var(--cobalt);"></i> Category Analysis</h3>', unsafe_allow_html=True)
                st.plotly_chart(create_category_chart(category_results, your_sim, opp_sim), width='stretch')
                
                # Detailed category table (always open)
                st.markdown('<h3><i class="bi bi-table" style="color: var(--cobalt);"></i> Detailed Category Projections</h3>', unsafe_allow_html=True)
                cat_data = []
                for cat in CATEGORIES:
                    outcome = category_results[cat]
                    total_cat = sum(outcome.values())
                    you_pct = outcome["you"] / total_cat * 100
                    opp_pct = outcome["opponent"] / total_cat * 100

                    y_proj = np.mean(your_sim[cat])
                    o_proj = np.mean(opp_sim[cat])
                    y_ci = (np.percentile(your_sim[cat], 10), np.percentile(your_sim[cat], 90))
                    o_ci = (np.percentile(opp_sim[cat], 10), np.percentile(opp_sim[cat], 90))

                    is_swing = abs(you_pct - opp_pct) <= 15

                    if "%" in cat:
                        your_proj_str = f"{y_proj * 100:.1f}%"
                        opp_proj_str = f"{o_proj * 100:.1f}%"
                        your_ci_str = f"{y_ci[0] * 100:.0f}%-{y_ci[1] * 100:.0f}%"
                        opp_ci_str = f"{o_ci[0] * 100:.0f}%-{o_ci[1] * 100:.0f}%"
                    else:
                        your_proj_str = f"{y_proj:.1f}"
                        opp_proj_str = f"{o_proj:.1f}"
                        your_ci_str = f"{y_ci[0]:.1f} - {y_ci[1]:.1f}"
                        opp_ci_str = f"{o_ci[0]:.1f} - {o_ci[1]:.1f}"

                    cat_data.append({
                        "Category": cat,
                        "You Win %": f"{you_pct:.0f}%",
                        "Opp Win %": f"{opp_pct:.0f}%",
                        "Your Proj": your_proj_str,
                        "Opp Proj": opp_proj_str,
                        "Your CI": your_ci_str,
                        "Opp CI": opp_ci_str,
                        "Swing": "SWING" if is_swing else "",
                    })
                render_sortable_table(pd.DataFrame(cat_data), "detail_cat")
                st.caption("SWING = category within 15% either way. Click a header to sort. Rosters and injuries are on the **Roster** tab.")

            # ==================== ROSTER ====================
            if active_page == "Roster":
                st.markdown('<h2><i class="bi bi-people-fill" style="color: var(--cobalt);"></i> Rosters</h2>', unsafe_allow_html=True)
                st.markdown(
                    f'<p style="color: var(--ink-2);">Projected per-game stats and games left this period for '
                    f'<strong style="color: var(--ink);">{your_team_name}</strong> vs '
                    f'<strong style="color: var(--ink);">{opp_team_name}</strong>.</p>',
                    unsafe_allow_html=True,
                )
                roster_cols = ["Player", "NBA_Team", "Games Left", "PTS", "REB", "AST",
                               "STL", "BLK", "3PM", "TO", "FG%", "FT%"]

                st.markdown(f'<h3><i class="bi bi-house-fill" style="color: var(--cobalt);"></i> {your_team_name}</h3>', unsafe_allow_html=True)
                render_sortable_table(format_roster_for_display(your_team_df, roster_cols), "roster_you", default_col="Games Left")

                st.markdown(f'<h3><i class="bi bi-person-fill" style="color: var(--clay);"></i> {opp_team_name}</h3>', unsafe_allow_html=True)
                render_sortable_table(format_roster_for_display(opp_team_df, roster_cols), "roster_opp", default_col="Games Left")

                st.markdown('<h3><i class="bi bi-bandaid-fill" style="color: var(--clay);"></i> Injuries</h3>', unsafe_allow_html=True)
                injury_rows = build_injury_table(
                    [(your_roster, your_team_name), (opp_roster, opp_team_name)],
                    injury_data,
                )
                if injury_rows:
                    render_sortable_table(pd.DataFrame(injury_rows), "injuries")
                else:
                    st.markdown('<p style="color: var(--ink-2);">No injured players in this matchup.</p>', unsafe_allow_html=True)

            # ==================== TAB 2: BENCH STRATEGY ====================
            if active_page == "Bench":
                st.markdown('<h2><i class="bi bi-pause-circle-fill" style="color: var(--cobalt);"></i> Bench Strategy Analysis</h2>', unsafe_allow_html=True)
                st.markdown('<p style="color: var(--ink-2);">Should you bench your players today to protect your lead? This analyzes whether sitting everyone improves your expected categories won.</p>', unsafe_allow_html=True)
                
                with st.spinner("Analyzing bench vs play scenarios..."):
                    bench_analysis = analyze_bench_strategy(
                        your_team_df, opp_team_df,
                        current_you, current_opp,
                        (win_pct, category_results, baseline_avg_cats)
                    )
                
                is_bench_better = bench_analysis["recommendation"] == "BENCH"
                rec_color = "#E06A3B" if is_bench_better else "#2E7D46"
                rec_icon = "bi-pause-circle-fill" if is_bench_better else "bi-play-circle-fill"
                
                st.markdown(f"""
                <div style="background: linear-gradient(145deg, var(--surface-2), var(--card)); 
                            border-radius: 16px; padding: 1.5rem; 
                            border: 2px solid {rec_color}; margin-bottom: 1.5rem;">
                    <div style="display: flex; align-items: center; gap: 1rem;">
                        <i class="{rec_icon}" style="font-size: 3rem; color: {rec_color};"></i>
                        <div>
                            <h3 style="margin: 0; color: {rec_color}; font-family: ui-monospace, Consolas, monospace;">RECOMMENDATION: {bench_analysis["recommendation"]}</h3>
                            <p style="margin: 0.5rem 0 0 0; color: var(--ink-2);">
                                Expected cats difference: <strong style="color: var(--ink);">{bench_analysis["cats_diff"]:+.2f}</strong> | 
                                Win % difference: <strong style="color: var(--ink);">{bench_analysis["win_pct_diff"]:+.1f}%</strong>
                            </p>
                        </div>
                    </div>
                </div>
                """, unsafe_allow_html=True)
                
                col1, col2 = st.columns(2)
                
                with col1:
                    st.markdown(f"""
                    <div style="background: linear-gradient(145deg, var(--card), var(--surface-2)); border-radius: 12px; padding: 1.2rem; border-left: 4px solid var(--good);">
                        <h4 style="margin: 0; color: var(--good); font-family: ui-monospace, Consolas, monospace;"><i class="bi bi-play-fill"></i> PLAY SCENARIO</h4>
                        <div style="margin-top: 1rem;">
                            <p style="margin: 0.3rem 0; color: var(--ink-2);">Win Probability: <span style="color: var(--ink); font-size: 1.3rem; font-family: ui-monospace, Consolas, monospace;">{bench_analysis["play"]["win_pct"]:.1f}%</span></p>
                            <p style="margin: 0.3rem 0; color: var(--ink-2);">Expected Cats: <span style="color: var(--ink); font-size: 1.3rem; font-family: ui-monospace, Consolas, monospace;">{bench_analysis["play"]["avg_cats"]:.2f}</span></p>
                        </div>
                    </div>
                    """, unsafe_allow_html=True)
                    
                    if bench_analysis["play_helps"]:
                        st.markdown("<p style='color: var(--ink-2); margin-top: 0.5rem;'><strong>Playing helps:</strong></p>", unsafe_allow_html=True)
                        for cat, diff in bench_analysis["play_helps"][:5]:
                            st.markdown(f"<span style='color: var(--good);'>▲ {cat}: +{diff:.1f}%</span>", unsafe_allow_html=True)
                
                with col2:
                    st.markdown(f"""
                    <div style="background: linear-gradient(145deg, var(--card), var(--surface-2)); border-radius: 12px; padding: 1.2rem; border-left: 4px solid var(--clay);">
                        <h4 style="margin: 0; color: var(--clay); font-family: ui-monospace, Consolas, monospace;"><i class="bi bi-pause-fill"></i> BENCH SCENARIO</h4>
                        <div style="margin-top: 1rem;">
                            <p style="margin: 0.3rem 0; color: var(--ink-2);">Win Probability: <span style="color: var(--ink); font-size: 1.3rem; font-family: ui-monospace, Consolas, monospace;">{bench_analysis["bench"]["win_pct"]:.1f}%</span></p>
                            <p style="margin: 0.3rem 0; color: var(--ink-2);">Expected Cats: <span style="color: var(--ink); font-size: 1.3rem; font-family: ui-monospace, Consolas, monospace;">{bench_analysis["bench"]["avg_cats"]:.2f}</span></p>
                        </div>
                    </div>
                    """, unsafe_allow_html=True)
                    
                    if bench_analysis["bench_helps"]:
                        st.markdown("<p style='color: var(--ink-2); margin-top: 0.5rem;'><strong>Benching helps:</strong></p>", unsafe_allow_html=True)
                        for cat, diff in bench_analysis["bench_helps"][:5]:
                            st.markdown(f"<span style='color: var(--clay);'>▲ {cat}: +{diff:.1f}%</span>", unsafe_allow_html=True)
                
                with st.expander("Detailed Category Comparison (Play vs Bench)"):
                    bench_cat_data = []
                    for cat in CATEGORIES:
                        play_pct = bench_analysis["play"]["cat_results"][cat]["win_pct"]
                        bench_pct = bench_analysis["bench"]["cat_results"][cat]["win_pct"]
                        diff = bench_pct - play_pct
                        better = "Bench" if diff > 2 else "Play" if diff < -2 else "Same"
                        bench_cat_data.append({
                            "Category": cat,
                            "Play Win %": f"{play_pct:.1f}%",
                            "Bench Win %": f"{bench_pct:.1f}%",
                            "Difference": f"{diff:+.1f}%",
                            "Better": better
                        })
                    render_sortable_table(pd.DataFrame(bench_cat_data), "bench_cat")
            
            # ==================== TAB 3: MY SEASON STATS ====================
            if active_page == "Season Stats":
                st.markdown('<h2><i class="bi bi-people-fill" style="color: var(--cobalt);"></i> My Season Stats</h2>', unsafe_allow_html=True)

                with st.spinner("Loading player season statistics..."):
                    season_totals, player_season_stats, weekly_data = get_team_season_stats(
                        ESPN_LEAGUE_ID, ESPN_SEASON_YEAR, ESPN_S2, ESPN_SWID, team_id)

                # Calculate season percentages
                season_fg_pct = season_totals["FGM"] / season_totals["FGA"] if season_totals["FGA"] > 0 else 0
                season_ft_pct = season_totals["FTM"] / season_totals["FTA"] if season_totals["FTA"] > 0 else 0
                season_3p_pct = season_totals["3PM"] / season_totals["3PA"] if season_totals["3PA"] > 0 else 0
                
                # Season Totals Summary Card
                st.markdown('<h3><i class="bi bi-bar-chart-line-fill" style="color: var(--good);"></i> Team Season Totals</h3>', unsafe_allow_html=True)
                
                col1, col2, col3, col4 = st.columns(4)
                with col1:
                    st.metric("Total Points", f"{int(season_totals['PTS']):,}")
                    st.metric("Total Rebounds", f"{int(season_totals['REB']):,}")
                with col2:
                    st.metric("Total Assists", f"{int(season_totals['AST']):,}")
                    st.metric("Total Steals", f"{int(season_totals['STL']):,}")
                with col3:
                    st.metric("Total Blocks", f"{int(season_totals['BLK']):,}")
                    st.metric("Total 3PM", f"{int(season_totals['3PM']):,}")
                with col4:
                    st.metric("FG%", f"{season_fg_pct:.3f}")
                    st.metric("FT%", f"{season_ft_pct:.3f}")
                
                # Player Stats Table - TOTALS
                st.markdown('<h3><i class="bi bi-person-lines-fill" style="color: var(--cobalt);"></i> Player Contributions (Season Totals)</h3>', unsafe_allow_html=True)
                
                if player_season_stats:
                    # Build player dataframe for totals
                    player_data_total = []
                    
                    for name, stats in player_season_stats.items():
                        # Player percentages
                        player_fg_pct = stats["FGM"] / stats["FGA"] if stats["FGA"] > 0 else 0
                        player_ft_pct = stats["FTM"] / stats["FTA"] if stats["FTA"] > 0 else 0
                        player_3p_pct = stats["3PM"] / stats["3PA"] if stats["3PA"] > 0 else 0
                        
                        # Total view - ESPN column order
                        player_data_total.append({
                            "Player": name,
                            "GP": stats["GP"],
                            "FGM": int(stats["FGM"]),
                            "FGA": int(stats["FGA"]),
                            "FG%": f"{player_fg_pct:.4f}",
                            "FT%": f"{player_ft_pct:.4f}",
                            "3PM": int(stats["3PM"]),
                            "3PA": int(stats["3PA"]),
                            "3P%": f"{player_3p_pct:.4f}",
                            "REB": int(stats["REB"]),
                            "AST": int(stats["AST"]),
                            "STL": int(stats["STL"]),
                            "BLK": int(stats["BLK"]),
                            "TO": int(stats["TO"]),
                            "DD": int(stats.get("DD", 0)),
                            "PTS": int(stats["PTS"]),
                            "TW": int(stats.get("TW", 0)),
                            "_pts_raw": stats["PTS"],
                        })
                    
                    # Sort by total points (highest first)
                    player_data_total = sorted(player_data_total, key=lambda x: x["_pts_raw"], reverse=True)
                    
                    # Remove sorting column before display
                    for p in player_data_total:
                        del p["_pts_raw"]
                    
                    player_df_total = pd.DataFrame(player_data_total)
                    render_sortable_table(player_df_total, "ss_total", default_col="PTS")
                    
                    # Player Stats Table - PER GAME AVERAGES
                    st.markdown('<h3><i class="bi bi-calculator" style="color: var(--good);"></i> Player Contributions (Per Game Average)</h3>', unsafe_allow_html=True)
                    
                    player_data_avg = []
                    
                    for name, stats in player_season_stats.items():
                        # Player percentages
                        player_fg_pct = stats["FGM"] / stats["FGA"] if stats["FGA"] > 0 else 0
                        player_ft_pct = stats["FTM"] / stats["FTA"] if stats["FTA"] > 0 else 0
                        player_3p_pct = stats["3PM"] / stats["3PA"] if stats["3PA"] > 0 else 0
                        
                        gp = stats["GP"] if stats["GP"] > 0 else 1  # Avoid division by zero
                        
                        # Average view - same order
                        player_data_avg.append({
                            "Player": name,
                            "GP": stats["GP"],
                            "FGM": round(stats["FGM"] / gp, 1),
                            "FGA": round(stats["FGA"] / gp, 1),
                            "FG%": f"{player_fg_pct:.3f}",
                            "FT%": f"{player_ft_pct:.3f}",
                            "3PM": round(stats["3PM"] / gp, 1),
                            "3PA": round(stats["3PA"] / gp, 1),
                            "3P%": f"{player_3p_pct:.3f}",
                            "REB": round(stats["REB"] / gp, 1),
                            "AST": round(stats["AST"] / gp, 1),
                            "STL": round(stats["STL"] / gp, 1),
                            "BLK": round(stats["BLK"] / gp, 1),
                            "TO": round(stats["TO"] / gp, 1),
                            "DD": round(stats.get("DD", 0) / gp, 2),
                            "PTS": round(stats["PTS"] / gp, 1),
                            "TW": round(stats.get("TW", 0) / gp, 2),
                            "_pts_raw": stats["PTS"],
                        })
                    
                    # Sort by total points (highest first)
                    player_data_avg = sorted(player_data_avg, key=lambda x: x["_pts_raw"], reverse=True)
                    
                    # Remove sorting column before display
                    for p in player_data_avg:
                        del p["_pts_raw"]
                    
                    player_df_avg = pd.DataFrame(player_data_avg)
                    render_sortable_table(player_df_avg, "ss_avg", default_col="PTS")
                    
                    # Top contributors summary - use total data for leaders
                    st.markdown('<h3><i class="bi bi-award-fill" style="color: var(--clay);"></i> Top Contributors</h3>', unsafe_allow_html=True)
                    
                    # Find leaders in each category from raw stats
                    if player_season_stats:
                        # Get leaders from raw stats
                        pts_leader_name = max(player_season_stats.keys(), key=lambda x: player_season_stats[x]["PTS"])
                        reb_leader_name = max(player_season_stats.keys(), key=lambda x: player_season_stats[x]["REB"])
                        ast_leader_name = max(player_season_stats.keys(), key=lambda x: player_season_stats[x]["AST"])
                        stl_leader_name = max(player_season_stats.keys(), key=lambda x: player_season_stats[x]["STL"])
                        blk_leader_name = max(player_season_stats.keys(), key=lambda x: player_season_stats[x]["BLK"])
                        tpm_leader_name = max(player_season_stats.keys(), key=lambda x: player_season_stats[x]["3PM"])
                        
                        pts_val = int(player_season_stats[pts_leader_name]["PTS"])
                        pts_pct = (pts_val / season_totals["PTS"] * 100) if season_totals["PTS"] > 0 else 0
                        reb_val = int(player_season_stats[reb_leader_name]["REB"])
                        reb_pct = (reb_val / season_totals["REB"] * 100) if season_totals["REB"] > 0 else 0
                        ast_val = int(player_season_stats[ast_leader_name]["AST"])
                        ast_pct = (ast_val / season_totals["AST"] * 100) if season_totals["AST"] > 0 else 0
                        stl_val = int(player_season_stats[stl_leader_name]["STL"])
                        blk_val = int(player_season_stats[blk_leader_name]["BLK"])
                        tpm_val = int(player_season_stats[tpm_leader_name]["3PM"])
                        tpm_pct = (tpm_val / season_totals["3PM"] * 100) if season_totals["3PM"] > 0 else 0

                        col1, col2, col3 = st.columns(3)
                        with col1:
                            st.markdown(_leader_card("Points Leader", pts_leader_name, f"{pts_val:,} pts ({pts_pct:.1f}%)"), unsafe_allow_html=True)
                            st.markdown(_leader_card("Steals Leader", stl_leader_name, f"{stl_val:,} stl"), unsafe_allow_html=True)
                        with col2:
                            st.markdown(_leader_card("Rebounds Leader", reb_leader_name, f"{reb_val:,} reb ({reb_pct:.1f}%)"), unsafe_allow_html=True)
                            st.markdown(_leader_card("Blocks Leader", blk_leader_name, f"{blk_val:,} blk"), unsafe_allow_html=True)
                        with col3:
                            st.markdown(_leader_card("Assists Leader", ast_leader_name, f"{ast_val:,} ast ({ast_pct:.1f}%)"), unsafe_allow_html=True)
                            st.markdown(_leader_card("3PM Leader", tpm_leader_name, f"{tpm_val:,} 3pm ({tpm_pct:.1f}%)"), unsafe_allow_html=True)
                else:
                    st.warning("No player data available. Player-level stats may not be accessible through the ESPN API for your league.")
                    
                    # Fallback to weekly breakdown
                    st.markdown('<h3><i class="bi bi-calendar-week-fill" style="color: var(--clay);"></i> Weekly Breakdown</h3>', unsafe_allow_html=True)
                    if weekly_data:
                        weekly_df = pd.DataFrame(weekly_data)
                        render_sortable_table(weekly_df, "weekly", default_col="Week", default_desc=False)
            
            # ==================== TAB 4: LEAGUE STATS ====================
            if active_page == "League Stats":
                st.markdown('<h2><i class="bi bi-trophy-fill" style="color: var(--cobalt);"></i> League Statistics</h2>', unsafe_allow_html=True)
                st.markdown('<p style="color: var(--ink-2);">League standings, all-play records (your record if you played everyone every week), and luck factor analysis.</p>', unsafe_allow_html=True)
                
                your_team_stats = next((t for t in league_stats if t["team_id"] == team_id), None)
                
                if your_team_stats:
                    luck_color = "var(--good)" if your_team_stats["luck"] > 0 else "var(--bad)" if your_team_stats["luck"] < 0 else "var(--ink-2)"
                    luck_text = "Lucky" if your_team_stats["luck"] > 2 else "Unlucky" if your_team_stats["luck"] < -2 else "Average"
                    
                    st.markdown(f"""
                    <div style="background: linear-gradient(145deg, var(--surface-2), var(--card)); 
                                border-radius: 16px; padding: 1.5rem; 
                                border: 2px solid var(--cobalt); margin-bottom: 1.5rem;">
                        <h3 style="margin: 0 0 1rem 0; color: var(--cobalt); font-family: ui-monospace, Consolas, monospace;">
                            <i class="bi bi-person-circle"></i> {your_team_stats["team_name"]} - #{your_team_stats["standing"]}
                        </h3>
                        <div style="display: flex; flex-wrap: wrap; gap: 2rem;">
                            <div>
                                <span style="color: var(--ink-2); font-size: 0.85rem;">ACTUAL RECORD</span><br/>
                                <span style="color: var(--ink); font-size: 1.8rem; font-family: ui-monospace, Consolas, monospace;">
                                    {your_team_stats["actual_wins"]}-{your_team_stats["actual_losses"]}-{your_team_stats["actual_ties"]}
                                </span>
                                <span style="color: var(--ink-2); font-size: 1rem;"> ({your_team_stats["actual_pct"]:.3f})</span>
                            </div>
                            <div>
                                <span style="color: var(--ink-2); font-size: 0.85rem;">ALL-PLAY RECORD</span><br/>
                                <span style="color: var(--cobalt); font-size: 1.8rem; font-family: ui-monospace, Consolas, monospace;">
                                    {your_team_stats["all_play_wins"]}-{your_team_stats["all_play_losses"]}-{your_team_stats["all_play_ties"]}
                                </span>
                                <span style="color: var(--ink-2); font-size: 1rem;"> ({your_team_stats["all_play_pct"]:.3f})</span>
                            </div>
                            <div>
                                <span style="color: var(--ink-2); font-size: 0.85rem;">LUCK FACTOR</span><br/>
                                <span style="color: {luck_color}; font-size: 1.8rem; font-family: ui-monospace, Consolas, monospace;">
                                    {your_team_stats["luck"]:+.1f}%
                                </span>
                                <span style="color: {luck_color}; font-size: 1rem;"> ({luck_text})</span>
                            </div>
                        </div>
                    </div>
                    """, unsafe_allow_html=True)
                
                st.markdown('<h3><i class="bi bi-list-ol" style="color: var(--cobalt);"></i> Full League Standings</h3>', unsafe_allow_html=True)
                
                standings_df = pd.DataFrame([{
                    "#": t["standing"],
                    "Team": t["team_name"],
                    "Record": f"{t['actual_wins']}-{t['actual_losses']}-{t['actual_ties']}",
                    "PCT": f"{t['actual_pct']:.3f}",
                    "All-Play": f"{t['all_play_wins']}-{t['all_play_losses']}-{t['all_play_ties']}",
                    "AP PCT": f"{t['all_play_pct']:.3f}",
                    "Luck": f"{t['luck']:+.1f}%",
                } for t in league_stats])
                
                render_sortable_table(standings_df, "lg_standings", default_col="#", default_desc=False)

                # Per-team season totals for every category
                st.markdown('<h3><i class="bi bi-grid-3x3-gap-fill" style="color: var(--cobalt);"></i> Season Category Totals</h3>', unsafe_allow_html=True)
                st.caption("Each team's cumulative totals for the season, by category.")
                cat_rows = []
                for t in sorted(league_stats, key=lambda x: x["standing"]):
                    ct = t.get("cat_totals", {}) or {}
                    cat_rows.append({
                        "Rk": t["standing"],
                        "Team": t["team_name"][:20],
                        "FGM": int(ct.get("FGM", 0)),
                        "FGA": int(ct.get("FGA", 0)),
                        "FG%": f"{ct.get('FG%', 0):.3f}",
                        "FT%": f"{ct.get('FT%', 0):.3f}",
                        "3PM": int(ct.get("3PM", 0)),
                        "3PA": int(ct.get("3PA", 0)),
                        "3P%": f"{ct.get('3P%', 0):.3f}",
                        "REB": int(ct.get("REB", 0)),
                        "AST": int(ct.get("AST", 0)),
                        "STL": int(ct.get("STL", 0)),
                        "BLK": int(ct.get("BLK", 0)),
                        "TO": int(ct.get("TO", 0)),
                        "DD": int(ct.get("DD", 0)),
                        "PTS": int(ct.get("PTS", 0)),
                    })
                render_sortable_table(pd.DataFrame(cat_rows), "lg_cat", default_col="PTS")

            # ==================== TAB 5: PLAYOFF & CHAMPIONSHIP ====================
            if active_page == "Playoff Odds":
                st.markdown('<h2><i class="bi bi-trophy-fill" style="color: var(--cobalt);"></i> Playoff & Championship Probabilities</h2>', unsafe_allow_html=True)
                st.markdown('<p style="color: var(--ink-2);">Projected roster (injury-aware) + category-by-category. Playoff matchups are two weeks each (semis + finals).</p>', unsafe_allow_html=True)
                
                with st.spinner("Simulating playoff probabilities (cached after first run)..."):
                    playoff_results, playoff_projected = get_playoff_probabilities(
                        year, sim_count, league_stats, blend_weight, injury_data,
                    )
                
                def fmt_pct(pct):
                    if pct >= 99.5:
                        return ">99%"
                    if pct <= 0.5:
                        return "X" if pct < 0.01 else "<1%"
                    return f"{pct:.0f}%"
                
                def pct_color(pct, invert=False):
                    """Green for higher prob, red for lower. invert=True for No Playoffs (high = bad)."""
                    if pct < 0.01:
                        return "#9A9DA6"
                    threshold = 25
                    if invert:
                        return "#2E7D46" if pct < threshold else "#C0392B"
                    return "#2E7D46" if pct >= threshold else "#C0392B"
                
                def prob_to_american_odds(pct):
                    """Convert probability to American odds. Returns '' if >99% or <1% (no odds needed)."""
                    if pct >= 99 or pct < 1:
                        return ""
                    p = pct / 100
                    if p >= 0.5:
                        raw = -100 * p / (1 - p)
                        odds = int(round(raw / 5) * 5)
                        return f"{odds}"
                    else:
                        raw = 100 * (1 - p) / p
                        odds = int(round(raw / 5) * 5)
                        return f"+{odds}"
                
                # Detect if we're in playoffs from the results
                in_playoffs = any(r.get("in_playoffs", False) for r in playoff_results)

                # Only show odds columns if at least one team has odds in range (1-99%)
                show_playoff_odds = any(1 <= r['playoff_prob'] < 99 for r in playoff_results)
                show_advance_odds = in_playoffs and any(1 <= r.get('advance_prob', 0) < 99 for r in playoff_results)
                show_champ_odds = any(1 <= r['championship_prob'] < 99 for r in playoff_results)

                cf_ids = (
                    playoff_results[0].get("championship_finalist_team_ids")
                    if playoff_results else None
                )
                cf_ids_int = (
                    frozenset(int(x) for x in cf_ids) if cf_ids is not None else None
                )
                championship_table_rows = []
                if cf_ids_int is not None and len(cf_ids_int) >= 2:
                    championship_table_rows = [
                        r for r in playoff_results if int(r["team_id"]) in cf_ids_int
                    ]
                    championship_table_rows.sort(
                        key=lambda x: x["championship_prob"], reverse=True
                    )
                is_championship_table = len(championship_table_rows) >= 2
                championship_display_rows = championship_table_rows
                if is_championship_table:
                    # In active finals, force championship odds to match the main matchup
                    # Win Probability gauge exactly (team_id vs current opponent = 100 - win_pct).
                    championship_display_rows = []
                    for r in championship_table_rows:
                        out = dict(r)
                        if int(r.get("team_id", -1)) == int(team_id):
                            out["championship_prob"] = float(win_pct)
                        else:
                            out["championship_prob"] = float(100.0 - win_pct)
                        championship_display_rows.append(out)
                playoff_table_title = (
                    "Championship" if is_championship_table else "Playoff Standings"
                )
                st.markdown(
                    f'<h3><i class="bi bi-trophy-fill" style="color: var(--cobalt);"></i> {playoff_table_title}</h3>',
                    unsafe_allow_html=True,
                )
                
                # Build HTML table with color-coded percentages and American odds
                if is_championship_table:
                    show_champ_odds = any(1 <= r["championship_prob"] < 99 for r in championship_display_rows)
                    header_cells = (
                        "<th style='text-align:left;padding:8px;color:var(--ink-2);'>Team</th>"
                        "<th style='text-align:center;padding:8px;color:var(--ink-2);'>Champ %</th>"
                    )
                    if show_champ_odds:
                        header_cells += "<th style='text-align:center;padding:8px;color:var(--ink-2);'>Champ Odds</th>"
                    display_results = championship_display_rows
                else:
                    header_cells = "<th style='text-align:left;padding:8px;color:var(--ink-2);'>Team</th><th style='text-align:center;padding:8px;color:var(--ink-2);'>W</th><th style='text-align:center;padding:8px;color:var(--ink-2);'>L</th>"
                    if not in_playoffs:
                        seed_cols = [f"#{s}*" for s in range(1, 5)]
                        for c in seed_cols:
                            header_cells += f"<th style='text-align:center;padding:8px;color:var(--ink-2);'>{c}</th>"
                        header_cells += "<th style='text-align:center;padding:8px;color:var(--ink-2);'>No Playoffs</th><th style='text-align:center;padding:8px;color:var(--ink-2);'>Playoff %</th>"
                        if show_playoff_odds:
                            header_cells += "<th style='text-align:center;padding:8px;color:var(--ink-2);'>Playoff Odds</th>"
                    else:
                        header_cells += "<th style='text-align:center;padding:8px;color:var(--ink-2);'>Advance %</th>"
                        if show_advance_odds:
                            header_cells += "<th style='text-align:center;padding:8px;color:var(--ink-2);'>Advance Odds</th>"
                    header_cells += "<th style='text-align:center;padding:8px;color:var(--ink-2);'>Champ %</th>"
                    if show_champ_odds:
                        header_cells += "<th style='text-align:center;padding:8px;color:var(--ink-2);'>Champ Odds</th>"
                    display_results = playoff_results
                    if in_playoffs:
                        display_results = [r for r in playoff_results
                                           if r.get("advance_prob", 0) > 0 or r.get("championship_prob", 0) > 0]

                rows = []
                for r in display_results:
                    if is_championship_table:
                        cells = f"<td style='padding:8px;color: var(--ink);'>{r['team_name']}</td>"
                        cells += f"<td style='text-align:center;padding:8px;color:{pct_color(r['championship_prob'])};'>{fmt_pct(r['championship_prob'])}</td>"
                        if show_champ_odds:
                            champ_odds = prob_to_american_odds(r['championship_prob'])
                            cells += f"<td style='text-align:center;padding:8px;color:var(--clay);'>{champ_odds if champ_odds else '-'}</td>"
                    else:
                        w, l, t = r["record"]
                        cells = f"<td style='padding:8px;color: var(--ink);'>{r['team_name']}</td><td style='text-align:center;padding:8px;color: var(--ink);'>{w}</td><td style='text-align:center;padding:8px;color: var(--ink);'>{l}</td>"
                        if not in_playoffs:
                            for s in range(1, 5):
                                pct = r["seed_probs"].get(s, 0)
                                cells += f"<td style='text-align:center;padding:8px;color:{pct_color(pct)};'>{fmt_pct(pct)}</td>"
                            no_play = r["seed_probs"].get("no_playoffs", 0)
                            cells += f"<td style='text-align:center;padding:8px;color:{pct_color(no_play, invert=True)};'>{fmt_pct(no_play)}</td>"
                            cells += f"<td style='text-align:center;padding:8px;color:{pct_color(r['playoff_prob'])};'>{fmt_pct(r['playoff_prob'])}</td>"
                            if show_playoff_odds:
                                playoff_odds = prob_to_american_odds(r['playoff_prob'])
                                cells += f"<td style='text-align:center;padding:8px;color:var(--clay);'>{playoff_odds if playoff_odds else '-'}</td>"
                        else:
                            advance_pct = r.get("advance_prob", 0)
                            cells += f"<td style='text-align:center;padding:8px;color:{pct_color(advance_pct)};'>{fmt_pct(advance_pct)}</td>"
                            if show_advance_odds:
                                advance_odds = prob_to_american_odds(advance_pct)
                                cells += f"<td style='text-align:center;padding:8px;color:var(--clay);'>{advance_odds if advance_odds else '-'}</td>"
                        cells += f"<td style='text-align:center;padding:8px;color:{pct_color(r['championship_prob'])};'>{fmt_pct(r['championship_prob'])}</td>"
                        if show_champ_odds:
                            champ_odds = prob_to_american_odds(r['championship_prob'])
                            cells += f"<td style='text-align:center;padding:8px;color:var(--clay);'>{champ_odds if champ_odds else '-'}</td>"
                    rows.append(f"<tr>{cells}</tr>")
                
                table_html = f"""
                <div style="overflow-x:auto;margin-bottom:1.5rem;">
                <table style="width:100%;border-collapse:collapse;font-family:system-ui, Segoe UI, sans-serif;">
                <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.2);">{header_cells}</tr></thead>
                <tbody>{"".join(rows)}</tbody>
                </table></div>
                """
                st.markdown(table_html, unsafe_allow_html=True)
                
                # Championship probability bar chart
                st.markdown('<h3><i class="bi bi-trophy-fill" style="color: var(--clay);"></i> Championship Probability</h3>', unsafe_allow_html=True)
                chart_rows = championship_display_rows if is_championship_table else playoff_results
                st.plotly_chart(
                    create_championship_chart(
                        chart_rows,
                        your_team_name,
                        finalist_team_ids=cf_ids_int if is_championship_table else None,
                    ),
                    width='stretch',
                )
            
            # ==================== STREAMER ANALYSIS (loads last) ====================
            if active_page == "Streamers":
                st.markdown('<h2><i class="bi bi-arrow-repeat" style="color: var(--cobalt);"></i> Streamer Analysis</h2>', unsafe_allow_html=True)
                
                if untouchables:
                    st.markdown(f'<div style="padding: 0.75rem; background: rgba(0, 212, 255, 0.1); border-left: 4px solid var(--cobalt); border-radius: 4px; margin-bottom: 1rem;"><i class="bi bi-lock-fill" style="color: var(--cobalt);"></i> <strong>Untouchable players:</strong> {", ".join(untouchables)}</div>', unsafe_allow_html=True)
                if has_open_spot:
                    st.markdown('<div style="padding: 0.75rem; background: rgba(0, 255, 136, 0.1); border-left: 4px solid var(--good); border-radius: 4px; margin-bottom: 1rem;"><i class="bi bi-check-circle-fill" style="color: var(--good);"></i> You have an open roster spot - streamers can be added without dropping anyone</div>', unsafe_allow_html=True)
                with st.spinner(f"Analyzing {num_streamers} potential streamers (considering drop candidates)..."):
                    baseline_results = (win_pct, category_results, baseline_avg_cats)
                    streamers = analyze_streamers(
                        league, your_team_df, opp_team_df, 
                        current_you, current_opp, baseline_results,
                        blend_weight, year, num_streamers,
                        untouchables=untouchables,
                        has_open_roster_spot=has_open_spot,
                        manual_watchlist=manual_watchlist,
                        week_span=week_span,
                        period_end_date=period_end_date,
                        game_window_start=game_window_start,
                        game_window_end=game_window_end,
                    )
                    # Add playoff & championship delta % per streamer (vs baseline)
                    your_team_stats = next((t for t in league_stats if t["team_id"] == team_id), None)
                    if your_team_stats and streamers:
                        w, l, t = your_team_stats["actual_wins"], your_team_stats["actual_losses"], your_team_stats["actual_ties"]
                        tid = int(team_id)
                        # Baseline = Playoff tab (no duplicate full sim). W/L scenarios: fewer sims + shared projections.
                        pb = next((r for r in playoff_results if r["team_id"] == tid), {})

                        def _playoff_counterfactual(rec_override):
                            return simulate_playoff_probabilities(
                                league, league_stats, year,
                                sims=STREAMER_RECORD_PLAYOFF_SIMS,
                                record_override=rec_override,
                                blend_weight=blend_weight,
                                injury_data=injury_data,
                                current_week_matchup_outcomes=(team_id, opp_team_obj.team_id, outcome_counts),
                                period_end_date=period_end_date,
                                precomputed_projected=playoff_projected,
                            )

                        with ThreadPoolExecutor(max_workers=2) as ex:
                            fut_win = ex.submit(_playoff_counterfactual, {tid: (w + 1, l, t)})
                            fut_lose = ex.submit(_playoff_counterfactual, {tid: (w, l + 1, t)})
                            playoff_if_win = fut_win.result()
                            playoff_if_lose = fut_lose.result()

                        pw = next((r for r in playoff_if_win if r["team_id"] == tid), {})
                        pl = next((r for r in playoff_if_lose if r["team_id"] == tid), {})
                        baseline_playoff, baseline_champ = pb.get("playoff_prob", 0), pb.get("championship_prob", 0)
                        playoff_win, champ_win = pw.get("playoff_prob", 0), pw.get("championship_prob", 0)
                        playoff_lose, champ_lose = pl.get("playoff_prob", 0), pl.get("championship_prob", 0)
                        for s in streamers:
                            wp = s["Win %"] / 100
                            s_playoff = wp * playoff_win + (1 - wp) * playoff_lose
                            s_champ = wp * champ_win + (1 - wp) * champ_lose
                            s["Δ Playoff %"] = round(s_playoff - baseline_playoff, 1)
                            s["Δ Champ %"] = round(s_champ - baseline_champ, 1)
                
                if streamers:
                    st.markdown('<h3><i class="bi bi-star-fill" style="color: var(--clay);"></i> Top Recommendations</h3>', unsafe_allow_html=True)
                    
                    top_3 = streamers[:3]
                    cols = st.columns(3)
                    
                    for i, player in enumerate(top_3):
                        with cols[i]:
                            delta_color = "#2E7D46" if player["Δ Cats"] > 0 else "#C0392B" if player["Δ Cats"] < 0 else "#E06A3B"
                            border_color = delta_color
                            
                            drop_text = player["Drop"]
                            if drop_text == "(Open Spot)":
                                drop_display = '<span style="color: var(--good);">Add (Open Spot)</span>'
                            else:
                                drop_display = f'<span style="color: var(--bad);">Drop: {drop_text}</span>'
                            
                            watchlist_badge = ' <i class="bi bi-star-fill" style="color: var(--clay); font-size: 0.9rem;"></i>' if player.get("Watchlist") else ""
                            status_tag = f" <span style='color: var(--clay);'>({player['Status']})</span>" if player.get("Status") else ""
                            
                            st.markdown(f"""
                            <div style="background: linear-gradient(145deg, var(--surface-2), var(--card)); 
                                        border-radius: 12px; padding: 1.2rem; 
                                        border-left: 4px solid {border_color};">
                                <h4 style="margin: 0; color: var(--ink); font-family: ui-monospace, Consolas, monospace;">{player['Player']}{watchlist_badge}</h4>
                                <p style="color: var(--ink-2); margin: 0.3rem 0; font-size: 0.9rem;">{player['Team']} - {player['Games']} games{status_tag}</p>
                                <p style="margin: 0.5rem 0; font-size: 0.85rem;">{drop_display}</p>
                                <div style="display: flex; justify-content: space-between; margin-top: 0.8rem;">
                                    <div>
                                        <span style="color: var(--ink-2); font-size: 0.8rem;">Δ CATS</span><br/>
                                        <span style="color: {delta_color}; font-size: 1.5rem; font-family: ui-monospace, Consolas, monospace; font-weight: 600;">
                                            {player['Δ Cats']:+.2f}
                                        </span>
                                    </div>
                                    <div>
                                        <span style="color: var(--ink-2); font-size: 0.8rem;">EXP CATS</span><br/>
                                        <span style="color: var(--ink); font-size: 1.5rem; font-family: ui-monospace, Consolas, monospace;">
                                            {player['Exp Cats']:.1f}
                                        </span>
                                    </div>
                                    <div>
                                        <span style="color: var(--ink-2); font-size: 0.8rem;">WIN %</span><br/>
                                        <span style="color: var(--ink); font-size: 1.5rem; font-family: ui-monospace, Consolas, monospace;">
                                            {player['Win %']:.0f}%
                                        </span>
                                    </div>
                                </div>
                            </div>
                            """, unsafe_allow_html=True)
                            
                            if player["Cat Impacts"]:
                                impacts_str = ", ".join([f"{'▲' if v > 0 else '▼'}{k}: {v:+.0f}%" for k, v in sorted(player["Cat Impacts"].items(), key=lambda x: abs(x[1]), reverse=True)[:3]])
                                st.caption(impacts_str)
                            
                            if player["Risks"]:
                                st.caption(f"Risk: {', '.join(player['Risks'])}")
                    
                    with st.expander("All Analyzed Streamers"):
                        streamer_df = pd.DataFrame([{
                            "WL": p.get("Watchlist", ""),
                            "Player": p["Player"],
                            "Team": p["Team"],
                            "Status": p.get("Status", ""),
                            "Games": p["Games"],
                            "Drop": p["Drop"],
                            "Δ Cats": p["Δ Cats"],
                            "Exp Cats": p["Exp Cats"],
                            "Win %": p["Win %"],
                            "Δ Playoff %": p.get("Δ Playoff %", 0),
                            "Δ Champ %": p.get("Δ Champ %", 0),
                            "PTS": p["PTS"],
                            "REB": p["REB"],
                            "AST": p["AST"],
                            "Risks": ", ".join(p["Risks"]) if p["Risks"] else ""
                        } for p in streamers])
                        
                        render_sortable_table(streamer_df, "streamers", default_col="Δ Cats")
                else:
                    st.warning("No streamers found with games remaining this week.")
            
            
        except Exception as e:
            st.error(f"Error: {str(e)}")
            st.exception(e)


if __name__ == "__main__":
    main()