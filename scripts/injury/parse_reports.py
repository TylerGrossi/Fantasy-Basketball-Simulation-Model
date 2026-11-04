"""
Parse the downloaded NBA injury report PDFs into one table:
  report, game_date, game_time, matchup, team, player, name_key, status, category, reason

WHY BY POSITION, NOT BY LINE. pdfplumber's plain text interleaves the columns: a reason
that wraps onto two lines lands above and below the player's own line, and the 2021+ layout
reorders the columns (status before reason) and drops the Category / Previous Status
columns. So each word is placed by its x-position under the header row of its page, and
each row is anchored on its status word; every other word joins the anchor nearest to it
vertically (wrapped cells are centred on their row). Date, time, matchup and team are only
printed on a game's / team's first row and are carried down.

Rows with no status ("ALL PLAYERS AVAILABLE", "NOT YET SUBMITTED") become empty anchors so
their team name does not leak onto a neighbouring player.

    python scripts/injury/parse_reports.py      -> %LOCALAPPDATA%/fbbsim-injury-data/reports.csv
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import pandas as pd
import pdfplumber

DATA = Path(os.environ.get("LOCALAPPDATA", ".")) / "fbbsim-injury-data"
PDF_DIR = DATA / "pdf"
OUT = DATA / "reports.csv"

STATUSES = {"Out", "Questionable", "Doubtful", "Probable", "Available"}
# Header words -> column name. The two layouts spell some headers differently.
HEADERS = [
    ("Game Date", "game_date"), ("GameDate", "game_date"),
    ("Game Time", "game_time"), ("GameTime", "game_time"),
    ("Matchup", "matchup"), ("Team", "team"),
    ("Player Name", "player"), ("PlayerName", "player"),
    ("Category", "category"), ("Reason", "reason"),
    ("Current Status", "status"), ("CurrentStatus", "status"),
    ("Previous Status", "prev_status"), ("PreviousStatus", "prev_status"),
]
CARRY = ("game_date", "game_time", "matchup", "team")


def name_key(name: str) -> str:
    """'Hart,Josh' / 'Nance Jr., Larry' -> 'joshhart' / 'larrynancejr': letters only, first then last."""
    if "," in name:
        last, first = name.split(",", 1)
        name = f"{first} {last}"
    return re.sub(r"[^a-z]", "", name.lower())


def find_columns(words):
    """Column name -> left x, from the header row (the first line containing 'Matchup')."""
    head = [w for w in words if w["text"] == "Matchup"]
    if not head:
        return None, None
    top = head[0]["top"]
    line = sorted((w for w in words if abs(w["top"] - top) < 3), key=lambda w: w["x0"])
    cols: dict[str, float] = {}
    i = 0
    while i < len(line):
        one = line[i]["text"]
        two = f"{one} {line[i + 1]['text']}" if i + 1 < len(line) else ""
        hit = next((c for h, c in HEADERS if h == two), None)
        if hit:
            cols.setdefault(hit, line[i]["x0"])
            i += 2
            continue
        hit = next((c for h, c in HEADERS if h == one), None)
        if hit:
            cols.setdefault(hit, line[i]["x0"])
        i += 1
    return cols, top


def column_of(x, edges):
    """The column whose left edge is the last one at or left of x (with a little slack)."""
    best = None
    for name, left in edges:
        if x >= left - 4:
            best = name
    return best


def parse_page(page, carry):
    words = page.extract_words(x_tolerance=1.5, keep_blank_chars=False)
    cols, head_top = find_columns(words)
    # The 2021+ layout prints the header on page 1 only: later pages reuse its columns
    # and start right under the title line.
    if cols and "status" in cols and "player" in cols:
        carry["_cols"] = cols
    elif "_cols" in carry:
        cols = carry["_cols"]
        title = [w["top"] for w in words if w["text"] in ("Injury", "Report:")]
        head_top = (max(title) if title else 0) + 2
    else:
        return []
    edges = sorted(cols.items(), key=lambda kv: kv[1])
    body = [w for w in words if w["top"] > head_top + 8 and not w["text"].startswith("Page")]
    # Footer: "Page N of M" and anything on its line.
    foot = [w["top"] for w in words if w["text"] == "Page"]
    if foot:
        body = [w for w in body if w["top"] < min(foot) - 2]

    for w in body:
        w["col"] = column_of(w["x0"], edges)
    anchors = [
        {"top": w["top"], "status": w["text"]}
        for w in body if w["col"] == "status" and w["text"] in STATUSES
    ]
    # Empty rows ("ALL PLAYERS AVAILABLE", "NOT YET SUBMITTED") anchor their team name too.
    anchors += [
        {"top": w["top"], "status": None}
        # "NOT YET SUBMITTED" / "ALL PLAYERS AVAILABLE": in the player column in 2019, the
        # reason column in 2021+, spaced or run together - so matched in any column.
        for w in body
        if w["text"].startswith(("NOTYET", "ALLPLAYERS"))
        or (w["text"] in ("NOT", "ALL") and any(
            v["text"] in ("YET", "PLAYERS") and abs(v["top"] - w["top"]) < 2 for v in body))
    ]
    if not anchors:
        return []
    anchors.sort(key=lambda a: a["top"])
    cells = [dict() for _ in anchors]
    for w in body:
        if w["col"] is None:
            continue
        k = min(range(len(anchors)), key=lambda j: abs(anchors[j]["top"] - w["top"]))
        cells[k].setdefault(w["col"], []).append(w)

    rows = []
    for a, c in zip(anchors, cells):
        text = {
            col: " ".join(x["text"] for x in sorted(ws, key=lambda x: (round(x["top"]), x["x0"])))
            for col, ws in c.items()
        }
        # Carry date/time/matchup/team down; a new matchup starts a new team block too.
        if "matchup" in text and text["matchup"] != carry.get("matchup"):
            carry.pop("team", None)
        for col in CARRY:
            if text.get(col):
                carry[col] = text[col]
        if a["status"] is None:
            continue
        player = text.get("player", "")
        if not player:
            continue
        rows.append({
            "game_date": carry.get("game_date", ""),
            "game_time": carry.get("game_time", ""),
            "matchup": carry.get("matchup", ""),
            "team": carry.get("team", ""),
            "player": player,
            "name_key": name_key(player),
            "status": a["status"],
            "category": text.get("category", ""),
            "reason": text.get("reason", ""),
        })
    return rows


def parse_file(path: Path):
    rows, carry = [], {}
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            rows += parse_page(page, carry)
    for r in rows:
        r["report"] = path.stem
    return rows


def main(paths=None) -> None:
    paths = paths or sorted(PDF_DIR.glob("*.pdf"))
    out, bad = [], []
    for i, p in enumerate(paths, 1):
        try:
            got = parse_file(p)
            if not got:
                bad.append(p.name)
            out += got
        except Exception as e:  # a corrupt PDF loses that day, not the run
            bad.append(f"{p.name}: {e.__class__.__name__}")
        if i % 100 == 0:
            print(f"  {i}/{len(paths)} reports, {len(out)} rows", flush=True)
    df = pd.DataFrame(out)
    df.to_csv(OUT, index=False)
    print(f"{len(paths)} reports -> {len(df)} rows -> {OUT}")
    if bad:
        print(f"{len(bad)} reports gave no rows: {bad[:10]}{' ...' if len(bad) > 10 else ''}")


if __name__ == "__main__":
    main([Path(a) for a in sys.argv[1:]] or None)
