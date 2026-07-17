"""
Fantasy Basketball Simulator - Charts and scoreboard HTML.

Palette ("Analyst Sheet"): cobalt = your team, clay = opponent (identity);
green / red = good / bad (won / lost a category); graphite ink on warm paper.
"""

import plotly.graph_objects as go

from config import CATEGORIES

# --- palette (light defaults; Plotly can't read CSS vars, so charts pick a set) --
INK      = "#1B1D22"
INK_2    = "#6A6E79"
INK_3    = "#9A9DA6"
LINE     = "rgba(27,29,34,0.12)"
COBALT   = "#2F6FED"   # your team
CLAY     = "#E06A3B"   # opponent
GOOD     = "#2E7D46"   # won a category
BAD      = "#C0392B"   # lost a category
NEUTRAL  = "#9A9DA6"   # tie
MONO     = "ui-monospace, 'SF Mono', Consolas, monospace"

_LIGHT = {
    "ink": INK, "ink2": INK_2, "ink3": INK_3, "line": LINE, "cobalt": COBALT,
    "clay": CLAY, "good": GOOD, "bad": BAD, "neutral": NEUTRAL,
}


def _pal():
    """Chart palette (Plotly needs literal colors; the app is light-only)."""
    return _LIGHT
SANS     = "system-ui, 'Segoe UI', Helvetica, Arial, sans-serif"


