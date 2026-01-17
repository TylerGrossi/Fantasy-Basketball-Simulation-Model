import { useState, useEffect } from 'react';
import Head from 'next/head';

// YOUR CREDENTIALS - HARDCODED
const MY_CONFIG = {
  league_id: "267469544",
  team_id: "6",
  espn_s2: "AEBSyUk%2FmdLqOc%2BSzyDjGNUS5ikQCnK8FvvsGLMAu7mVyKgLRXAa6q6s9eaLrXj3rPzfOoB9H%2BIukXFCBnnSjLEjnSmOIiRzuXP8bEZGpYrVN4FJ5OgT3FuHfRmKV0SrwKJRbyjW0Irlz%2BTyk2QCsg5eTa7GtgXJ8sxXaF9MVhjc9ielluRUU%2FbGcCrpIAOhAzkbklw4Gs2UsEBHdWXzgMO6TUWJjzFN5afsaby20y9ONU5rz6r1J27VWoC5YgUiR3NpH%2F4hpyMf0xXvJUGv9fSI5lt6%2BskojM22lBfr2DwJgA%3D%3D5",
  swid: "{D7E89394-85F1-4264-831E-481F3B4157D4}",
  sim_count: 10000,
};

export default function Home() {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Auto-run simulation on page load
  useEffect(() => {
    runSimulation();
  }, []);

  const runSimulation = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(MY_CONFIG),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Simulation failed');
      }

      setResults(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

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
        <td className="cat-name">
          {cat}
          {isSwing && <span className="swing-badge">⭐</span>}
        </td>
        <td className="cat-bar">
          <div className="mini-bar">
            <div 
              className={`mini-you ${youWinning ? 'winning' : ''}`}
              style={{ width: `${youPct}%` }}
            />
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
              <p>Analyzing {MY_CONFIG.sim_count.toLocaleString()} scenarios</p>
            </div>
          )}

          {error && (
            <div className="error-panel">
              <h2>⚠️ Error</h2>
              <p>{error}</p>
              <button onClick={runSimulation} className="retry-btn">
                🔄 Retry
              </button>
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
                <WinProbabilityBar 
                  you={results.matchup_results.you} 
                  opponent={results.matchup_results.opponent} 
                />
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
                        <CategoryRow 
                          key={cat.name}
                          cat={cat.name}
                          data={cat.outcomes}
                          projections={cat.projections}
                        />
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

              <button onClick={runSimulation} className="refresh-btn">
                🔄 Refresh Simulation
              </button>
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
          --bg-dark: #0a0a0f;
          --bg-card: #12121a;
          --bg-input: #1a1a25;
          --border: #2a2a3a;
          --text: #e8e8f0;
          --text-dim: #8888a0;
          --accent: #ff6b35;
          --accent-glow: rgba(255, 107, 53, 0.3);
          --success: #00d97e;
          --danger: #e63757;
          --you-color: #00d97e;
          --opp-color: #e63757;
        }
        body {
          font-family: 'Space Mono', monospace;
          background: var(--bg-dark);
          color: var(--text);
          min-height: 100vh;
          background-image: 
            radial-gradient(ellipse at 20% 0%, rgba(255, 107, 53, 0.08) 0%, transparent 50%),
            radial-gradient(ellipse at 80% 100%, rgba(0, 217, 126, 0.05) 0%, transparent 50%);
        }
        .app { max-width: 1000px; margin: 0 auto; padding: 20px; min-height: 100vh; }
        
        header { text-align: center; padding: 30px 0 20px; }
        .logo { display: flex; align-items: center; justify-content: center; gap: 15px; }
        .ball { font-size: 40px; }
        h1 { font-family: 'Bebas Neue', sans-serif; font-size: 36px; letter-spacing: 3px; }
        h1 .accent { color: var(--accent); }

        /* Loading State */
        .loading-panel {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 60px 30px;
          text-align: center;
        }
        .loading-panel h2 {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 28px;
          letter-spacing: 2px;
          margin: 20px 0 10px;
        }
        .loading-panel p {
          color: var(--text-dim);
          font-size: 14px;
        }
        .spinner-large {
          width: 50px;
          height: 50px;
          border: 3px solid var(--border);
          border-top-color: var(--accent);
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Error State */
        .error-panel {
          background: var(--bg-card);
          border: 1px solid var(--danger);
          border-radius: 12px;
          padding: 40px 30px;
          text-align: center;
        }
        .error-panel h2 {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 28px;
          color: var(--danger);
          margin-bottom: 10px;
        }
        .error-panel p {
          color: var(--text-dim);
          margin-bottom: 20px;
        }
        .retry-btn {
          padding: 12px 24px;
          font-family: 'Bebas Neue', sans-serif;
          font-size: 18px;
          letter-spacing: 2px;
          background: var(--danger);
          border: none;
          border-radius: 8px;
          color: white;
          cursor: pointer;
        }

        /* Results Panel */
        .results-panel {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 30px;
        }
        .matchup-header {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 30px;
          margin-bottom: 30px;
          flex-wrap: wrap;
        }
        .matchup-header h2 {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 28px;
          letter-spacing: 2px;
          text-align: center;
        }
        .vs {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 18px;
          color: var(--text-dim);
          padding: 8px 16px;
          border: 1px solid var(--border);
          border-radius: 20px;
        }

        .win-probability-section { margin-bottom: 30px; }
        .win-probability-section h3,
        .outcomes-section h3,
        .categories-section h3,
        .swing-section h3 {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 18px;
          letter-spacing: 2px;
          color: var(--text-dim);
          margin-bottom: 15px;
        }

        .probability-bar-container {
          padding: 20px;
          background: var(--bg-input);
          border-radius: 8px;
        }
        .probability-labels {
          display: flex;
          justify-content: space-between;
          margin-bottom: 10px;
        }
        .you-label {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 36px;
          color: var(--you-color);
        }
        .opp-label {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 36px;
          color: var(--opp-color);
        }
        .probability-bar {
          display: flex;
          height: 24px;
          border-radius: 12px;
          overflow: hidden;
          background: var(--bg-dark);
        }
        .you-bar {
          background: linear-gradient(90deg, var(--you-color), #00b368);
          transition: width 0.5s ease;
        }
        .opp-bar {
          background: linear-gradient(90deg, #c62e4a, var(--opp-color));
          transition: width 0.5s ease;
        }
        .probability-legend {
          display: flex;
          justify-content: space-between;
          margin-top: 10px;
          font-size: 12px;
        }
        .you-legend { color: var(--you-color); }
        .opp-legend { color: var(--opp-color); }

        .projected-score {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 30px;
          margin-bottom: 30px;
        }
        .score-box {
          text-align: center;
          padding: 20px 40px;
          background: var(--bg-input);
          border-radius: 12px;
          border: 2px solid var(--you-color);
        }
        .score-box.opp { border-color: var(--opp-color); }
        .score-box .score {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 64px;
          display: block;
        }
        .score-box .label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 2px;
          color: var(--text-dim);
        }
        .score-divider {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 48px;
          color: var(--text-dim);
        }

        .outcomes-section { margin-bottom: 30px; }
        .outcomes-grid {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }
        .outcome-card {
          padding: 12px 20px;
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: 8px;
          text-align: center;
        }
        .outcome-score {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 24px;
          display: block;
          color: var(--accent);
        }
        .outcome-pct {
          font-size: 12px;
          color: var(--text-dim);
        }

        .categories-section { margin-bottom: 30px; }
        .table-wrapper { overflow-x: auto; }
        .categories-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 500px;
        }
        .categories-table th,
        .categories-table td {
          padding: 12px;
          text-align: left;
          border-bottom: 1px solid var(--border);
        }
        .categories-table th {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: var(--text-dim);
          font-weight: normal;
        }
        .categories-table .cat-name { font-weight: bold; }
        .swing-badge { margin-left: 8px; }
        .categories-table tr.swing-category {
          background: rgba(255, 107, 53, 0.05);
        }
        .mini-bar {
          width: 100%;
          height: 8px;
          background: var(--bg-dark);
          border-radius: 4px;
          overflow: hidden;
        }
        .mini-you {
          height: 100%;
          background: var(--text-dim);
          transition: width 0.3s;
        }
        .mini-you.winning { background: var(--you-color); }
        .pct { font-size: 14px; color: var(--text-dim); }
        .pct.winning { color: var(--you-color); font-weight: bold; }
        .projection { font-size: 13px; color: var(--text-dim); }

        .swing-section {
          padding: 20px;
          background: rgba(255, 107, 53, 0.05);
          border: 1px solid var(--accent);
          border-radius: 8px;
          margin-bottom: 30px;
        }
        .swing-section p {
          color: var(--text-dim);
          font-size: 13px;
          margin-bottom: 15px;
        }
        .swing-tags {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .swing-tag {
          padding: 8px 16px;
          background: var(--accent);
          color: white;
          border-radius: 20px;
          font-size: 13px;
          font-weight: bold;
        }

        .refresh-btn {
          width: 100%;
          padding: 16px;
          font-family: 'Bebas Neue', sans-serif;
          font-size: 20px;
          letter-spacing: 2px;
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text);
          cursor: pointer;
          transition: all 0.2s;
        }
        .refresh-btn:hover {
          border-color: var(--accent);
          color: var(--accent);
        }

        footer {
          text-align: center;
          padding: 30px 0;
          color: var(--text-dim);
          font-size: 12px;
        }

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