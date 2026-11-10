# Public launch notes (reference only)

Written 2026-11-09. These are background notes for **if** FBB Sim ever becomes a public,
multi-user, multi-format site. They are not a plan, not a decision, and not legal advice.
Terms of service and laws change, so check the current version of anything here before
relying on it, and get a real lawyer before charging money.

---

## Bottom line

- **Using sports stats is legal.** Player names, box scores and stats are facts. US courts
  have held fantasy sites can use them without a league license
  (*NBA v. Motorola*, 2d Cir. 1997; *C.B.C. v. MLB Advanced Media*, 8th Cir. 2007).
- **The real risk is how the data is obtained.** The app depends on ESPN endpoints that
  ESPN never published for outside developers. Negligible risk for a personal tool;
  for a public product ESPN could block it or send a cease-and-desist at any time.
- **"All formats" is mostly engineering.** The engine is built around one ESPN league with
  15-category head-to-head scoring.

---

## Data sources in use (as of 2026-11-09)

| Source | Used for | Public-site risk |
|---|---|---|
| ESPN fantasy API (`lm-api-reads.fantasy.espn.com`) via the `espn-api` package, authenticated with `espn_s2` / `SWID` cookies | All league data | **Highest.** Unofficial; ESPN's terms ban automated access; private leagues need each user's login cookies. |
| `site.api.espn.com`, `site.web.api.espn.com`, `sports.core.api.espn.com` | NBA schedule (`engine/data.py`), game logs, bios | Unofficial, no license, can break without notice. |
| `a.espncdn.com` headshots (`lib/playerPool.ts`) | Player photos | Copyrighted images, hotlinked. Must be replaced. |
| NBA injury report PDFs (`ak-static.cms.nba.com`, `scripts/injury/`) | Availability model | Low. Use the facts; don't republish the PDFs. |
| FantasyPros and Hashtag Basketball scraping (`scripts/build_draft.py`) | Draft rankings / projections | Drop or license. Their rankings are their product; both ban scraping. |
| Gemini API, free tier with model rotation (`lib/gemini.ts`) | Agent page | Not viable publicly (see Gemini section). |

---

## Exposure that exists even as a personal site

There is no login wall, so the site is reachable by anyone with the URL, and the GitHub
repo is public.

1. **`/api/agent` is open.** Anyone can use up the Gemini quota.
2. **`/api/sync` is writable by anyone.** It only checks the key format, so anyone could
   overwrite settings or week plans.
3. **`public/data/league.json` is in a public repo.** It contains leaguemates' team names,
   rosters and moves.

ESPN cookies themselves are handled correctly (gitignored `config_secrets.py`, GitHub
secrets in CI).

Quick fixes: Vercel deployment protection or a middleware password; make the repo private
or stop committing `league.json`; require a secret on `/api/agent` and `/api/sync`.

---

## Legal framework

- **Stats / facts:** free to use, including your own simulation outputs.
- **Copyright:** photos, logos, written news, and other sites' rankings and projections are
  protected. Use licensed photos, initials or silhouettes.
- **Trademark:** "Works with ESPN and Yahoo leagues" is fine (nominative fair use). Don't use
  their logos or NBA team logos, or imply an official connection. Add a disclaimer such as
  "Not affiliated with ESPN, Yahoo, or the NBA."
- **Terms of service / contract:** where real disputes happen. Reading public pages generally
  isn't a crime (*hiQ v. LinkedIn*; *Van Buren v. US*, 2021), but breach-of-contract claims
  can still succeed. Reading login-only data with a user's cookies is grayer than reading
  public pages.
- **Gambling:** a free analytics tool showing win percentages (even in American-odds format)
  isn't gambling. That changes with paid entry fees plus prizes (state fantasy-contest laws)
  or sportsbook affiliate links (some states regulate affiliates; need age gates).

---

## Platform APIs

| Platform | Official API? | Notes |
|---|---|---|
| **ESPN** | No | Every third-party ESPN tool reverse-engineers it. Private leagues require users to paste `espn_s2` / `SWID`, which are effectively login credentials. Storing them makes you responsible for securing them and may break ESPN's account terms. |
| **Yahoo** | Yes (OAuth) | Cleanest route. Requires OAuth for user data, bans reverse-engineering, requires reasonable security. The fantasy-specific terms page returned a 404 on 2026-11-09; read current terms before building, especially on commercial use. General API terms: https://legal.yahoo.com/us/en/yahoo/terms/product-atos/apiforydn/index.html |
| **Sleeper** | Yes (read-only, no auth) | Free for **non-commercial** use; commercial use needs a license (api@sleeper.app). Stay under 1,000 calls/min or risk an IP block. **Docs said only `"nfl"` is supported** as of 2026-11-09, so no basketball. https://docs.sleeper.com/ |
| **Fantrax, CBS, others** | None, or very limited | Scraping again, or a partnership. |

**NBA data for a commercial site** (schedule, game logs, bios) would need a licensed provider:
Sportradar or SportsDataIO (expensive), or cheaper options like balldontlie. The `nba_api`
Python package is also unofficial.

---

## Gemini

- **Free tier:** Google may use prompts and responses to improve its products, and human
  reviewers may read them. Not acceptable for other people's conversations without telling
  them. https://ai.google.dev/gemini-api/terms
- **Region:** requests from EEA, Switzerland and UK users must go through paid service.
- **Scale:** rotating free-tier models to dodge per-minute quotas won't hold up. Needs the
  paid tier, per-user rate limits and logins.
- **Search grounding:** Google requires displaying its search suggestions with grounded results.

---

## Running a public site

- Terms of Service and a Privacy Policy (you'd store league data and possibly ESPN cookies).
- 13+ age requirement (COPPA): don't knowingly collect children's data.
- GDPR and cookie consent if serving EU users or adding analytics / ads. California CCPA
  thresholds are unlikely to apply at hobby scale.
- **Vercel Hobby is personal, non-commercial only.** Ads or a paid tier means Vercel Pro.
- An LLC before charging money, to separate liability from personal assets.
- DMCA agent registration (cheap) only if users can post content.

---

## Engineering work for multi-user, all formats

1. **Accounts and access control:** logins; protect `/api/agent` and `/api/sync`.
2. **Per-league data:** replace checked-in `public/data/*.json` and the GitHub Actions refresh
   with a database and per-league refresh jobs (scheduled or on demand).
3. **Platform adapter layer:** convert ESPN, Yahoo, etc. into one internal league model.
   `engine/` is ESPN-shaped today, down to ESPN stat ids and matchup periods.
4. **General scoring engine:** H2H categories with any category set (9-cat, 8-cat, custom),
   H2H points, rotisserie, season points. The per-category normal simulation fits category
   leagues; points and roto need different math.
5. **Credential security:** encrypt stored ESPN cookies and Yahoo OAuth tokens.
6. **Replacements:** licensed or no player images; no scraped FantasyPros / Hashtag data.

---

## A possible path (if ever)

1. **Personal-site hygiene (anytime):** password the site, make the repo private or stop
   committing `league.json`, lock down `/api/agent` and `/api/sync`.
2. **Free public beta:** add Yahoo via OAuth; keep ESPN as "connect with your cookies" with
   clear warnings; drop scraped rankings and ESPN headshots; publish ToS and privacy policy;
   move Gemini to paid with rate limits.
3. **Before monetizing:** LLC, Vercel Pro, licensed NBA data, ask Sleeper about a commercial
   license if they add NBA, and a short legal review of the ESPN integration in particular.