def create_scoreboard_vertical(current_you, current_opp, your_team_name, opp_team_name):
    """
    The current-week scoreboard, category-by-category (HTML, so it uses CSS vars): a
    hero row (team names + big overall W-L-T record) followed by one stacked row PER
    CATEGORY — your value / category label / opponent value, each with a two-tone bar
    showing the lead. This is the "stacked list" layout typical fantasy apps (ESPN,
    Yahoo) use on phones, replacing a 15-column wide table nobody could read without
    scrolling sideways through most of it.
    """
    INK, INK_2, INK_3 = "var(--ink)", "var(--ink-2)", "var(--ink-3)"
    COBALT, CLAY, GOOD, BAD, LINE = "var(--cobalt)", "var(--clay)", "var(--good)", "var(--bad)", "var(--line)"
    categories_order = ["FGM", "FGA", "FG%", "FT%", "3PM", "3PA", "3P%", "REB", "AST", "STL", "BLK", "TO", "DD", "PTS", "TW"]
    your_fgp = current_you["FGM"] / current_you["FGA"] if current_you["FGA"] > 0 else 0
    opp_fgp = current_opp["FGM"] / current_opp["FGA"] if current_opp["FGA"] > 0 else 0
    your_ftp = current_you["FTM"] / current_you["FTA"] if current_you["FTA"] > 0 else 0
    opp_ftp = current_opp["FTM"] / current_opp["FTA"] if current_opp["FTA"] > 0 else 0
    your_3pp = current_you["3PM"] / current_you["3PA"] if current_you["3PA"] > 0 else 0
    opp_3pp = current_opp["3PM"] / current_opp["3PA"] if current_opp["3PA"] > 0 else 0
    your_stats = {
        "FGM": current_you["FGM"], "FGA": current_you["FGA"], "FG%": your_fgp,
        "FT%": your_ftp, "3PM": current_you["3PM"], "3PA": current_you["3PA"], "3P%": your_3pp,
        "REB": current_you["REB"], "AST": current_you["AST"], "STL": current_you["STL"],
        "BLK": current_you["BLK"], "TO": current_you["TO"], "DD": current_you["DD"],
        "PTS": current_you["PTS"], "TW": current_you["TW"]
    }
    opp_stats = {
        "FGM": current_opp["FGM"], "FGA": current_opp["FGA"], "FG%": opp_fgp,
        "FT%": opp_ftp, "3PM": current_opp["3PM"], "3PA": current_opp["3PA"], "3P%": opp_3pp,
        "REB": current_opp["REB"], "AST": current_opp["AST"], "STL": current_opp["STL"],
        "BLK": current_opp["BLK"], "TO": current_opp["TO"], "DD": current_opp["DD"],
        "PTS": current_opp["PTS"], "TW": current_opp["TW"]
    }
    your_wins = opp_wins = ties = 0
    for cat in categories_order:
        y_val, o_val = your_stats[cat], opp_stats[cat]
        lower_better = cat == "TO"
        y_win = (y_val < o_val) if lower_better else (y_val > o_val)
        o_win = (o_val < y_val) if lower_better else (o_val > y_val)
        if y_win:
            your_wins += 1
        elif o_win:
            opp_wins += 1
        else:
            ties += 1

    rows = ""
    for cat in categories_order:
        y_val, o_val = your_stats[cat], opp_stats[cat]
        lower_better = cat == "TO"
        y_win = (y_val < o_val) if lower_better else (y_val > o_val)
        o_win = (o_val < y_val) if lower_better else (o_val > y_val)
        # Lead is shown by the two-tone bar (cobalt/clay) + weight, not red/green on the
        # numbers themselves - stays legible and matches the rest of the design system,
        # where clay/bad-red are reserved for warnings, not "you're losing this stat".
        y_weight = 700 if y_win else 400
        o_weight = 700 if o_win else 400
        y_color = INK if y_win else INK_3
        o_color = INK if o_win else INK_3
        y_str = f"{y_val:.4f}" if "%" in cat else str(int(y_val))
        o_str = f"{o_val:.4f}" if "%" in cat else str(int(o_val))
        # Bar share reflects who's WINNING the category, not raw magnitude — for TO
        # (fewer is better) the smaller value gets the larger, "leading" bar segment.
        total = y_val + o_val
        if total > 0:
            y_share = (o_val / total) if lower_better else (y_val / total)
        else:
            y_share = 0.5
        y_pct = round(y_share * 100)
        # Built as ONE line with no leading whitespace: Streamlit's markdown renderer
        # treats 4+ leading spaces on a line as a CommonMark indented code block, which
        # silently turns HTML after the first row into literal escaped text — every row
        # after the first rendered as raw `<div ...>` text until this was flattened.
        rows += (
            f'<div style="display:flex; align-items:center; gap:0.6rem; padding:0.6rem 0.1rem; border-bottom:1px solid {LINE};">'
            f'<div style="min-width:56px; text-align:left; font-family:{MONO}; font-weight:{y_weight}; font-size:0.98rem; color:{y_color};">{y_str}</div>'
            f'<div style="flex:1; min-width:0;">'
            f'<div style="text-align:center; font-family:{SANS}; font-size:0.66rem; font-weight:700; letter-spacing:0.07em; text-transform:uppercase; color:{INK_2}; margin-bottom:0.3rem;">{cat}</div>'
            f'<div style="height:4px; border-radius:2px; overflow:hidden; display:flex; background:{LINE};">'
            f'<div style="width:{y_pct}%; background:{COBALT};"></div>'
            f'<div style="width:{100 - y_pct}%; background:{CLAY};"></div>'
            f'</div></div>'
            f'<div style="min-width:56px; text-align:right; font-family:{MONO}; font-weight:{o_weight}; font-size:0.98rem; color:{o_color};">{o_str}</div>'
            f'</div>'
        )

    html = f"""
    <div style="margin-bottom: 1rem;">
        <div class="scoreboard-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem; gap: 0.5rem;">
            <div style="text-align: left; flex: 1 1 auto; min-width: 0;">
                <span class="sb-name" style="font-family: {SANS}; font-weight: 700; font-size: 1.4rem; color: {INK}; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{your_team_name}</span>
            </div>
            <div style="text-align: center; flex: 0 0 auto; white-space: nowrap;">
                <span class="sb-score-main" style="font-family: {MONO}; font-size: 2.3rem; font-weight: 700; color: {COBALT};">{your_wins}-{opp_wins}-{ties}</span>
                <span class="sb-score-sub" style="font-family: {MONO}; font-size: 1.1rem; color: {INK_3}; margin-left: 0.8rem;">{opp_wins}-{your_wins}-{ties}</span>
            </div>
            <div style="text-align: right; flex: 1 1 auto; min-width: 0;">
                <span class="sb-name" style="font-family: {SANS}; font-weight: 700; font-size: 1.4rem; color: {INK}; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{opp_team_name}</span>
            </div>
        </div>
        <div>{rows}</div>
    </div>
    """
    return html


