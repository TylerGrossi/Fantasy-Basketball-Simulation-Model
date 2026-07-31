"""
Fantasy Basketball Simulator - Charts and scoreboard HTML.

Palette ("Analyst Sheet"): cobalt = your team, clay = opponent (identity);
green / red = good / bad (won / lost a category); graphite ink on warm paper.

Every chart in here renders as **inline SVG or plain HTML/CSS** and returns a string for
`st.markdown(..., unsafe_allow_html=True)`. There is deliberately no charting library:
Streamlit's Plotly integration pulled a 4.87 MB JS chunk the first time any chart page
opened (measured) and spent ~1s of main-thread script re-rendering the figures on every
visit, which was the single biggest cost in the app. These charts are simple enough
(one gauge, three bar charts, one line chart) that hand-rolled markup is both far
cheaper and a closer fit to the design system — it can read the CSS custom properties in
styles.py directly, instead of needing its own hardcoded copy of the palette the way
Plotly did.

Two rules when editing anything below:
  * **One line of HTML per loop iteration.** CommonMark treats 4+ leading spaces as an
    indented code block, so a multi-line indented f-string built inside a loop renders as
    literal escaped text from the second iteration onward — silently, with no error.
  * Numbers use MONO (tabular figures), labels use SANS. No emoji.
"""

import math

from config import CATEGORIES

