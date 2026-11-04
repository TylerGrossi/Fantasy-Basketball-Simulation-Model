"""
Download the NBA's official injury report PDFs - the labels for the Will They Play model.

The league publishes the report several times a day at
  https://ak-static.cms.nba.com/referee/injury/Injury-Report_<YYYY-MM-DD>_<HH>PM.pdf
and the archive goes back to 2018-12-17. The 01PM and 05PM files exist in every season
(06PM since 2022), so those are the two we keep: 05PM is the game-day read (most games tip
at 7 ET or later), 01PM the earlier one.

Files land OUTSIDE the OneDrive repo (%LOCALAPPDATA%/fbbsim-injury-data/pdf) - a few
hundred MB of PDFs is not something to sync. Already-downloaded files are skipped, and a
day with no report (offseason, All-Star break) is remembered so reruns are cheap.

POLITE BY DESIGN. The host sits behind Akamai's firewall: eight parallel requests got the
machine blocked ("Access Denied", a failover-waf page) after ~200 files (2026-11-03). So
this is strictly sequential with a pause between requests, and it STOPS the moment it sees
the firewall page rather than recording blocked days as "no report".

    python scripts/injury/fetch_reports.py [--start 2018-12-17] [--end today] [--times 05PM]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import time
from pathlib import Path

import requests

URL = "https://ak-static.cms.nba.com/referee/injury/Injury-Report_{date}_{time}.pdf"
# Since late December 2025 the league publishes every 15 minutes and names the files with
# minutes ("05_00PM"); before that, on the hour ("05PM"). Both are tried, old name first.
def variants(t: str) -> list[str]:
    return [t, f"{t[:2]}_00{t[2:]}"] if len(t) == 4 else [t]
DATA = Path(os.environ.get("LOCALAPPDATA", ".")) / "fbbsim-injury-data"
PDF_DIR = DATA / "pdf"
MISSING = DATA / "missing.json"
# No NBA games: mid-July to the end of September. (The 2020 bubble ran into October and
# its reports are in the archive, so only these months are skipped outright.)
OFF_MONTHS = {8, 9}


def dates(start: dt.date, end: dt.date):
    d = start
    while d <= end:
        if d.month not in OFF_MONTHS:
            yield d
        d += dt.timedelta(days=1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2018-12-17")
    ap.add_argument("--end", default=dt.date.today().isoformat())
    ap.add_argument("--times", default="05PM", help="comma list, e.g. 05PM,01PM")
    ap.add_argument("--delay", type=float, default=2.0, help="seconds between requests")
    args = ap.parse_args()

    PDF_DIR.mkdir(parents=True, exist_ok=True)
    missing = set(json.loads(MISSING.read_text())) if MISSING.exists() else set()
    session = requests.Session()
    session.headers["User-Agent"] = "Mozilla/5.0"

    jobs = [
        (d.isoformat(), t)
        for d in dates(dt.date.fromisoformat(args.start), dt.date.fromisoformat(args.end))
        for t in args.times.split(",")
    ]
    todo = [
        (d, t) for d, t in jobs
        if f"{d}_{t}" not in missing and not (PDF_DIR / f"{d}_{t}.pdf").exists()
    ]
    print(f"{len(jobs)} report slots, {len(todo)} to fetch", flush=True)

    def get(job):
        d, t = job
        status = "missing"
        for name in variants(t):
            try:
                r = session.get(URL.format(date=d, time=name), timeout=30)
            except requests.RequestException as e:
                return f"error {e.__class__.__name__}"
            if r.status_code == 200 and r.content[:4] == b"%PDF":
                (PDF_DIR / f"{d}_{t}.pdf").write_bytes(r.content)
                return "ok"
            if b"failover-waf" in r.content:
                return "blocked"
            status = f"missing {r.status_code}"
            time.sleep(args.delay)
        return status

    got = gone = errs = 0
    for i, (d, t) in enumerate(todo, 1):
        res = get((d, t))
        if res == "blocked":
            MISSING.write_text(json.dumps(sorted(missing)))
            print(f"BLOCKED by the firewall at {d} {t} after {got} saved - stopping. "
                  "Wait an hour or two and rerun; finished files are kept.", flush=True)
            raise SystemExit(2)
        if res == "ok":
            got += 1
        elif res.startswith("missing"):
            gone += 1
            missing.add(f"{d}_{t}")
        else:
            errs += 1  # transient: retried on the next run
        if i % 100 == 0:
            print(f"  {i}/{len(todo)}: {got} saved, {gone} no report, {errs} errors", flush=True)
            MISSING.write_text(json.dumps(sorted(missing)))
        time.sleep(args.delay)
    MISSING.write_text(json.dumps(sorted(missing)))
    print(f"done: {got} saved, {gone} no report, {errs} errors (rerun to retry errors)")


if __name__ == "__main__":
    main()
