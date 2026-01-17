import { useState, useEffect } from 'react';
import Head from 'next/head';

// YOUR CREDENTIALS - HARDCODED
const MY_CONFIG = {
  league_id: "267469544",
  team_id: "6",
  espn_s2: "AEBSyUk%2FmdLqOc%2BSzyDjGNUS5ikQCnK8FvvsGLMAu7mVyKgLRXAa6q6s9eaLrXj3rPzfOoB9H%2BIukXFCBnnSjLEjnSmOIiRzuXP8bEZGpYrVN4FJ5OgT3FuHfRmKV0SrwKJRbyjW0Irlz%2BTyk2QCsg5eTa7GtgXJ8sxXaF9MVhjc9ielluRUU%2FbGcCrpIAOhAzkbklw4Gs2UsEBHdWXzgMO6TUWJjzFN5afsaby20y9ONU5rz6r1J27VWoC5YgUiR3NpH%2F4hpyMf0xXvJUGv9fSI5lt6%2BskojM22lBfr2DwJgA%3D%3D",
  swid: "{D7E89394-85F1-4264-831E-481F3B4157D4}",
  sim_count: 10000,
  year: 2026,
};

// Constants
const CATEGORY_VARIANCE = {
  FGM: 0.7, FGA: 0.7, FTM: 0.2, FTA: 0.2,
  "3PM": 0.7, "3PA": 0.7, REB: 0.4, AST: 0.4,
  STL: 0.8, BLK: 0.8, TO: 0.5, PTS: 0.7, DD: 0.7, TW: 0.7
};

const CATEGORIES = ["FGM", "FGA", "FG%", "FT%", "3PM", "3PA", "3P%",
                    "REB", "AST", "STL", "BLK", "TO", "PTS", "DD", "TW"];

const PRO_TEAM_MAP = {
  1: "ATL", 2: "BOS", 3: "NOP", 4: "CHI", 5: "CLE", 6: "DAL", 7: "DEN",
  8: "DET", 9: "GSW", 10: "HOU", 11: "IND", 12: "LAC", 13: "LAL", 14: "MIA",
  15: "MIL", 16: "MIN", 17: "BKN", 18: "NYK", 19: "ORL", 20: "PHI", 21: "PHX",
  22: "POR", 23: "SAC", 24: "SAS", 25: "OKC", 26: "UTA", 27: "WAS", 28: "TOR",
  29: "MEM", 30: "CHA"
};

const NBA_TEAM_MAP = {
  "ATL": "atl", "BOS": "bos", "BKN": "bkn", "CHA": "cha", "CHI": "chi",
  "CLE": "cle", "DAL": "dal", "DEN": "den", "DET": "det", "GSW": "gs",
  "HOU": "hou", "IND": "ind", "LAC": "lac", "LAL": "la", "MEM": "mem",
  "MIA": "mia", "MIL": "mil", "MIN": "min", "NOP": "no", "NYK": "ny",
  "OKC": "okc", "ORL": "orl", "PHI": "phi", "PHX": "pho", "POR": "por",
  "SAC": "sac", "SAS": "sa", "TOR": "tor", "UTA": "utah", "WAS": "wsh"
};

// Helper functions
function gaussianRandom(mean, stdDev) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * stdDev + mean;
}

function safeNum(x) {
  const n = parseFloat(x);
  return isNaN(n) ? 0 : n;
}

