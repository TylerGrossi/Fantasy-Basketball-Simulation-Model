import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';

// Configuration - Update PROXY_URL when you have your ngrok URL
const PROXY_URL = null; // Set to 'https://YOUR-NGROK-URL.ngrok.io/api/data' when ready
const CONFIG = { sim_count: 5000 };

const CATEGORY_VARIANCE = {
  FGM: 0.7, FGA: 0.7, FTM: 0.2, FTA: 0.2, '3PM': 0.7, '3PA': 0.7,
  REB: 0.4, AST: 0.4, STL: 0.8, BLK: 0.8, TO: 0.5, PTS: 0.7, DD: 0.7, TW: 0.7
};
const CATEGORIES = ['FGM', 'FGA', 'FG%', 'FT%', '3PM', '3PA', '3P%', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PTS', 'DD', 'TW'];
const NBA_TEAM_MAP = {
  ATL: 'atl', BOS: 'bos', BKN: 'bkn', CHA: 'cha', CHI: 'chi', CLE: 'cle', DAL: 'dal', DEN: 'den',
  DET: 'det', GSW: 'gs', HOU: 'hou', IND: 'ind', LAC: 'lac', LAL: 'la', MEM: 'mem', MIA: 'mia',
  MIL: 'mil', MIN: 'min', NOP: 'no', NYK: 'ny', OKC: 'okc', ORL: 'orl', PHI: 'phi', PHX: 'pho',
  POR: 'por', SAC: 'sac', SAS: 'sa', TOR: 'tor', UTA: 'utah', WAS: 'wsh'
};

// Demo data for when proxy isn't available
const DEMO_DATA = {
  leagueName: 'Demo League', week: 12,
  yourTeam: {
    name: 'Your Team',
    players: [
      { name: 'Shai Gilgeous-Alexander', team: 'OKC', FGM: 10.5, FGA: 20.1, FTM: 6.2, FTA: 7.1, '3PM': 1.8, '3PA': 4.5, REB: 5.5, AST: 6.2, STL: 2.0, BLK: 0.9, TO: 2.8, PTS: 31.2, DD: 0.3, TW: 0.1 },
      { name: 'Anthony Davis', team: 'LAL', FGM: 9.8, FGA: 18.2, FTM: 5.5, FTA: 7.2, '3PM': 1.1, '3PA': 3.2, REB: 11.8, AST: 3.5, STL: 1.2, BLK: 2.1, TO: 2.1, PTS: 26.3, DD: 0.4, TW: 0.1 },
      { name: 'Tyrese Haliburton', team: 'IND', FGM: 7.2, FGA: 15.8, FTM: 2.8, FTA: 3.2, '3PM': 3.1, '3PA': 8.2, REB: 3.8, AST: 10.8, STL: 1.4, BLK: 0.5, TO: 2.5, PTS: 20.5, DD: 0.2, TW: 0.05 },
      { name: 'Scottie Barnes', team: 'TOR', FGM: 7.5, FGA: 15.5, FTM: 4.2, FTA: 5.8, '3PM': 1.5, '3PA': 4.2, REB: 8.2, AST: 6.5, STL: 1.3, BLK: 1.1, TO: 2.8, PTS: 20.8, DD: 0.25, TW: 0.05 },
      { name: 'Domantas Sabonis', team: 'SAC', FGM: 8.2, FGA: 13.5, FTM: 3.5, FTA: 4.8, '3PM': 0.8, '3PA': 2.5, REB: 14.2, AST: 8.5, STL: 0.8, BLK: 0.5, TO: 3.2, PTS: 20.8, DD: 0.6, TW: 0.15 },
    ],
    currentTotals: { FGM: 85, FGA: 175, FTM: 42, FTA: 52, '3PM': 28, '3PA': 75, REB: 95, AST: 65, STL: 18, BLK: 12, TO: 32, PTS: 245, DD: 3, TW: 1 }
  },
  opponent: {
    name: 'Opponent',
    players: [
      { name: 'Luka Doncic', team: 'DAL', FGM: 10.2, FGA: 22.5, FTM: 6.8, FTA: 8.5, '3PM': 3.5, '3PA': 9.8, REB: 9.2, AST: 9.8, STL: 1.5, BLK: 0.5, TO: 4.2, PTS: 33.5, DD: 0.5, TW: 0.2 },
      { name: 'Jayson Tatum', team: 'BOS', FGM: 9.5, FGA: 20.8, FTM: 5.2, FTA: 6.5, '3PM': 3.2, '3PA': 9.2, REB: 8.5, AST: 4.8, STL: 1.1, BLK: 0.7, TO: 2.8, PTS: 27.5, DD: 0.3, TW: 0.1 },
      { name: 'Nikola Jokic', team: 'DEN', FGM: 10.8, FGA: 18.2, FTM: 4.2, FTA: 5.2, '3PM': 1.2, '3PA': 3.8, REB: 12.5, AST: 9.2, STL: 1.3, BLK: 0.8, TO: 3.5, PTS: 27.2, DD: 0.55, TW: 0.25 },
      { name: "De'Aaron Fox", team: 'SAC', FGM: 9.2, FGA: 19.5, FTM: 4.8, FTA: 5.8, '3PM': 2.2, '3PA': 6.5, REB: 4.2, AST: 6.2, STL: 1.5, BLK: 0.4, TO: 2.8, PTS: 26.5, DD: 0.15, TW: 0.05 },
      { name: 'Evan Mobley', team: 'CLE', FGM: 7.5, FGA: 14.2, FTM: 2.8, FTA: 3.8, '3PM': 1.2, '3PA': 3.5, REB: 9.5, AST: 3.2, STL: 0.8, BLK: 1.8, TO: 1.8, PTS: 19.2, DD: 0.2, TW: 0.05 },
    ],
    currentTotals: { FGM: 78, FGA: 168, FTM: 38, FTA: 48, '3PM': 32, '3PA': 82, REB: 88, AST: 58, STL: 15, BLK: 10, TO: 28, PTS: 228, DD: 2, TW: 0 }
  }
};

// Simulation functions
function gaussianRandom(mean, stdDev) {
  let u1, u2;
  do { u1 = Math.random(); u2 = Math.random(); } while (u1 === 0);
  return mean + Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * stdDev;
}

async function fetchSchedule(team) {
  if (!team || !NBA_TEAM_MAP[team.toUpperCase()]) return [];
  try {
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${NBA_TEAM_MAP[team.toUpperCase()]}/schedule`);
    return r.ok ? (await r.json()).events?.map(e => new Date(e.date)) || [] : [];
  } catch { return []; }
}

function gamesLeftThisWeek(schedule) {
  const now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfWeek = new Date(today); endOfWeek.setDate(today.getDate() + (7 - today.getDay()) % 7 || 7);
  return schedule.filter(d => { const g = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return g >= today && g <= endOfWeek; }).length;
}

function simulateTeam(players, simCount) {
  const results = {}, stats = [...Object.keys(CATEGORY_VARIANCE), 'FG%', 'FT%', '3P%'];
  stats.forEach(s => results[s] = []);
  for (let i = 0; i < simCount; i++) {
    const totals = {}; Object.keys(CATEGORY_VARIANCE).forEach(s => totals[s] = 0);
    players.forEach(p => {
      for (let g = 0; g < (p.gamesLeft || 0); g++) {
        Object.entries(CATEGORY_VARIANCE).forEach(([s, v]) => { totals[s] += Math.max(0, gaussianRandom(p[s] || 0, (p[s] || 0) * v)); });
      }
    });
    totals['FG%'] = totals.FGA > 0 ? totals.FGM / totals.FGA : 0;
    totals['FT%'] = totals.FTA > 0 ? totals.FTM / totals.FTA : 0;
    totals['3P%'] = totals['3PA'] > 0 ? totals['3PM'] / totals['3PA'] : 0;
    stats.forEach(s => results[s].push(totals[s] || 0));
  }
  return results;
}

function addCurrent(current, sim) {
  const adj = {};
  Object.keys(sim).forEach(s => { adj[s] = sim[s].map(v => ['FG%', 'FT%', '3P%'].includes(s) ? 0 : v + (current[s] || 0)); });
  for (let i = 0; i < sim.FGM.length; i++) {
    adj['FG%'][i] = adj.FGA[i] > 0 ? adj.FGM[i] / adj.FGA[i] : 0;
    adj['FT%'][i] = adj.FTA[i] > 0 ? adj.FTM[i] / adj.FTA[i] : 0;
    adj['3P%'][i] = adj['3PA'][i] > 0 ? adj['3PM'][i] / adj['3PA'][i] : 0;
  }
  return adj;
}

function compare(sim1, sim2) {
  const n = sim1.FGM.length, res = { you: 0, opp: 0, tie: 0 }, catRes = {}, outcomes = {};
  CATEGORIES.forEach(c => catRes[c] = { you: 0, opp: 0, tie: 0 });
  for (let i = 0; i < n; i++) {
    let yW = 0, oW = 0;
    CATEGORIES.forEach(c => {
      const y = sim1[c][i], o = sim2[c][i];
      if (c === 'TO') { if (y < o) { yW++; catRes[c].you++; } else if (y > o) { oW++; catRes[c].opp++; } else catRes[c].tie++; }
      else { if (y > o) { yW++; catRes[c].you++; } else if (y < o) { oW++; catRes[c].opp++; } else catRes[c].tie++; }
    });
    outcomes[`${yW}-${oW}`] = (outcomes[`${yW}-${oW}`] || 0) + 1;
    if (yW > oW) res.you++; else if (oW > yW) res.opp++; else res.tie++;
  }
  return { res, catRes, outcomes };
}

function calcStats(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return { mean: arr.reduce((a, b) => a + b, 0) / arr.length, p10: s[Math.floor(arr.length * 0.1)], p90: s[Math.floor(arr.length * 0.9)] };
}

export default function Home() {
  const [status, setStatus] = useState('loading');
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState(null);
  const [info, setInfo] = useState(null);
  const [isDemo, setIsDemo] = useState(false);

  const run = useCallback(async () => {
    setStatus('loading');
    let data = DEMO_DATA; setIsDemo(true);
    
    if (PROXY_URL) {
      setProgress('Fetching ESPN data...');
      try { const r = await fetch(PROXY_URL); if (r.ok) { const d = await r.json(); if (d.success) { data = d; setIsDemo(false); }}} catch {}
    }
    
    setProgress('Loading schedules...');
    const teams = [...new Set([...data.yourTeam.players, ...data.opponent.players].map(p => p.team).filter(Boolean))];
    const scheds = {}; await Promise.all(teams.map(async t => { scheds[t] = await fetchSchedule(t); }));
    
    const yP = data.yourTeam.players.map(p => ({ ...p, gamesLeft: gamesLeftThisWeek(scheds[p.team] || []) })).filter(p => p.gamesLeft > 0);
    const oP = data.opponent.players.map(p => ({ ...p, gamesLeft: gamesLeftThisWeek(scheds[p.team] || []) })).filter(p => p.gamesLeft > 0);
    
    setProgress(`Running ${CONFIG.sim_count.toLocaleString()} simulations...`);
    await new Promise(r => setTimeout(r, 50));
    
    const ySim = addCurrent(data.yourTeam.currentTotals, simulateTeam(yP, CONFIG.sim_count));
    const oSim = addCurrent(data.opponent.currentTotals, simulateTeam(oP, CONFIG.sim_count));
    const { res, catRes, outcomes } = compare(ySim, oSim);
    
    const catStats = {}; let expCats = 0, projY = 0, projO = 0;
    CATEGORIES.forEach(c => {
      const yS = calcStats(ySim[c]), oS = calcStats(oSim[c]), tot = catRes[c].you + catRes[c].opp + catRes[c].tie;
      const yPct = catRes[c].you / tot, oPct = catRes[c].opp / tot;
      catStats[c] = { yPct, oPct, yProj: yS.mean, oProj: oS.mean, yCI: [yS.p10, yS.p90], oCI: [oS.p10, oS.p90], swing: Math.abs(yPct - oPct) <= 0.15 };
      expCats += yPct;
      if (c === 'TO') { if (yS.mean < oS.mean) projY++; else projO++; } else { if (yS.mean > oS.mean) projY++; else projO++; }
    });
    
    const tot = res.you + res.opp + res.tie;
    const topOut = Object.entries(outcomes).sort((a, b) => b[1] - a[1]).slice(0, 5);
    
    setResults({
      winPct: (res.you / tot * 100).toFixed(1), losePct: (res.opp / tot * 100).toFixed(1), tiePct: (res.tie / tot * 100).toFixed(1),
      score: `${projY}-${projO}`, expCats: expCats.toFixed(2), catStats,
      topOut: topOut.map(([o, c]) => ({ o, pct: (c / tot * 100).toFixed(1) })),
      swing: CATEGORIES.filter(c => catStats[c].swing), yP, oP, tot
    });
    setInfo({ yTeam: data.yourTeam.name, oTeam: data.opponent.name, week: data.week, league: data.leagueName });
    setStatus('done');
  }, []);

  useEffect(() => { run(); }, [run]);

  const fmt = (n, d = 1) => typeof n === 'number' ? n.toFixed(d) : '-';
  const fmtPct = n => typeof n === 'number' ? (n * 100).toFixed(1) + '%' : '-';

  return (
    <>
      <Head><title>Fantasy Basketball Simulator</title></Head>
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white p-4 md:p-8">
        <div className="max-w-5xl mx-auto">
          <header className="text-center mb-10">
            <h1 className="text-4xl md:text-5xl font-black bg-gradient-to-r from-orange-400 to-amber-300 bg-clip-text text-transparent mb-2">
              🏀 Fantasy Basketball Simulator
            </h1>
            <p className="text-slate-400">Monte Carlo Win Probability Analysis</p>
          </header>

          {status === 'loading' && (
            <div className="text-center py-20">
              <div className="inline-block w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-lg text-slate-300">{progress}</p>
            </div>
          )}

          {status === 'done' && results && (
            <div className="space-y-6">
              {isDemo && (
                <div className="bg-amber-900/30 border border-amber-500/50 rounded-xl p-4 text-center text-amber-200">
                  📋 Demo Mode - Set PROXY_URL to use live ESPN data
                </div>
              )}

              {info && (
                <div className="text-center mb-6">
                  <p className="text-slate-500 text-sm">{info.league} • Week {info.week}</p>
                  <p className="text-xl font-bold"><span className="text-orange-400">{info.yTeam}</span> vs <span className="text-blue-400">{info.oTeam}</span></p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-emerald-900/30 border border-emerald-500/40 rounded-xl p-5 text-center">
                  <p className="text-emerald-400 text-sm uppercase tracking-wide mb-1">Win Probability</p>
                  <p className="text-4xl font-black">{results.winPct}%</p>
                  <p className="text-sm text-slate-400 mt-1">Lose: {results.losePct}% • Tie: {results.tiePct}%</p>
                </div>
                <div className="bg-orange-900/30 border border-orange-500/40 rounded-xl p-5 text-center">
                  <p className="text-orange-400 text-sm uppercase tracking-wide mb-1">Projected Score</p>
                  <p className="text-4xl font-black">{results.score}</p>
                  <p className="text-sm text-slate-400 mt-1">Expected: {results.expCats} cats</p>
                </div>
                <div className="bg-purple-900/30 border border-purple-500/40 rounded-xl p-5 text-center">
                  <p className="text-purple-400 text-sm uppercase tracking-wide mb-1">Top Outcomes</p>
                  {results.topOut.slice(0, 3).map((o, i) => (
                    <p key={i} className={`font-mono ${i === 0 ? 'text-lg font-bold' : 'text-sm text-slate-400'}`}>{o.o}: {o.pct}%</p>
                  ))}
                </div>
              </div>

              {results.swing.length > 0 && (
                <div className="bg-amber-900/20 border border-amber-500/30 rounded-xl p-4">
                  <p className="text-amber-400 text-sm font-semibold mb-2">🎯 Swing Categories</p>
                  <div className="flex flex-wrap gap-2">
                    {results.swing.map(c => <span key={c} className="px-3 py-1 bg-amber-500/20 border border-amber-500/40 rounded-lg text-amber-300 font-bold text-sm">{c}</span>)}
                  </div>
                </div>
              )}

              <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
                <div className="p-4 border-b border-slate-700/50 font-bold">📊 Category Breakdown</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-900/50 text-slate-400 text-xs uppercase">
                      <tr>
                        <th className="text-left p-3">Cat</th>
                        <th className="p-3">Win %</th>
                        <th className="p-3">Your Proj</th>
                        <th className="p-3">Opp Proj</th>
                      </tr>
                    </thead>
                    <tbody>
                      {CATEGORIES.map(c => {
                        const s = results.catStats[c], isPct = c.includes('%');
                        return (
                          <tr key={c} className={`border-b border-slate-700/30 ${s.swing ? 'bg-amber-500/5' : ''}`}>
                            <td className="p-3 font-bold">
                              <span className={s.yPct > 0.5 ? 'text-emerald-400' : 'text-red-400'}>{c}</span>
                              {s.swing && <span className="text-amber-400 ml-1">⭐</span>}
                            </td>
                            <td className="p-3 text-center">
                              <span className={`font-mono font-bold ${s.yPct > 0.5 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtPct(s.yPct)}</span>
                            </td>
                            <td className="p-3 text-center font-mono">{fmt(s.yProj, isPct ? 3 : 1)}</td>
                            <td className="p-3 text-center font-mono text-slate-400">{fmt(s.oProj, isPct ? 3 : 1)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="text-center">
                <p className="text-slate-500 text-sm mb-3">Based on {results.tot.toLocaleString()} simulations</p>
                <button onClick={run} className="px-6 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors">🔄 Re-run</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}