# --- palette --------------------------------------------------------------------
# The SVG/HTML charts below use the `var(--*)` custom properties instead of these
# literals wherever they can, so the palette stays defined once in styles.py. These are
# kept because create_scoreboard_vertical and a few opacity blends still reference them.
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
    CATEGORY — your value / category label / opponent value, each with a bar showing the
    lead. This is the "stacked list" layout typical fantasy apps (ESPN, Yahoo) use on
    phones, replacing a 15-column wide table nobody could read without scrolling sideways
    through most of it. Category order matches ESPN's, so a row stays where you expect it.

    **The bar shows the MARGIN, diverging from a centre line — not the raw magnitude
    split.** It used to be `you / (you + opp)`, which is nearly 50/50 for every category
    no matter what: on a real 10-5 matchup the bars spanned only 38.7%..56.5% while the
    actual margins ran from +0.9% (FG%) to -45% (TW). The one graphical element on the
    page was flat exactly where the data was interesting. Now the bar length is the
    relative margin `(you - opp) / mean`, normalised to the biggest margin in this
    matchup, so a blowout and a coin-flip look completely different — and the four
    categories won by under 3% are visible as such.
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

    def _margin(cat):
        """
        Signed relative margin for a category, positive = you ahead. Sign is flipped for
        TO so "fewer turnovers" reads as a lead rather than a deficit. Dividing by the
        mean of the two values makes categories on wildly different scales (FG% ~0.48 vs
        PTS ~1900) directly comparable.
        """
        y, o = your_stats[cat], opp_stats[cat]
        mid = (y + o) / 2
        if not mid:
            return 0.0
        m = (y - o) / mid
        return -m if cat == "TO" else m

    # Normalise bar length to the biggest margin in THIS matchup, so the spread always
    # uses the full width. Floored at 10% so an all-close matchup doesn't render every
    # hairline lead as a dramatic full-width bar.
    max_margin = max((abs(_margin(c)) for c in categories_order), default=0.0)
    bar_scale = max(max_margin, 0.10)

    rows = ""
    for cat in categories_order:
        y_val, o_val = your_stats[cat], opp_stats[cat]
        lower_better = cat == "TO"
        y_win = (y_val < o_val) if lower_better else (y_val > o_val)
        o_win = (o_val < y_val) if lower_better else (o_val > y_val)
        # Lead is shown by the bar (cobalt/clay) + weight, not red/green on the numbers
        # themselves - stays legible and matches the rest of the design system, where
        # clay/bad-red are reserved for warnings, not "you're losing this stat".
        y_weight = 700 if y_win else 400
        o_weight = 700 if o_win else 400
        y_color = INK if y_win else INK_3
        o_color = INK if o_win else INK_3
        # A ratio printed to four decimals ("0.4868") is not a readable number - these are
        # percentages, so show them as such. Counting stats get a thousands separator.
        y_str = f"{y_val * 100:.1f}%" if "%" in cat else f"{int(y_val):,}"
        o_str = f"{o_val * 100:.1f}%" if "%" in cat else f"{int(o_val):,}"

        m = _margin(cat)
        # Non-zero but tiny margins still get a visible sliver rather than nothing.
        width = min(100.0, abs(m) / bar_scale * 100.0) if m else 0.0
        if 0 < width < 1.5:
            width = 1.5
        bar_color = COBALT if m > 0 else CLAY
        # One decimal below 10%, none above: on a category won by 0.9% the precision is
        # the whole point, and rounding it to "+1%" throws that away. On a 25% blowout the
        # decimal is noise.
        mar_str = ("TIED" if not m else
                   f"{m * 100:+.1f}%" if abs(m) < 0.10 else f"{m * 100:+.0f}%")
        mar_color = INK_3 if not m else (COBALT if m > 0 else CLAY)
        # Winner's bar grows outward from the centre line: right for you, left for them.
        left_bar = ("" if m >= 0 else
                    f'<div style="width:{width:.1f}%; height:7px; background:{bar_color}; border-radius:3px 0 0 3px;"></div>')
        right_bar = ("" if m <= 0 else
                     f'<div style="width:{width:.1f}%; height:7px; background:{bar_color}; border-radius:0 3px 3px 0;"></div>')
        # Built as ONE line with no leading whitespace: Streamlit's markdown renderer
        # treats 4+ leading spaces on a line as a CommonMark indented code block, which
        # silently turns HTML after the first row into literal escaped text — every row
        # after the first rendered as raw `<div ...>` text until this was flattened.
        rows += (
            f'<div class="sb-row" style="display:flex; align-items:center; gap:0.6rem; padding:0.55rem 0.1rem; border-bottom:1px solid {LINE};">'
            f'<div class="sb-val" style="min-width:62px; text-align:left; font-family:{MONO}; font-weight:{y_weight}; font-size:0.98rem; color:{y_color};">{y_str}</div>'
            f'<div style="flex:1; min-width:0;">'
            f'<div style="display:flex; align-items:baseline; justify-content:center; gap:0.4rem; margin-bottom:0.28rem;">'
            f'<span class="sb-cat" style="font-family:{SANS}; font-size:0.66rem; font-weight:700; letter-spacing:0.07em; text-transform:uppercase; color:{INK_2};">{cat}</span>'
            f'<span class="sb-margin" style="font-family:{MONO}; font-size:0.66rem; font-weight:600; color:{mar_color};">{mar_str}</span>'
            f'</div>'
            f'<div style="display:flex; align-items:center; height:9px; background:linear-gradient(to bottom, transparent calc(50% - 0.5px), {LINE} calc(50% - 0.5px), {LINE} calc(50% + 0.5px), transparent calc(50% + 0.5px));">'
            f'<div style="flex:1 1 0; min-width:0; display:flex; justify-content:flex-end;">{left_bar}</div>'
            f'<div style="flex:0 0 1px; height:9px; background:{INK_3};"></div>'
            f'<div style="flex:1 1 0; min-width:0; display:flex; justify-content:flex-start;">{right_bar}</div>'
            f'</div></div>'
            f'<div class="sb-val" style="min-width:62px; text-align:right; font-family:{MONO}; font-weight:{o_weight}; font-size:0.98rem; color:{o_color};">{o_str}</div>'
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
    """
    Win-probability gauge, inline SVG.

    A 180-degree track carrying the three confidence bands the Plotly version used as
    `steps` (0-40 red / 40-60 clay / 60-100 green, at low opacity), the value arc drawn
    over them, a tick at the value, and the percentage as a large tabular figure in the
    middle. Scales with its container via viewBox rather than a fixed pixel height.
    """
    pct = max(0.0, min(100.0, float(win_pct)))
    frac = pct / 100.0
    # Semicircle of radius R centred at (CX, CY). Arc length of a 180-degree sweep is
    # pi*R, which is what the stroke-dasharray reveals below. Two thicknesses, as Plotly's
    # gauge had: the tinted confidence bands occupy the full ring (BAND_W) and the value
    # bar is drawn narrower on the same radius, sitting inside them.
    CX, CY, R = 180.0, 186.0, 132.0
    BAND_W, BAR_W = 34.0, 21.0
    L = math.pi * R
    track = f"M {CX - R} {CY} A {R} {R} 0 0 1 {CX + R} {CY}"
    tone = "var(--good)" if pct >= 50 else "var(--bad)"

    def polar(t, radius):
        """Point at fraction t (0 = left end, 1 = right end) on a circle of `radius`."""
        ang = math.pi * t
        return CX - radius * math.cos(ang), CY - radius * math.sin(ang)

    # Bands drawn along the same path: dasharray gives the segment length, and a NEGATIVE
    # dashoffset of -start*L moves that segment to start at the right place.
    bands = ""
    for color, start, end in (("var(--bad)", 0.0, 0.40),
                              ("var(--clay)", 0.40, 0.60),
                              ("var(--good)", 0.60, 1.0)):
        bands += (f'<path d="{track}" fill="none" stroke="{color}" stroke-width="{BAND_W}" '
                  f'stroke-opacity="0.16" stroke-linecap="butt" '
                  f'stroke-dasharray="{(end - start) * L:.2f} {L:.2f}" '
                  f'stroke-dashoffset="{-start * L:.2f}"></path>')

    # Outer scale: 0/20/40/60/80/100, labels outside the ring like the Plotly axis.
    scale = ""
    for v in (0, 20, 40, 60, 80, 100):
        t = v / 100.0
        x1, y1 = polar(t, R + BAND_W / 2)
        x2, y2 = polar(t, R + BAND_W / 2 + 6)
        lx, ly = polar(t, R + BAND_W / 2 + 19)
        scale += (f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" '
                  f'stroke="var(--ink-3)" stroke-width="1"></line>')
        scale += (f'<text x="{lx:.2f}" y="{ly + 4:.2f}" text-anchor="middle" '
                  f'style="font-family:{MONO}; font-size:12px; fill:var(--ink-3);">{v}</text>')

    # Threshold tick at the value, spanning the full band thickness.
    tx1, ty1 = polar(frac, R - BAND_W / 2)
    tx2, ty2 = polar(frac, R + BAND_W / 2)
    tick = (f'<line x1="{tx1:.2f}" y1="{ty1:.2f}" x2="{tx2:.2f}" y2="{ty2:.2f}" '
            f'stroke="var(--ink)" stroke-width="3"></line>')

    return (
        f'<div style="max-width:360px; margin:0 auto 0.4rem;">'
        f'<svg viewBox="0 0 360 212" width="100%" role="img" '
        f'aria-label="Win probability {pct:.0f} percent" style="display:block;">'
        f'<path d="{track}" fill="none" stroke="var(--line)" stroke-width="{BAND_W}" '
        f'stroke-opacity="0.5" stroke-linecap="butt"></path>'
        f'{bands}'
        f'<path d="{track}" fill="none" stroke="{tone}" stroke-width="{BAR_W}" '
        f'stroke-linecap="butt" stroke-dasharray="{frac * L:.2f} {L:.2f}"></path>'
        f'{scale}{tick}'
        f'<text x="{CX}" y="{CY - 10}" text-anchor="middle" '
        f'style="font-family:{MONO}; font-size:50px; font-weight:700; fill:var(--ink);">'
        f'{pct:.0f}%</text>'
        f'</svg></div>'
    )


def create_category_chart(category_results, your_sim, opp_sim):
    """
    Per-category win rates as a DIVERGING bar chart (HTML/CSS), matching the layout the
    Plotly version used: category label on the left, then a shared centre axis with your
    win % growing to the RIGHT in cobalt and the opponent's to the LEFT in clay, the
    percentage printed at the outer end of each bar, and a 0-100% scale on both sides.

    ``your_sim`` / ``opp_sim`` are unused - kept so the call signature doesn't change.
    """
    LABEL_W = "52px"          # left gutter holding the category name
    # Quarter gridlines within each half (25/50/75%), drawn as a repeating gradient so the
    # rows and the axis below always line up on exactly the same positions.
    GRID = ("repeating-linear-gradient(to right, var(--line) 0 1px, "
            "transparent 1px 12.5%)")

    def bar(pct, color, side):
        """One half's bar. Label sits inside the bar unless the bar is too short."""
        inside = pct >= 13
        txt_style = (f"color:#fff; font-family:{MONO}; font-size:0.68rem; font-weight:600; "
                     f"padding:0 6px; white-space:nowrap;")
        out_style = (f"color:var(--ink-2); font-family:{MONO}; font-size:0.68rem; "
                     f"font-weight:600; padding:0 6px; white-space:nowrap;")
        label = f'{pct:.0f}%'
        # `side` is which way the bar grows: "right" for you, "left" for the opponent.
        justify = "flex-end" if side == "left" else "flex-start"
        # text hugs the OUTER end of the bar (far left for opp, far right for you)
        inner_justify = "flex-start" if side == "left" else "flex-end"
        piece = (f'<div style="width:{max(pct, 0.0):.2f}%; height:19px; background:{color}; '
                 f'border-radius:{"3px 0 0 3px" if side == "left" else "0 3px 3px 0"}; '
                 f'display:flex; align-items:center; justify-content:{inner_justify}; '
                 f'min-width:{"2px" if pct > 0 else "0"};">'
                 f'{f"<span style={chr(34)}{txt_style}{chr(34)}>{label}</span>" if inside else ""}'
                 f'</div>')
        outer = ("" if inside else
                 f'<span style="{out_style}">{label}</span>')
        # When the label doesn't fit inside, it goes on the bar's OUTER side (away from the
        # centre axis) - putting it on the axis side would shove the bar off the zero line.
        return (f'<div style="flex:1 1 0; min-width:0; display:flex; align-items:center; '
                f'justify-content:{justify}; background:{GRID};">'
                f'{outer if side == "left" else ""}{piece}{outer if side == "right" else ""}'
                f'</div>')

    rows = ""
    for cat in CATEGORIES:
        outcome = category_results[cat]
        total = sum(outcome.values()) or 1
        you_pct = outcome["you"] / total * 100
        opp_pct = outcome["opponent"] / total * 100
        # One line per iteration - see the module docstring.
        rows += (
            f'<div style="display:flex; align-items:center; gap:0.5rem; padding:2px 0;">'
            f'<div style="flex:0 0 {LABEL_W}; text-align:right; font-family:{SANS}; font-size:0.7rem; font-weight:600; color:var(--ink-2); white-space:nowrap;">{cat}</div>'
            f'<div style="flex:1 1 auto; min-width:0; display:flex; align-items:stretch; border-left:0; position:relative;">'
            f'{bar(opp_pct, "var(--clay)", "left")}'
            f'<div style="flex:0 0 1px; background:var(--ink-3);"></div>'
            f'{bar(you_pct, "var(--cobalt)", "right")}'
            f'</div></div>'
        )

    # 9 labels across 8 equal gaps, so they land on the same positions as the gridlines.
    ticks = ["100%", "75%", "50%", "25%", "0", "25%", "50%", "75%", "100%"]
    axis_row = (
        f'<div style="display:flex; align-items:center; gap:0.5rem; margin-top:0.35rem;">'
        f'<div style="flex:0 0 {LABEL_W};"></div>'
        f'<div style="flex:1 1 auto; min-width:0; display:flex; justify-content:space-between;">'
        + "".join(f'<span style="font-family:{MONO}; font-size:0.64rem; color:var(--ink-3);">{t}</span>'
                  for t in ticks)
        + f'</div></div>'
    )

    legend = (
        f'<div style="display:flex; justify-content:center; gap:1.3rem; margin-bottom:0.6rem; '
        f'font-family:{SANS}; font-size:0.72rem; color:var(--ink-2);">'
        f'<span><span style="display:inline-block; width:11px; height:11px; border-radius:2px; background:var(--cobalt); margin-right:0.4rem; vertical-align:-1px;"></span>You</span>'
        f'<span><span style="display:inline-block; width:11px; height:11px; border-radius:2px; background:var(--clay); margin-right:0.4rem; vertical-align:-1px;"></span>Opponent</span>'
        f'</div>'
    )
    return f'<div style="margin-bottom:0.5rem;">{legend}{rows}{axis_row}</div>'


def create_outcome_distribution(outcome_counts, total_sims):
    """
    Distribution of the 10 most likely category scores (HTML/CSS column chart).

    Columns are ordered by score rather than by frequency, so the shape reads as a
    distribution instead of a ranking; each is tinted green / red / grey for a win, loss
    or tie. Heights are a percentage of the tallest column, so the chart fills its box
    whatever the spread.
    """
    top = sorted(outcome_counts.items(), key=lambda kv: kv[1], reverse=True)[:10]
    if not top:
        return '<p style="color:var(--ink-2);">No simulated outcomes to show.</p>'
    # Reorder the selected outcomes left-to-right by your category count.
    top.sort(key=lambda kv: (kv[0][0] - kv[0][1], kv[0][0]))
    values = [count / total_sims * 100 for _, count in top]
    peak = max(values) or 1.0

    PLOT_H = 190  # px of column area, excluding the value and axis labels
    cols = ""
    for ((your_w, opp_w), count), pct in zip(top, values):
        color = ("var(--good)" if your_w > opp_w
                 else "var(--bad)" if opp_w > your_w else "var(--ink-3)")
        h = max(2.0, pct / peak * PLOT_H)
        # One line per iteration - see the module docstring.
        # max-width matters for the degenerate case: a COMPLETED week has exactly one
        # possible outcome, and without a cap that single column stretched the full width
        # of the container as one huge block. Capped + centred, one bar still reads as a
        # bar. (flex-basis 0 with a cap keeps 10 columns evenly spread as before.)
        cols += (
            f'<div style="flex:1 1 0; min-width:0; max-width:74px; display:flex; flex-direction:column; align-items:center; gap:0.3rem;">'
            f'<div style="font-family:{MONO}; font-size:0.72rem; color:var(--ink-2); white-space:nowrap;">{pct:.1f}%</div>'
            f'<div style="width:100%; height:{PLOT_H}px; display:flex; align-items:flex-end; justify-content:center;">'
            f'<div style="width:72%; height:{h:.1f}px; background:{color}; border-radius:3px 3px 0 0;" title="{your_w}-{opp_w}: {pct:.1f}%"></div>'
            f'</div>'
            f'<div style="font-family:{MONO}; font-size:0.74rem; font-weight:600; color:var(--ink); white-space:nowrap;">{your_w}-{opp_w}</div>'
            f'</div>'
        )
    return (
        f'<div style="margin-bottom:0.5rem;">'
        f'<div style="display:flex; align-items:flex-end; justify-content:center; gap:0.5rem; '
        f'border-bottom:1px solid var(--line); padding-bottom:0.35rem;">{cols}</div>'
        f'<div style="text-align:center; margin-top:0.45rem; font-family:{SANS}; '
        f'font-size:0.66rem; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; '
        f'color:var(--ink-3);">score outcome (you - opponent)</div>'
        f'</div>'
    )


def create_championship_chart(playoff_results, your_team_name, finalist_team_ids=None):
    """
    Championship probability per team (HTML/CSS), excluding teams at ~0%.

    Laid out HORIZONTALLY - team name, bar, percentage - rather than as the old column
    chart with -45-degree rotated labels. Team names are 10-20 characters and were the
    reason that chart needed 120px of bottom margin and still read awkwardly; as rows they
    just fit. Your team is cobalt, everyone else clay.
    """
    rows_in = playoff_results
    if finalist_team_ids is not None:
        fid = {int(x) for x in finalist_team_ids}
        rows_in = [r for r in playoff_results if int(r["team_id"]) in fid]
    champ_data = [(r["team_name"], r["championship_prob"])
                  for r in rows_in if r["championship_prob"] > 0.1]
    champ_data.sort(key=lambda x: x[1], reverse=True)
    if not champ_data:
        return '<p style="color:var(--ink-2);">No championship probabilities to show.</p>'
    peak = max(v for _, v in champ_data) or 1.0

    rows = ""
    for name, value in champ_data:
        is_you = name == your_team_name
        color = "var(--cobalt)" if is_you else "var(--clay)"
        weight = 700 if is_you else 400
        w = max(1.0, value / peak * 100.0)
        # One line per iteration - see the module docstring.
        rows += (
            f'<div style="display:flex; align-items:center; gap:0.7rem; padding:0.42rem 0.1rem; border-bottom:1px solid var(--line);">'
            f'<div style="flex:0 0 34%; min-width:0; font-family:{SANS}; font-size:0.82rem; font-weight:{weight}; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">{name}</div>'
            f'<div style="flex:1 1 auto; min-width:0; height:9px; border-radius:4px; background:var(--surface-2); overflow:hidden;">'
            f'<div style="width:{w:.2f}%; height:100%; background:{color}; border-radius:4px;"></div>'
            f'</div>'
            f'<div style="flex:0 0 54px; text-align:right; font-family:{MONO}; font-size:0.86rem; font-weight:{weight}; color:var(--ink);">{value:.1f}%</div>'
            f'</div>'
        )
    return (
        f'<div style="margin-bottom:0.5rem;">'
        f'<div style="font-family:{SANS}; font-size:0.66rem; font-weight:600; '
        f'letter-spacing:0.06em; text-transform:uppercase; color:var(--ink-3); '
        f'margin-bottom:0.4rem;">championship %</div>{rows}</div>'
    )


def create_rank_trend_chart(teams, weeks, your_team_name):
    """
    Weekly power-ranking movement as inline SVG: one polyline per team, rank on the
    y-axis with 1 at the top. Your team is cobalt and thick with point markers; the rest
    are muted hairlines so the shape of your season is what stands out. ``teams`` is the
    list from get_power_rankings; each has a ``rank_history`` aligned to ``weeks``.

    Native SVG `<title>` elements give per-line hover tooltips (team name + rank), which
    is what the Plotly hovertemplate provided.
    """
    weeks = list(weeks or [])
    teams = list(teams or [])
    if not weeks or not teams:
        return '<p style="color:var(--ink-2);">Not enough weeks played to chart a trend.</p>'

    n_teams = max(len(teams), 1)
    W, H = 900.0, 420.0
    PAD_L, PAD_R, PAD_T, PAD_B = 42.0, 14.0, 16.0, 34.0
    plot_w, plot_h = W - PAD_L - PAD_R, H - PAD_T - PAD_B

    def px(i):
        """x for week index i."""
        if len(weeks) == 1:
            return PAD_L + plot_w / 2
        return PAD_L + plot_w * i / (len(weeks) - 1)

    def py(rank):
        """y for a rank (1 at the top, n_teams at the bottom)."""
        span = max(1, n_teams - 1)
        return PAD_T + plot_h * (float(rank) - 1.0) / span

    def polyline(hist):
        """'x,y x,y ...' for a rank history, skipping gaps."""
        pts = [f"{px(i):.1f},{py(r):.1f}" for i, r in enumerate(hist)
               if i < len(weeks) and r is not None]
        return " ".join(pts)

    # Horizontal rank gridlines + y labels.
    grid = ""
    for rank in range(1, n_teams + 1):
        y = py(rank)
        grid += (f'<line x1="{PAD_L}" y1="{y:.1f}" x2="{W - PAD_R}" y2="{y:.1f}" '
                 f'stroke="var(--line)" stroke-width="1"></line>')
        grid += (f'<text x="{PAD_L - 10}" y="{y + 4:.1f}" text-anchor="end" '
                 f'style="font-family:{MONO}; font-size:11px; fill:var(--ink-3);">{rank}</text>')
    # Week labels along the bottom; thinned out so they never collide.
    step = max(1, len(weeks) // 12)
    for i, w in enumerate(weeks):
        if i % step and i != len(weeks) - 1:
            continue
        grid += (f'<text x="{px(i):.1f}" y="{H - PAD_B + 20:.1f}" text-anchor="middle" '
                 f'style="font-family:{MONO}; font-size:11px; fill:var(--ink-3);">{w}</text>')

    # Muted lines first, your team last so it draws on top.
    lines = ""
    you = None
    for t in teams:
        if t["team_name"] == your_team_name:
            you = t
            continue
        pts = polyline(t.get("rank_history", []))
        if not pts:
            continue
        lines += (f'<polyline points="{pts}" fill="none" stroke="var(--ink-3)" '
                  f'stroke-width="1.2" stroke-opacity="0.45" stroke-linejoin="round">'
                  f'<title>{t["team_name"]}</title></polyline>')
    if you is not None:
        hist = you.get("rank_history", [])
        pts = polyline(hist)
        if pts:
            lines += (f'<polyline points="{pts}" fill="none" stroke="var(--cobalt)" '
                      f'stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round">'
                      f'<title>{you["team_name"]}</title></polyline>')
            for i, r in enumerate(hist):
                if i >= len(weeks) or r is None:
                    continue
                lines += (f'<circle cx="{px(i):.1f}" cy="{py(r):.1f}" r="3.4" '
                          f'fill="var(--cobalt)"><title>{you["team_name"]} - '
                          f'week {weeks[i]}: #{r}</title></circle>')

    return (
        f'<div style="margin-bottom:0.5rem;">'
        f'<div style="display:flex; justify-content:space-between; align-items:baseline; '
        f'margin-bottom:0.2rem; font-family:{SANS}; font-size:0.66rem; font-weight:600; '
        f'letter-spacing:0.06em; text-transform:uppercase; color:var(--ink-3);">'
        f'<span>power rank</span><span>week</span></div>'
        f'<svg viewBox="0 0 {W:.0f} {H:.0f}" width="100%" role="img" '
        f'aria-label="Weekly power ranking movement" style="display:block;">'
        f'{grid}{lines}</svg></div>'
    )