function mean(arr) {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

export default function Home() {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('Initializing...');

  useEffect(() => {
    runSimulation();
  }, []);

  const fetchESPNData = async () => {
    const espn_s2 = decodeURIComponent(MY_CONFIG.espn_s2);
    const swid = MY_CONFIG.swid;
    const league_id = MY_CONFIG.league_id;
    const year = MY_CONFIG.year;

    // Use a CORS proxy to fetch ESPN data from the browser
    // We'll try direct fetch first, then fall back to a proxy
    const baseUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${year}/segments/0/leagues/${league_id}`;
    
    setStatus('Fetching league settings...');
    
    // Try fetching through our API route that will proxy the request
    const settingsResponse = await fetch('/api/espn-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: `${baseUrl}?view=mSettings`,
        espn_s2,
        swid
      })
    });

    if (!settingsResponse.ok) {
      const err = await settingsResponse.json();
      throw new Error(err.error || 'Failed to fetch settings');
    }

    const settingsData = await settingsResponse.json();
    const currentMatchupPeriod = settingsData.scoringPeriodId || settingsData.status?.currentMatchupPeriod || 1;

    setStatus('Fetching rosters and matchups...');

    const rosterResponse = await fetch('/api/espn-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: `${baseUrl}?view=mTeam&view=mRoster&view=mMatchup&view=mMatchupScore&scoringPeriodId=${currentMatchupPeriod}`,
        espn_s2,
        swid
      })
    });

    if (!rosterResponse.ok) {
      const err = await rosterResponse.json();
      throw new Error(err.error || 'Failed to fetch rosters');
    }

    const leagueData = await rosterResponse.json();
    return { leagueData, currentMatchupPeriod };
  };

  const getTeamSchedule = async (teamAbbrev) => {
    if (!teamAbbrev || !NBA_TEAM_MAP[teamAbbrev]) return [];
    
    const slug = NBA_TEAM_MAP[teamAbbrev];
    try {
      const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${slug}/schedule`);
      if (!response.ok) return [];
      
      const data = await response.json();
      return (data.events || []).map(e => new Date(e.date).toISOString().split('T')[0]);
    } catch {
      return [];
    }
  };

  const countGamesLeft = (schedule) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const dayOfWeek = today.getDay();
    const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    const endOfWeek = new Date(today);
    endOfWeek.setDate(today.getDate() + daysUntilSunday);
    
    const todayStr = today.toISOString().split('T')[0];
    const endStr = endOfWeek.toISOString().split('T')[0];
    
    return schedule.filter(d => d >= todayStr && d <= endStr).length;
  };

  const buildPlayerStats = (players, teamName) => {
    return players.map(player => {
      const stats = player.stats || [];
      let periodStats = stats.find(s => s.statSourceId === 0 && s.statSplitTypeId === 0) 
                       || stats.find(s => s.statSourceId === 0);
      
      if (!periodStats) return null;
      
      const avgStats = periodStats.averageStats || {};
      const totalStats = periodStats.stats || {};
      const gp = safeNum(totalStats[42]) || 1;
      
      if (gp <= 0) return null;
      
      const fgm = safeNum(avgStats[13] || (totalStats[13] / gp));
      const fga = safeNum(avgStats[14] || (totalStats[14] / gp));
      const ftm = safeNum(avgStats[15] || (totalStats[15] / gp));
      const fta = safeNum(avgStats[16] || (totalStats[16] / gp));
      const tpm = safeNum(avgStats[17] || (totalStats[17] / gp));
      const tpa = safeNum(avgStats[18] || (totalStats[18] / gp));
      
      return {
        Player: player.fullName || 'Unknown',
        NBA_Team: PRO_TEAM_MAP[player.proTeamId] || 'FA',
        Team: teamName,
        FGM: fgm, FGA: fga, FTM: ftm, FTA: fta,
        "3PM": tpm, "3PA": tpa,
        REB: safeNum(avgStats[6] || (totalStats[6] / gp)),
        AST: safeNum(avgStats[3] || (totalStats[3] / gp)),
        STL: safeNum(avgStats[2] || (totalStats[2] / gp)),
        BLK: safeNum(avgStats[1] || (totalStats[1] / gp)),
        TO: safeNum(avgStats[11] || (totalStats[11] / gp)),
        PTS: safeNum(avgStats[0] || (totalStats[0] / gp)),
        DD: safeNum(totalStats[37] || 0) / gp,
        TW: safeNum(totalStats[38] || 0) / gp,
        "Games Left": 0
      };
    }).filter(Boolean);
  };

  const simulateTeam = (players, sims) => {
    const results = {};
    const allStats = [...Object.keys(CATEGORY_VARIANCE), "FG%", "FT%", "3P%"];
    allStats.forEach(stat => results[stat] = []);
    
    for (let i = 0; i < sims; i++) {
      const totals = {};
      Object.keys(CATEGORY_VARIANCE).forEach(stat => totals[stat] = 0);
      
      players.forEach(player => {
        const gamesLeft = player["Games Left"] || 0;
        for (let g = 0; g < gamesLeft; g++) {
          Object.keys(CATEGORY_VARIANCE).forEach(stat => {
            const m = player[stat] || 0;
            totals[stat] += gaussianRandom(m, m * CATEGORY_VARIANCE[stat]);
          });
        }
      });
      
      totals["FG%"] = totals.FGA > 0 ? totals.FGM / totals.FGA : 0;
      totals["FT%"] = totals.FTA > 0 ? totals.FTM / totals.FTA : 0;
      totals["3P%"] = totals["3PA"] > 0 ? totals["3PM"] / totals["3PA"] : 0;
      
      allStats.forEach(stat => results[stat].push(totals[stat] || 0));
    }
    
    return results;
  };

  const addCurrentToSim = (current, sim) => {
    const adjusted = {};
    Object.keys(sim).forEach(stat => {
      adjusted[stat] = sim[stat].map(val => 
        ["FG%", "FT%", "3P%"].includes(stat) ? 0 : val + (current[stat] || 0)
      );
    });
    
    for (let i = 0; i < sim.FGM.length; i++) {
      adjusted["FG%"][i] = adjusted.FGA[i] > 0 ? adjusted.FGM[i] / adjusted.FGA[i] : 0;
      adjusted["FT%"][i] = adjusted.FTA[i] > 0 ? adjusted.FTM[i] / adjusted.FTA[i] : 0;
      adjusted["3P%"][i] = adjusted["3PA"][i] > 0 ? adjusted["3PM"][i] / adjusted["3PA"][i] : 0;
    }
    
    return adjusted;
  };

  const runSimulation = async () => {
    setLoading(true);
    setError(null);
    setStatus('Connecting to ESPN...');

    try {
      const { leagueData, currentMatchupPeriod } = await fetchESPNData();
      
      const teams = leagueData.teams || [];
      const teamId = parseInt(MY_CONFIG.team_id);
      const yourTeam = teams.find(t => t.id === teamId);
      
      if (!yourTeam) throw new Error(`Team ID ${teamId} not found`);
      
      setStatus('Finding matchup...');
      
      const schedule = leagueData.schedule || [];
      const currentMatchup = schedule.find(m => 
        m.matchupPeriodId === currentMatchupPeriod &&
        (m.home?.teamId === teamId || m.away?.teamId === teamId)
      );
      
      if (!currentMatchup) throw new Error('No matchup found for current week');
      
      const oppTeamId = currentMatchup.home?.teamId === teamId 
        ? currentMatchup.away?.teamId 
        : currentMatchup.home?.teamId;
      const oppTeam = teams.find(t => t.id === oppTeamId);
      
      if (!oppTeam) throw new Error('Opponent not found');

      setStatus('Processing rosters...');
      
      // Get current week totals
      const yourStats = currentMatchup.home?.teamId === teamId ? currentMatchup.home : currentMatchup.away;
      const oppStats = currentMatchup.home?.teamId === teamId ? currentMatchup.away : currentMatchup.home;
      
      const buildTotals = (stats) => {
        const s = stats?.cumulativeScore?.scoreByStat || {};
        return {
          FGM: safeNum(s[13]?.score), FGA: safeNum(s[14]?.score),
          FTM: safeNum(s[15]?.score), FTA: safeNum(s[16]?.score),
          "3PM": safeNum(s[17]?.score), "3PA": safeNum(s[18]?.score),
          REB: safeNum(s[6]?.score), AST: safeNum(s[3]?.score),
          STL: safeNum(s[2]?.score), BLK: safeNum(s[1]?.score),
          TO: safeNum(s[11]?.score), PTS: safeNum(s[0]?.score),
          DD: safeNum(s[37]?.score), TW: safeNum(s[38]?.score),
        };
      };
      
      const currentYou = buildTotals(yourStats);
      const currentOpp = buildTotals(oppStats);
      
      // Extract players
      const extractPlayers = (roster) => (roster?.entries || [])
        .filter(e => !["OUT", "INJURY_RESERVE"].includes(e.injuryStatus))
        .map(e => ({
          ...e.playerPoolEntry?.player,
          fullName: e.playerPoolEntry?.player?.fullName,
          proTeamId: e.playerPoolEntry?.player?.proTeamId,
          stats: e.playerPoolEntry?.player?.stats || []
        }));
      
      const yourPlayers = buildPlayerStats(extractPlayers(yourTeam.roster), yourTeam.name);
      const oppPlayers = buildPlayerStats(extractPlayers(oppTeam.roster), oppTeam.name);
      
      setStatus('Fetching NBA schedules...');
      
      // Get games left for each player
      const scheduleCache = {};
      for (const p of [...yourPlayers, ...oppPlayers]) {
        if (!scheduleCache[p.NBA_Team]) {
          scheduleCache[p.NBA_Team] = await getTeamSchedule(p.NBA_Team);
        }
        p["Games Left"] = countGamesLeft(scheduleCache[p.NBA_Team]);
      }
      
      setStatus(`Running ${MY_CONFIG.sim_count.toLocaleString()} simulations...`);
      
      // Filter and simulate
      const yourActive = yourPlayers.filter(p => p["Games Left"] > 0);
      const oppActive = oppPlayers.filter(p => p["Games Left"] > 0);
      
      const yourSimRaw = simulateTeam(yourActive, MY_CONFIG.sim_count);
      const oppSimRaw = simulateTeam(oppActive, MY_CONFIG.sim_count);
      
      const yourSim = addCurrentToSim(currentYou, yourSimRaw);
      const oppSim = addCurrentToSim(currentOpp, oppSimRaw);
      
      // Compare matchups
      const sims = yourSim.FGM.length;
      const matchupResults = { you: 0, opponent: 0, tie: 0 };
      const categoryOutcomes = {};
      const outcomeCounts = {};
      
      CATEGORIES.forEach(cat => categoryOutcomes[cat] = { you: 0, opponent: 0, tie: 0 });
      
      for (let i = 0; i < sims; i++) {
        let yourWins = 0, oppWins = 0;
        
        CATEGORIES.forEach(cat => {
          const yVal = yourSim[cat][i];
          const oVal = oppSim[cat][i];
          const youWin = cat === "TO" ? yVal < oVal : yVal > oVal;
          const oppWin = cat === "TO" ? yVal > oVal : yVal < oVal;
          
          if (youWin) { yourWins++; categoryOutcomes[cat].you++; }
          else if (oppWin) { oppWins++; categoryOutcomes[cat].opponent++; }
          else { categoryOutcomes[cat].tie++; }
        });
        
        const key = `${yourWins}-${oppWins}`;
        outcomeCounts[key] = (outcomeCounts[key] || 0) + 1;
        
        if (yourWins > oppWins) matchupResults.you++;
        else if (oppWins > yourWins) matchupResults.opponent++;
        else matchupResults.tie++;
      }
      
      // Calculate projected score
      let youWins = 0;
      CATEGORIES.forEach(cat => {
        const yProj = mean(yourSim[cat]);
        const oProj = mean(oppSim[cat]);
        if (cat === "TO" ? yProj < oProj : yProj > oProj) youWins++;
      });
      
      // Build results
      const sortedOutcomes = Object.entries(outcomeCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([score, count]) => ({ score, probability: (count / sims) * 100 }));
      
      const categories = CATEGORIES.map(cat => {
        const outcome = categoryOutcomes[cat];
        const total = outcome.you + outcome.opponent + outcome.tie;
        return {
          name: cat,
          outcomes: outcome,
          projections: { you: mean(yourSim[cat]), opp: mean(oppSim[cat]) }
        };
      });
      
      const swingCategories = categories
        .filter(c => {
          const total = c.outcomes.you + c.outcomes.opponent + c.outcomes.tie;
          return Math.abs((c.outcomes.you / total) - (c.outcomes.opponent / total)) <= 0.15;
        })
        .map(c => c.name);
      
      setResults({
        matchup: {
          your_team: yourTeam.name,
          opponent_team: oppTeam.name,
          week: currentMatchupPeriod
        },
        matchup_results: matchupResults,
        projected_score: { you: youWins, opponent: CATEGORIES.length - youWins },
        top_outcomes: sortedOutcomes,
        categories,
        swing_categories: swingCategories,
      });
      
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // UI Components
  const WinProbabilityBar = ({ you, opponent }) => {
    const total = you + opponent;
    const youPct = total > 0 ? (you / total) * 100 : 50;
    const oppPct = total > 0 ? (opponent / total) * 100 : 50;
    
    return (
      <div className="probability-bar-container">
        <div className="probability-labels">
          <span className="you-label">{youPct.toFixed(1)}%</span>
          <span className="opp-label">{oppPct.toFixed(1)}%</span>
        </div>
        <div className="probability-bar">
          <div className="you-bar" style={{ width: `${youPct}%` }} />
          <div className="opp-bar" style={{ width: `${oppPct}%` }} />
        </div>
        <div className="probability-legend">
          <span className="you-legend">◆ You</span>
          <span className="opp-legend">◆ Opponent</span>
        </div>
      </div>
    );
  };

  const CategoryRow = ({ cat, data, projections }) => {
    const total = data.you + data.opponent + data.tie;
    const youPct = total > 0 ? (data.you / total) * 100 : 50;
    const oppPct = total > 0 ? (data.opponent / total) * 100 : 50;
    const isSwing = Math.abs(youPct - oppPct) <= 15;
    const youWinning = youPct > oppPct;
    
    return (
      <tr className={isSwing ? 'swing-category' : ''}>
        <td className="cat-name">{cat}{isSwing && <span className="swing-badge">⭐</span>}</td>
        <td className="cat-bar">
          <div className="mini-bar">
            <div className={`mini-you ${youWinning ? 'winning' : ''}`} style={{ width: `${youPct}%` }} />
          </div>
        </td>
        <td className={`pct ${youWinning ? 'winning' : ''}`}>{youPct.toFixed(0)}%</td>
        <td className={`pct ${!youWinning ? 'winning' : ''}`}>{oppPct.toFixed(0)}%</td>
        <td className="projection">{projections?.you?.toFixed(cat.includes('%') ? 3 : 1)}</td>
        <td className="projection">{projections?.opp?.toFixed(cat.includes('%') ? 3 : 1)}</td>
      </tr>
    );
  };

  return (
    <>
      <Head>
        <title>Fantasy Basketball Simulator</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
      </Head>

      <div className="app">
        <header>
          <div className="logo">
            <span className="ball">🏀</span>
            <h1>FANTASY HOOPS<span className="accent">SIM</span></h1>
          </div>
        </header>

        <main>
          {loading && (
            <div className="loading-panel">
              <div className="spinner-large"></div>
              <h2>Running Simulation...</h2>
              <p>{status}</p>
            </div>
          )}

          {error && (
            <div className="error-panel">
              <h2>⚠️ Error</h2>
              <p>{error}</p>
              <button onClick={runSimulation} className="retry-btn">🔄 Retry</button>
            </div>
          )}

          {!loading && !error && results && (
            <div className="results-panel">
              <div className="matchup-header">
                <h2>{results.matchup.your_team}</h2>
                <span className="vs">VS</span>
                <h2>{results.matchup.opponent_team}</h2>
              </div>

              <div className="win-probability-section">
                <h3>Win Probability</h3>
                <WinProbabilityBar you={results.matchup_results.you} opponent={results.matchup_results.opponent} />
              </div>

              <div className="projected-score">
                <div className="score-box">
                  <span className="score">{results.projected_score.you}</span>
                  <span className="label">You</span>
                </div>
                <span className="score-divider">-</span>
                <div className="score-box opp">
                  <span className="score">{results.projected_score.opponent}</span>
                  <span className="label">Opponent</span>
                </div>
              </div>

              <div className="outcomes-section">
                <h3>Most Likely Outcomes</h3>
                <div className="outcomes-grid">
                  {results.top_outcomes.map((outcome, i) => (
                    <div key={i} className="outcome-card">
                      <span className="outcome-score">{outcome.score}</span>
                      <span className="outcome-pct">{outcome.probability.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="categories-section">
                <h3>Category Breakdown</h3>
                <div className="table-wrapper">
                  <table className="categories-table">
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>Win Rate</th>
                        <th>You</th>
                        <th>Opp</th>
                        <th>Your Proj</th>
                        <th>Opp Proj</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.categories.map((cat) => (
                        <CategoryRow key={cat.name} cat={cat.name} data={cat.outcomes} projections={cat.projections} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {results.swing_categories?.length > 0 && (
                <div className="swing-section">
                  <h3>🎯 Swing Categories</h3>
                  <p>Focus streaming efforts on these close categories:</p>
                  <div className="swing-tags">
                    {results.swing_categories.map((cat) => (
                      <span key={cat} className="swing-tag">{cat}</span>
                    ))}
                  </div>
                </div>
              )}

              <button onClick={runSimulation} className="refresh-btn">🔄 Refresh Simulation</button>
            </div>
          )}
        </main>

        <footer>
          <p>Week {results?.matchup?.week || '—'} • {MY_CONFIG.sim_count.toLocaleString()} simulations</p>
        </footer>
      </div>

      <style jsx global>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg-dark: #0a0a0f; --bg-card: #12121a; --bg-input: #1a1a25;
          --border: #2a2a3a; --text: #e8e8f0; --text-dim: #8888a0;
          --accent: #ff6b35; --accent-glow: rgba(255, 107, 53, 0.3);
          --success: #00d97e; --danger: #e63757;
          --you-color: #00d97e; --opp-color: #e63757;
        }
        body {
          font-family: 'Space Mono', monospace;
          background: var(--bg-dark); color: var(--text); min-height: 100vh;
          background-image: radial-gradient(ellipse at 20% 0%, rgba(255, 107, 53, 0.08) 0%, transparent 50%),
            radial-gradient(ellipse at 80% 100%, rgba(0, 217, 126, 0.05) 0%, transparent 50%);
        }
        .app { max-width: 1000px; margin: 0 auto; padding: 20px; min-height: 100vh; }
        header { text-align: center; padding: 30px 0 20px; }
        .logo { display: flex; align-items: center; justify-content: center; gap: 15px; }
        .ball { font-size: 40px; }
        h1 { font-family: 'Bebas Neue', sans-serif; font-size: 36px; letter-spacing: 3px; }
        h1 .accent { color: var(--accent); }
        .loading-panel { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 60px 30px; text-align: center; }
        .loading-panel h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; letter-spacing: 2px; margin: 20px 0 10px; }
        .loading-panel p { color: var(--text-dim); font-size: 14px; }
        .spinner-large { width: 50px; height: 50px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .error-panel { background: var(--bg-card); border: 1px solid var(--danger); border-radius: 12px; padding: 40px 30px; text-align: center; }
        .error-panel h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: var(--danger); margin-bottom: 10px; }
        .error-panel p { color: var(--text-dim); margin-bottom: 20px; }
        .retry-btn { padding: 12px 24px; font-family: 'Bebas Neue', sans-serif; font-size: 18px; letter-spacing: 2px; background: var(--danger); border: none; border-radius: 8px; color: white; cursor: pointer; }
        .results-panel { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 30px; }
        .matchup-header { display: flex; align-items: center; justify-content: center; gap: 30px; margin-bottom: 30px; flex-wrap: wrap; }
        .matchup-header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; letter-spacing: 2px; text-align: center; }
        .vs { font-family: 'Bebas Neue', sans-serif; font-size: 18px; color: var(--text-dim); padding: 8px 16px; border: 1px solid var(--border); border-radius: 20px; }
        .win-probability-section, .outcomes-section, .categories-section { margin-bottom: 30px; }
        .win-probability-section h3, .outcomes-section h3, .categories-section h3, .swing-section h3 { font-family: 'Bebas Neue', sans-serif; font-size: 18px; letter-spacing: 2px; color: var(--text-dim); margin-bottom: 15px; }
        .probability-bar-container { padding: 20px; background: var(--bg-input); border-radius: 8px; }
        .probability-labels { display: flex; justify-content: space-between; margin-bottom: 10px; }
        .you-label { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: var(--you-color); }
        .opp-label { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: var(--opp-color); }
        .probability-bar { display: flex; height: 24px; border-radius: 12px; overflow: hidden; background: var(--bg-dark); }
        .you-bar { background: linear-gradient(90deg, var(--you-color), #00b368); transition: width 0.5s ease; }
        .opp-bar { background: linear-gradient(90deg, #c62e4a, var(--opp-color)); transition: width 0.5s ease; }
        .probability-legend { display: flex; justify-content: space-between; margin-top: 10px; font-size: 12px; }
        .you-legend { color: var(--you-color); }
        .opp-legend { color: var(--opp-color); }
        .projected-score { display: flex; align-items: center; justify-content: center; gap: 30px; margin-bottom: 30px; }
        .score-box { text-align: center; padding: 20px 40px; background: var(--bg-input); border-radius: 12px; border: 2px solid var(--you-color); }
        .score-box.opp { border-color: var(--opp-color); }
        .score-box .score { font-family: 'Bebas Neue', sans-serif; font-size: 64px; display: block; }
        .score-box .label { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: var(--text-dim); }
        .score-divider { font-family: 'Bebas Neue', sans-serif; font-size: 48px; color: var(--text-dim); }
        .outcomes-grid { display: flex; gap: 12px; flex-wrap: wrap; }
        .outcome-card { padding: 12px 20px; background: var(--bg-input); border: 1px solid var(--border); border-radius: 8px; text-align: center; }
        .outcome-score { font-family: 'Bebas Neue', sans-serif; font-size: 24px; display: block; color: var(--accent); }
        .outcome-pct { font-size: 12px; color: var(--text-dim); }
        .table-wrapper { overflow-x: auto; }
        .categories-table { width: 100%; border-collapse: collapse; min-width: 500px; }
        .categories-table th, .categories-table td { padding: 12px; text-align: left; border-bottom: 1px solid var(--border); }
        .categories-table th { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); font-weight: normal; }
        .categories-table .cat-name { font-weight: bold; }
        .swing-badge { margin-left: 8px; }
        .categories-table tr.swing-category { background: rgba(255, 107, 53, 0.05); }
        .mini-bar { width: 100%; height: 8px; background: var(--bg-dark); border-radius: 4px; overflow: hidden; }
        .mini-you { height: 100%; background: var(--text-dim); transition: width 0.3s; }
        .mini-you.winning { background: var(--you-color); }
        .pct { font-size: 14px; color: var(--text-dim); }
        .pct.winning { color: var(--you-color); font-weight: bold; }
        .projection { font-size: 13px; color: var(--text-dim); }
        .swing-section { padding: 20px; background: rgba(255, 107, 53, 0.05); border: 1px solid var(--accent); border-radius: 8px; margin-bottom: 30px; }
        .swing-section p { color: var(--text-dim); font-size: 13px; margin-bottom: 15px; }
        .swing-tags { display: flex; gap: 10px; flex-wrap: wrap; }
        .swing-tag { padding: 8px 16px; background: var(--accent); color: white; border-radius: 20px; font-size: 13px; font-weight: bold; }
        .refresh-btn { width: 100%; padding: 16px; font-family: 'Bebas Neue', sans-serif; font-size: 20px; letter-spacing: 2px; background: var(--bg-input); border: 1px solid var(--border); border-radius: 8px; color: var(--text); cursor: pointer; transition: all 0.2s; }
        .refresh-btn:hover { border-color: var(--accent); color: var(--accent); }
        footer { text-align: center; padding: 30px 0; color: var(--text-dim); font-size: 12px; }
        @media (max-width: 768px) {
          h1 { font-size: 28px; }
          .matchup-header { flex-direction: column; gap: 10px; }
          .matchup-header h2 { font-size: 20px; }
          .projected-score { gap: 15px; }
          .score-box { padding: 15px 25px; }
          .score-box .score { font-size: 42px; }
        }
      `}</style>
    </>
  );
}