// Fantasy Basketball Monte Carlo Simulation API
// This runs the simulation entirely in JavaScript for Vercel compatibility

const CATEGORY_VARIANCE = {
  FGM: 0.7, FGA: 0.7,
  FTM: 0.2, FTA: 0.2,
  "3PM": 0.7, "3PA": 0.7,
  REB: 0.4, AST: 0.4,
  STL: 0.8, BLK: 0.8,
  TO: 0.5, PTS: 0.7,
  DD: 0.7, TW: 0.7
};

const CATEGORIES = ["FGM", "FGA", "FG%", "FT%", "3PM", "3PA", "3P%",
                    "REB", "AST", "STL", "BLK", "TO", "PTS", "DD", "TW"];

const NUMERIC_COLS = ['FGM', 'FGA', 'FG%', 'FTM', 'FTA', 'FT%', '3PM', '3PA', '3P%',
                      'REB', 'AST', 'STL', 'BLK', 'TO', 'DD', 'PTS', 'TW'];

const INJURED_STATUSES = new Set(["OUT", "INJURY_RESERVE"]);

const NBA_TEAM_MAP = {
  "ATL": "atl", "BOS": "bos", "BKN": "bkn", "CHA": "cha", "CHI": "chi",
  "CLE": "cle", "DAL": "dal", "DEN": "den", "DET": "det", "GSW": "gs",
  "HOU": "hou", "IND": "ind", "LAC": "lac", "LAL": "la", "MEM": "mem",
  "MIA": "mia", "MIL": "mil", "MIN": "min", "NOP": "no", "NYK": "ny",
  "OKC": "okc", "ORL": "orl", "PHI": "phi", "PHX": "pho", "POR": "por",
  "SAC": "sac", "SAS": "sa", "TOR": "tor", "UTA": "utah", "WAS": "wsh"
};

const TEAM_FIXES = {"PHL": "PHI", "PHO": "PHX", "GS": "GSW", "WSH": "WAS", 
                   "NO": "NOP", "SA": "SAS", "NY": "NYK"};

// Gaussian random using Box-Muller transform
function gaussianRandom(mean, stdDev) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * stdDev + mean;
}

function normalizeTeam(t) {
  if (!t) return null;
  t = String(t).toUpperCase().trim();
  return TEAM_FIXES[t] || t;
}

function safeNum(x) {
  const n = parseFloat(x);
  return isNaN(n) ? 0 : n;
}

// ESPN API Functions
async function fetchESPN(url, cookies) {
  const response = await fetch(url, {
    headers: {
      'Cookie': `espn_s2=${cookies.espn_s2}; SWID=${cookies.swid}`,
      'Accept': 'application/json',
    }
  });
  
  if (!response.ok) {
    throw new Error(`ESPN API error: ${response.status}`);
  }
  
  return response.json();
}

async function getLeagueData(config) {
  const { league_id, espn_s2, swid, year = 2026 } = config;
  
  // Get league settings and current matchup period
  const settingsUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${year}/segments/0/leagues/${league_id}?view=mSettings`;
  const settingsData = await fetchESPN(settingsUrl, { espn_s2, swid });
  
  const currentMatchupPeriod = settingsData.scoringPeriodId || settingsData.status?.currentMatchupPeriod || 1;
  const leagueName = settingsData.settings?.name || 'League';
  
  // Get team and roster data
  const rosterUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${year}/segments/0/leagues/${league_id}?view=mTeam&view=mRoster&view=mMatchup&view=mMatchupScore&scoringPeriodId=${currentMatchupPeriod}`;
  const leagueData = await fetchESPN(rosterUrl, { espn_s2, swid });
  
  return { leagueData, currentMatchupPeriod, leagueName };
}

