/**
 * Will They Play — the data contract for public/data/availability.json (owner, 2026-11-03).
 *
 * Written by the export from two models (scripts/injury/):
 *   - the GAME-DAY model, for a game the NBA's official injury report already covers:
 *     the listed status (Out / Doubtful / Questionable / Probable / Available) plus the
 *     player's and team's own record when listed, minutes role, games missed in a row;
 *   - the LOOK-AHEAD model, for a game no report covers yet: the schedule (second night
 *     of a back-to-back) and the player's habits (how much more often he sits those).
 * Every probability is CALIBRATED: "60%" means players in that spot played about 60% of
 * the time in the seasons the model was tested on, not a yes/no call.
 *
 * The page shows only real model output — no file, no numbers (the page says so).
 */

/** One scheduled game and the chance he plays it. */
export interface AvailabilityGame {
  /** ISO date (ET). */
  date: string;
  /** Opponent abbreviation, and whether the game is at home. */
  opp: string;
  home: boolean;
  /** Second night of a back-to-back for his team. */
  b2b: boolean;
  /** Chance he plays, 0-1, calibrated. */
  p: number;
  /** Which model produced `p`: the injury report's game-day read, or the look-ahead. */
  source: "report" | "lookahead";
}

export interface AvailabilityPlayer {
  name: string;
  nbaTeam: string;
  /** Real positions he is eligible at (PG..C). */
  positions: string[];
  /** Fantasy team that rosters him; "" for a free agent. */
  owner: string;
  /** Status on the latest report ("Questionable"), else ESPN's ("DAY_TO_DAY"), else "". */
  status: string;
  /** The report's reason, cleaned up ("Left Hamstring; Strain"); "" when healthy. */
  injury: string;
  /** His next game; null when his team has none left in the window. */
  next: AvailabilityGame | null;
  /** Every remaining game in the current matchup week, in date order. */
  week: AvailabilityGame[];
  /** Plain-language reasons behind the next-game number, most important first. */
  factors: string[];
  /** ESPN's expected return date (ISO, from its injuries feed) when he is out; null if none. */
  expectedReturn?: string | null;
  /** ESPN's latest note on the injury ("expected to miss four weeks"); "" when none. */
  note?: string;
  /** How often he played when listed with this same status before (null: never listed). */
  record: { listed: number; played: number } | null;
}

export interface AvailabilityData {
  generatedAt: string;
  /** The injury report the game-day numbers read, e.g. "2026-11-03 05:30 PM ET"; null if none yet today. */
  reportTime: string | null;
  model: {
    /** Last game date the models were trained on. */
    trainedThrough: string;
    /** Seasons of injury reports and box scores behind them, e.g. "2018-19 to 2025-26". */
    seasons: string;
  };
  /** The fantasy season's last day (ISO). A return after it = out for the season. */
  seasonEnd?: string | null;
  players: AvailabilityPlayer[];
}

/** Colour bucket for a probability: the ring and the numbers share it. */
export function availabilityTone(p: number): "good" | "mid" | "bad" {
  if (p >= 0.75) return "good";
  if (p <= 0.35) return "bad";
  return "mid";
}