def create_win_probability_gauge(win_pct):
    """Create a gauge chart for win probability."""
    c = _pal()
    INK, INK_2, INK_3, LINE = c["ink"], c["ink2"], c["ink3"], c["line"]
    COBALT, CLAY, GOOD, BAD, NEUTRAL = c["cobalt"], c["clay"], c["good"], c["bad"], c["neutral"]
    fig = go.Figure(go.Indicator(
        mode="gauge+number",
        value=win_pct,
        domain={'x': [0, 1], 'y': [0, 1]},
        number={'suffix': '%', 'font': {'size': 58, 'family': MONO, 'color': INK}},
        gauge={
            'axis': {'range': [0, 100], 'tickwidth': 1, 'tickcolor': INK_3},
            'bar': {'color': GOOD if win_pct >= 50 else BAD},
            'bgcolor': "rgba(0,0,0,0)",
            'borderwidth': 1,
            'bordercolor': LINE,
            'steps': [
                {'range': [0, 40], 'color': 'rgba(192, 57, 43, 0.12)'},
                {'range': [40, 60], 'color': 'rgba(224, 106, 59, 0.12)'},
                {'range': [60, 100], 'color': 'rgba(46, 125, 70, 0.12)'}
            ],
            'threshold': {
                'line': {'color': INK, 'width': 3},
                'thickness': 0.75,
                'value': win_pct
            }
        }
    ))
    fig.update_layout(
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
        font={'color': INK, 'family': SANS},
        height=300,
        margin=dict(l=30, r=30, t=30, b=30)
    )
    return fig


def create_category_chart(category_results, your_sim, opp_sim):
    """Create horizontal bar chart for category win rates."""
    c = _pal()
    INK, INK_2, INK_3, LINE = c["ink"], c["ink2"], c["ink3"], c["line"]
    COBALT, CLAY, GOOD, BAD, NEUTRAL = c["cobalt"], c["clay"], c["good"], c["bad"], c["neutral"]
    cats = []
    you_pcts = []
    opp_pcts = []
    for cat in reversed(CATEGORIES):
        outcome = category_results[cat]
        total = sum(outcome.values())
        you_pcts.append(outcome["you"] / total * 100)
        opp_pcts.append(outcome["opponent"] / total * 100)
        cats.append(cat)
    fig = go.Figure()
    fig.add_trace(go.Bar(
        name='You',
        y=cats,
        x=you_pcts,
        orientation='h',
        marker_color=COBALT,
        text=[f'{p:.0f}%' for p in you_pcts],
        textposition='inside',
        textfont=dict(family=MONO, size=12, color='white')
    ))
    fig.add_trace(go.Bar(
        name='Opponent',
        y=cats,
        x=[-p for p in opp_pcts],
        orientation='h',
        marker_color=CLAY,
        text=[f'{p:.0f}%' for p in opp_pcts],
        textposition='inside',
        textfont=dict(family=MONO, size=12, color='white')
    ))
    fig.update_layout(
        barmode='overlay',
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
        font={'color': INK, 'family': SANS},
        height=500,
        margin=dict(l=60, r=60, t=20, b=20),
        xaxis=dict(
            range=[-100, 100],
            showgrid=True,
            gridcolor=LINE,
            zeroline=True,
            zerolinecolor=INK_3,
            zerolinewidth=1,
            tickvals=[-100, -75, -50, -25, 0, 25, 50, 75, 100],
            ticktext=['100%', '75%', '50%', '25%', '0', '25%', '50%', '75%', '100%']
        ),
        yaxis=dict(showgrid=False),
        legend=dict(orientation='h', yanchor='bottom', y=1.02, xanchor='center', x=0.5),
        showlegend=True
    )
    return fig


def create_outcome_distribution(outcome_counts, total_sims):
    """Create chart showing distribution of score outcomes."""
    c = _pal()
    INK, INK_2, INK_3, LINE = c["ink"], c["ink2"], c["ink3"], c["line"]
    COBALT, CLAY, GOOD, BAD, NEUTRAL = c["cobalt"], c["clay"], c["good"], c["bad"], c["neutral"]
    sorted_outcomes = sorted(outcome_counts.items(), key=lambda x: x[1], reverse=True)[:10]
    labels = [f"{your_w}-{opp_w}" for (your_w, opp_w), _ in sorted_outcomes]
    values = [count / total_sims * 100 for _, count in sorted_outcomes]
    colors = [GOOD if your_w > opp_w else BAD if opp_w > your_w else NEUTRAL
              for (your_w, opp_w), _ in sorted_outcomes]
    fig = go.Figure(data=[
        go.Bar(
            x=labels,
            y=values,
            marker_color=colors,
            text=[f'{v:.1f}%' for v in values],
            textposition='outside',
            textfont=dict(family=MONO, size=12, color=INK),
            cliponaxis=False
        )
    ])
    max_val = max(values) if values else 50
    y_max = max_val * 1.2
    fig.update_layout(
        paper_bgcolor='rgba(0,0,0,0)',
        plot_bgcolor='rgba(0,0,0,0)',
        font={'color': INK, 'family': SANS},
        height=300,
        margin=dict(l=40, r=40, t=50, b=60),
        xaxis=dict(
            title='Score Outcome (You - Opponent)',
            showgrid=False,
            tickfont=dict(family=MONO, size=12),
            type='category'
        ),
        yaxis=dict(
            title='Probability',
            showgrid=True,
            gridcolor=LINE,
            ticksuffix='%',
            range=[0, y_max]
        )
    )
    return fig