async function getTeamSchedule(teamAbbrev) {
  if (!teamAbbrev) return [];
  
  const normalized = normalizeTeam(teamAbbrev);
  const slug = NBA_TEAM_MAP[normalized];
  if (!slug) return [];
  
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${slug}/schedule`;
    const response = await fetch(url);
    if (!response.ok) return [];
    
    const data = await response.json();
    const dates = [];
    
    for (const event of (data.events || [])) {
      try {
        const dateStr = event.date;
        const dt = new Date(dateStr);
        dates.push(dt.toISOString().split('T')[0]);
      } catch (e) {
        // Skip invalid dates
      }
    }
    return dates;
  } catch (e) {
    return [];
  }
}

function countGamesLeft(schedule) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Find end of current week (Sunday)
  const dayOfWeek = today.getDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const endOfWeek = new Date(today);
  endOfWeek.setDate(today.getDate() + daysUntilSunday);
  
  const todayStr = today.toISOString().split('T')[0];
  const endStr = endOfWeek.toISOString().split('T')[0];
  
  return schedule.filter(d => d >= todayStr && d <= endStr).length;
}

function buildPlayerStats(players, periodKey, teamName) {
  const result = [];
  
  for (const player of players) {
    const stats = player.stats || [];
    let periodStats = null;
    
    // Find the right stats period
    for (const s of stats) {
      if (s.id === periodKey || s.statSourceId === 0) {
        periodStats = s;
        break;
      }
    }
    
    if (!periodStats) continue;
    
    const avgStats = periodStats.averageStats || periodStats.stats || {};
    const totalStats = periodStats.stats || {};
    
    const gp = safeNum(totalStats[42]) || safeNum(avgStats[42]) || 1; // GP is stat ID 42
    if (gp <= 0) continue;
    
    // ESPN stat IDs mapping
    const fgm = safeNum(avgStats[13] || (totalStats[13] / gp));
    const fga = safeNum(avgStats[14] || (totalStats[14] / gp));
    const ftm = safeNum(avgStats[15] || (totalStats[15] / gp));
    const fta = safeNum(avgStats[16] || (totalStats[16] / gp));
    const tpm = safeNum(avgStats[17] || (totalStats[17] / gp));
    const tpa = safeNum(avgStats[18] || (totalStats[18] / gp));
    const reb = safeNum(avgStats[6] || (totalStats[6] / gp));
    const ast = safeNum(avgStats[3] || (totalStats[3] / gp));
    const stl = safeNum(avgStats[2] || (totalStats[2] / gp));
    const blk = safeNum(avgStats[1] || (totalStats[1] / gp));
    const to = safeNum(avgStats[11] || (totalStats[11] / gp));
    const pts = safeNum(avgStats[0] || (totalStats[0] / gp));
    const dd = safeNum(totalStats[37] || 0) / gp;  // Double-doubles
    const tw = safeNum(totalStats[38] || 0) / gp;  // Triple-doubles (might be different ID)
    
    result.push({
      Player: player.fullName || player.player?.fullName || 'Unknown',
      NBA_Team: player.proTeamId,
      Team: teamName,
      FGM: fgm, FGA: fga,
      "FG%": fga > 0 ? fgm / fga : 0,
      FTM: ftm, FTA: fta,
      "FT%": fta > 0 ? ftm / fta : 0,
      "3PM": tpm, "3PA": tpa,
      "3P%": tpa > 0 ? tpm / tpa : 0,
      REB: reb, AST: ast, STL: stl, BLK: blk, TO: to, PTS: pts,
      DD: dd, TW: tw,
      injuryStatus: player.injuryStatus,
      "Games Left": 0
    });
  }
  
  return result;
}

function flattenStatDict(d) {
  if (!d) return {};
  const result = {};
  for (const [k, v] of Object.entries(d)) {
    result[k] = typeof v === 'object' && v !== null && 'value' in v ? v.value : v;
  }
  return result;
}

function blendStats(seasonPlayers, last30Players, blendWeight = 0.7) {
  const seasonLookup = {};
  for (const p of seasonPlayers) {
    seasonLookup[p.Player] = p;
  }
  
  const blended = [];
  for (const l30 of last30Players) {
    const sea = seasonLookup[l30.Player];
    if (!sea) continue;
    
    const player = {
      Player: l30.Player,
      NBA_Team: l30.NBA_Team,
      Team: l30.Team,
      "Games Left": l30["Games Left"] || 0,
    };
    
    for (const col of NUMERIC_COLS) {
      const v30 = l30[col] || 0;
      const vsea = sea[col] || 0;
      player[col] = v30 * blendWeight + vsea * (1 - blendWeight);
    }
    
    if (player["Games Left"] > 0) {
      blended.push(player);
    }
  }
  
  return blended;
}

function simulateTeam(players, sims = 10000) {
  const results = {};
  const allStats = [...Object.keys(CATEGORY_VARIANCE), "FG%", "FT%", "3P%"];
  
  for (const stat of allStats) {
    results[stat] = [];
  }
  
  for (let i = 0; i < sims; i++) {
    const totals = {};
    for (const stat of Object.keys(CATEGORY_VARIANCE)) {
      totals[stat] = 0;
    }
    
    for (const player of players) {
      const gamesLeft = player["Games Left"] || 0;
      for (let g = 0; g < gamesLeft; g++) {
        for (const stat of Object.keys(CATEGORY_VARIANCE)) {
          const mean = player[stat] || 0;
          const stdDev = mean * CATEGORY_VARIANCE[stat];
          totals[stat] += gaussianRandom(mean, stdDev);
        }
      }
    }
    
    // Calculate percentages
    totals["FG%"] = totals.FGA > 0 ? totals.FGM / totals.FGA : 0;
    totals["FT%"] = totals.FTA > 0 ? totals.FTM / totals.FTA : 0;
    totals["3P%"] = totals["3PA"] > 0 ? totals["3PM"] / totals["3PA"] : 0;
    
    for (const stat of allStats) {
      results[stat].push(totals[stat] || 0);
    }
  }
  
  return results;
}

function addCurrentToSim(current, sim) {
  const adjusted = {};
  
  for (const stat of Object.keys(sim)) {
    adjusted[stat] = sim[stat].map(val => {
      if (["FG%", "FT%", "3P%"].includes(stat)) {
        return 0; // Will recalculate
      }
      return val + (current[stat] || 0);
    });
  }
  
  // Recalculate percentages
  for (let i = 0; i < sim.FGM.length; i++) {
    const FGM = adjusted.FGM[i];
    const FGA = adjusted.FGA[i];
    adjusted["FG%"][i] = FGA > 0 ? FGM / FGA : 0;
    
    const FTM = adjusted.FTM[i];
    const FTA = adjusted.FTA[i];
    adjusted["FT%"][i] = FTA > 0 ? FTM / FTA : 0;
    
    const TPM = adjusted["3PM"][i];
    const TPA = adjusted["3PA"][i];
    adjusted["3P%"][i] = TPA > 0 ? TPM / TPA : 0;
  }
  
  return adjusted;
}

function compareMatchups(sim1, sim2, categories) {
  const sims = sim1.FGM.length;
  const matchupResults = { you: 0, opponent: 0, tie: 0 };
  const categoryOutcomes = {};
  const outcomeCounts = {};
  
  for (const cat of categories) {
    categoryOutcomes[cat] = { you: 0, opponent: 0, tie: 0 };
  }
  
  for (let i = 0; i < sims; i++) {
    let yourWins = 0;
    let oppWins = 0;
    
    for (const cat of categories) {
      const yVal = sim1[cat][i];
      const oVal = sim2[cat][i];
      
      if (cat === "TO") {
        if (yVal < oVal) {
          yourWins++;
          categoryOutcomes[cat].you++;
        } else if (yVal > oVal) {
          oppWins++;
          categoryOutcomes[cat].opponent++;
        } else {
          categoryOutcomes[cat].tie++;
        }
      } else {
        if (yVal > oVal) {
          yourWins++;
          categoryOutcomes[cat].you++;
        } else if (yVal < oVal) {
          oppWins++;
          categoryOutcomes[cat].opponent++;
        } else {
          categoryOutcomes[cat].tie++;
        }
      }
    }
    
    const key = `${yourWins}-${oppWins}`;
    outcomeCounts[key] = (outcomeCounts[key] || 0) + 1;
    
    if (yourWins > oppWins) {
      matchupResults.you++;
    } else if (oppWins > yourWins) {
      matchupResults.opponent++;
    } else {
      matchupResults.tie++;
    }
  }
  
  return { matchupResults, categoryOutcomes, outcomeCounts };
}

function mean(arr) {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

// ESPN Pro Team ID to abbreviation
const PRO_TEAM_MAP = {
  1: "ATL", 2: "BOS", 3: "NOP", 4: "CHI", 5: "CLE",
  6: "DAL", 7: "DEN", 8: "DET", 9: "GSW", 10: "HOU",
  11: "IND", 12: "LAC", 13: "LAL", 14: "MIA", 15: "MIL",
  16: "MIN", 17: "BKN", 18: "NYK", 19: "ORL", 20: "PHI",
  21: "PHX", 22: "POR", 23: "SAC", 24: "SAS", 25: "OKC",
  26: "UTA", 27: "WAS", 28: "TOR", 29: "MEM", 30: "CHA"
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const config = req.body;
    
    // Validate required fields
    const required = ["league_id", "espn_s2", "swid", "team_id"];
    for (const field of required) {
      if (!config[field]) {
        return res.status(400).json({ error: `Missing required field: ${field}` });
      }
    }
    
    const teamId = parseInt(config.team_id);
    const simCount = Math.min(parseInt(config.sim_count) || 10000, 15000); // Cap at 15k for performance
    const streamersToTest = parseInt(config.streamers_to_test) || 20;
    const year = config.year || 2026;
    
    // Get league data
    const { leagueData, currentMatchupPeriod, leagueName } = await getLeagueData(config);
    
    // Find teams
    const teams = leagueData.teams || [];
    const yourTeam = teams.find(t => t.id === teamId);
    
    if (!yourTeam) {
      return res.status(400).json({ error: `Team ID ${teamId} not found in league` });
    }
    
    // Find current matchup
    const schedule = leagueData.schedule || [];
    const currentMatchup = schedule.find(m => 
      m.matchupPeriodId === currentMatchupPeriod &&
      (m.home?.teamId === teamId || m.away?.teamId === teamId)
    );
    
    if (!currentMatchup) {
      return res.status(400).json({ error: 'No matchup found for current week' });
    }
    
    const oppTeamId = currentMatchup.home?.teamId === teamId 
      ? currentMatchup.away?.teamId 
      : currentMatchup.home?.teamId;
    
    const oppTeam = teams.find(t => t.id === oppTeamId);
    
    if (!oppTeam) {
      return res.status(400).json({ error: 'Opponent team not found' });
    }
    
    // Get current totals from matchup
    const yourMatchupStats = currentMatchup.home?.teamId === teamId 
      ? currentMatchup.home 
      : currentMatchup.away;
    const oppMatchupStats = currentMatchup.home?.teamId === teamId 
      ? currentMatchup.away 
      : currentMatchup.home;
    
    const buildTotals = (stats) => {
      const s = stats?.cumulativeScore?.scoreByStat || {};
      return {
        FGM: safeNum(s[13]?.score),
        FGA: safeNum(s[14]?.score),
        FTM: safeNum(s[15]?.score),
        FTA: safeNum(s[16]?.score),
        "3PM": safeNum(s[17]?.score),
        "3PA": safeNum(s[18]?.score),
        REB: safeNum(s[6]?.score),
        AST: safeNum(s[3]?.score),
        STL: safeNum(s[2]?.score),
        BLK: safeNum(s[1]?.score),
        TO: safeNum(s[11]?.score),
        PTS: safeNum(s[0]?.score),
        DD: safeNum(s[37]?.score),
        TW: safeNum(s[38]?.score),
      };
    };
    
    const currentYou = buildTotals(yourMatchupStats);
    const currentOpp = buildTotals(oppMatchupStats);
    
    // Get rosters
    const yourRoster = yourTeam.roster?.entries || [];
    const oppRoster = oppTeam.roster?.entries || [];
    
    // Filter injured players
    const filterInjured = (roster) => roster.filter(e => 
      !INJURED_STATUSES.has(e.injuryStatus) && 
      !INJURED_STATUSES.has(e.playerPoolEntry?.player?.injuryStatus)
    );
    
    const yourFiltered = filterInjured(yourRoster);
    const oppFiltered = filterInjured(oppRoster);
    
    // Extract player data
    const extractPlayers = (roster) => roster.map(e => ({
      ...e.playerPoolEntry?.player,
      fullName: e.playerPoolEntry?.player?.fullName,
      proTeamId: PRO_TEAM_MAP[e.playerPoolEntry?.player?.proTeamId] || 'FA',
      injuryStatus: e.injuryStatus || e.playerPoolEntry?.player?.injuryStatus,
      stats: e.playerPoolEntry?.player?.stats || []
    }));
    
    const yourPlayers = extractPlayers(yourFiltered);
    const oppPlayers = extractPlayers(oppFiltered);
    
    // Build stats (using season stats - statSourceId 0)
    const yourSeasonStats = buildPlayerStats(yourPlayers, '002026', yourTeam.name);
    const oppSeasonStats = buildPlayerStats(oppPlayers, '002026', oppTeam.name);
    
    // For simplicity, use season stats (last 30 requires different API call)
    // Add games left
    const scheduleCache = {};
    
    const addGamesLeft = async (players) => {
      for (const p of players) {
        const team = p.NBA_Team;
        if (!scheduleCache[team]) {
          scheduleCache[team] = await getTeamSchedule(team);
        }
        p["Games Left"] = countGamesLeft(scheduleCache[team]);
      }
      return players;
    };
    
    await addGamesLeft(yourSeasonStats);
    await addGamesLeft(oppSeasonStats);
    
    // Filter to players with games left
    const yourTeamPlayers = yourSeasonStats.filter(p => p["Games Left"] > 0);
    const oppTeamPlayers = oppSeasonStats.filter(p => p["Games Left"] > 0);
    
    // Run simulation
    const yourSimRaw = simulateTeam(yourTeamPlayers, simCount);
    const oppSimRaw = simulateTeam(oppTeamPlayers, simCount);
    
    const yourSim = addCurrentToSim(currentYou, yourSimRaw);
    const oppSim = addCurrentToSim(currentOpp, oppSimRaw);
    
    const { matchupResults, categoryOutcomes, outcomeCounts } = compareMatchups(yourSim, oppSim, CATEGORIES);
    
    // Calculate projected score
    const totalSims = matchupResults.you + matchupResults.opponent + matchupResults.tie;
    let youWins = 0;
    
    for (const cat of CATEGORIES) {
      const yProj = mean(yourSim[cat]);
      const oProj = mean(oppSim[cat]);
      if (cat === "TO") {
        if (yProj < oProj) youWins++;
      } else {
        if (yProj > oProj) youWins++;
      }
    }
    
    // Top outcomes
    const sortedOutcomes = Object.entries(outcomeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([score, count]) => ({
        score,
        probability: (count / totalSims) * 100
      }));
    
    // Category details
    const categories = [];
    const swingCategories = [];
    
    for (const cat of CATEGORIES) {
      const outcome = categoryOutcomes[cat];
      const totalCat = outcome.you + outcome.opponent + outcome.tie;
      const youPct = (outcome.you / totalCat) * 100;
      const oppPct = (outcome.opponent / totalCat) * 100;
      
      const isSwing = Math.abs(youPct - oppPct) <= 15;
      if (isSwing) {
        swingCategories.push(cat);
      }
      
      categories.push({
        name: cat,
        outcomes: outcome,
        projections: {
          you: mean(yourSim[cat]),
          opp: mean(oppSim[cat])
        }
      });
    }
    
    // Expected categories
    let baselineAvgCats = 0;
    for (const [score, count] of Object.entries(outcomeCounts)) {
      const [yourW] = score.split('-').map(Number);
      baselineAvgCats += yourW * count;
    }
    baselineAvgCats /= totalSims;
    
    // Streamer analysis (simplified - just show top free agents by projected value)
    // Full streamer sim would require additional API calls
    const streamers = [];
    
    // Build response
    const response = {
      matchup: {
        your_team: yourTeam.name || `Team ${teamId}`,
        opponent_team: oppTeam.name || `Team ${oppTeamId}`,
        week: currentMatchupPeriod
      },
      matchup_results: matchupResults,
      projected_score: {
        you: youWins,
        opponent: CATEGORIES.length - youWins
      },
      top_outcomes: sortedOutcomes,
      categories,
      swing_categories: swingCategories,
      baseline_cats: baselineAvgCats,
      streamers,
      debug: {
        your_players: yourTeamPlayers.length,
        opp_players: oppTeamPlayers.length,
        simulations: simCount
      }
    };
    
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('Simulation error:', error);
    return res.status(500).json({ 
      error: error.message || 'Simulation failed',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