def create_championship_chart(playoff_results, your_team_name, finalist_team_ids=None):
    """Create bar chart of championship probabilities. Excludes teams with 0%."""
    c = _pal()
    INK, INK_2, INK_3, LINE = c["ink"], c["ink2"], c["ink3"], c["line"]
    COBALT, CLAY, GOOD, BAD, NEUTRAL = c["cobalt"], c["clay"], c["good"], c["bad"], c["neutral"]
    rows = playoff_results
    if finalist_team_ids is not None:
        fid = {int(x) for x in finalist_team_ids}
        rows = [r for r in playoff_results if int(r["team_id"]) in fid]
    champ_data = [(r["team_name"], r["championship_prob"]) for r in rows if r["championship_prob"] > 0.1]
    champ_data.sort(key=lambda x: x[1], reverse=True)
    labels = [x[0] for x in champ_data]
    values = [x[1] for x in champ_data]
    colors = [COBALT if t == your_team_name else CLAY for t in labels]
    y_max = max(values) * 1.2 + 5 if values else 30  # Headroom so bars and labels don't get cut off
    fig = go.Figure(data=[
        go.Bar(
            x=labels,
            y=values,
            marker_color=colors,
            text=[f"{v:.1f}%" for v in values],
            textposition="outside",
            textfont=dict(family=MONO, size=12, color=INK),
        )
    ])
    fig.update_layout(
        xaxis_tickangle=-45,
        yaxis_title="Championship %",
        yaxis=dict(range=[0, y_max], gridcolor=LINE),
        margin=dict(b=120, t=60),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        font=dict(color=INK_2, family=SANS),
        xaxis=dict(gridcolor=LINE),
    )
    return fig


def create_rank_trend_chart(teams, weeks, your_team_name):
    """
    Weekly power-ranking movement: one line per team, rank on the y-axis (1 at the
    top). Your team is drawn in cobalt and thick; the rest are muted so the shape of
    your season stands out. ``teams`` is the list from get_power_rankings; each has a
    ``rank_history`` aligned to ``weeks``.
    """
    c = _pal()
    INK, INK_2, LINE = c["ink"], c["ink2"], c["line"]
    COBALT, NEUTRAL = c["cobalt"], c["neutral"]
    x = [f"Wk {w}" for w in (weeks or [])]
    n_teams = max((len([t for t in teams])), 1)
    fig = go.Figure()
    # Muted lines first, your team last so it sits on top.
    for t in teams:
        if t["team_name"] == your_team_name:
            continue
        hist = t.get("rank_history", [])
        fig.add_trace(go.Scatter(
            x=x, y=hist, mode="lines", name=t["team_name"],
            line=dict(color=NEUTRAL, width=1.2), opacity=0.45,
            hovertemplate="%{fullData.name}: #%{y}<extra></extra>",
        ))
    you = next((t for t in teams if t["team_name"] == your_team_name), None)
    if you is not None:
        fig.add_trace(go.Scatter(
            x=x, y=you.get("rank_history", []), mode="lines+markers",
            name=you["team_name"],
            line=dict(color=COBALT, width=3.2),
            marker=dict(color=COBALT, size=6),
            hovertemplate="%{fullData.name}: #%{y}<extra></extra>",
        ))
    fig.update_layout(
        yaxis=dict(
            title="Power Rank", autorange="reversed", gridcolor=LINE,
            dtick=1, range=[n_teams + 0.5, 0.5],
        ),
        xaxis=dict(gridcolor=LINE),
        margin=dict(t=30, b=40, l=10, r=10),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        font=dict(color=INK_2, family=SANS),
        showlegend=False,
        height=420,
    )
    return fig
