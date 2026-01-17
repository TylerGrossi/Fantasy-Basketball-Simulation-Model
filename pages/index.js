import { useState, useEffect } from 'react';
import Head from 'next/head';

export default function Home() {
  const [config, setConfig] = useState({
    league_id: '',
    espn_s2: '',
    swid: '',
    team_id: '',
    sim_count: 10000,
    streamers_to_test: 20,
  });
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState('');
  const [activeTab, setActiveTab] = useState('simulate');
  const [credentialsSaved, setCredentialsSaved] = useState(false);

  // Load saved credentials on mount
  useEffect(() => {
    const saved = localStorage.getItem('fantasyBasketballCredentials');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setConfig(prev => ({ ...prev, ...parsed }));
        setCredentialsSaved(true);
      } catch (e) {
        console.error('Failed to load saved credentials');
      }
    }
  }, []);

  // Save credentials to localStorage
  const saveCredentials = () => {
    const toSave = {
      league_id: config.league_id,
      espn_s2: config.espn_s2,
      swid: config.swid,
      team_id: config.team_id,
    };
    localStorage.setItem('fantasyBasketballCredentials', JSON.stringify(toSave));
    setCredentialsSaved(true);
  };

  // Clear saved credentials
  const clearCredentials = () => {
    localStorage.removeItem('fantasyBasketballCredentials');
    setConfig({
      league_id: '',
      espn_s2: '',
      swid: '',
      team_id: '',
      sim_count: 10000,
      streamers_to_test: 20,
    });
    setCredentialsSaved(false);
  };

  // Decode URL-encoded string if needed
  const decodeIfNeeded = (str) => {
    if (!str) return str;
    // Check if it looks URL-encoded (contains %XX patterns)
    if (str.includes('%')) {
      try {
        return decodeURIComponent(str);
      } catch (e) {
        return str;
      }
    }
    return str;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResults(null);
    setProgress('Connecting to ESPN...');

    try {
      // Decode the espn_s2 cookie if it's URL-encoded
      const decodedConfig = {
        ...config,
        espn_s2: decodeIfNeeded(config.espn_s2),
      };

      const response = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(decodedConfig),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Simulation failed');
      }

      setResults(data);
      setActiveTab('results');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setProgress('');
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

  const hasCredentials = config.league_id && config.espn_s2 && config.swid && config.team_id;

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
          <p className="tagline">Monte Carlo Matchup Projections</p>
        </header>

        <nav className="tabs">
          <button 
            className={activeTab === 'simulate' ? 'active' : ''} 
            onClick={() => setActiveTab('simulate')}
          >
            SIMULATE
          </button>
          <button 
            className={activeTab === 'results' ? 'active' : ''} 
            onClick={() => setActiveTab('results')}
            disabled={!results}
          >
            RESULTS
          </button>
          <button 
            className={activeTab === 'streamers' ? 'active' : ''} 
            onClick={() => setActiveTab('streamers')}
            disabled={!results?.streamers?.length}
          >
            STREAMERS
          </button>
          <button 
            className={activeTab === 'settings' ? 'active' : ''} 
            onClick={() => setActiveTab('settings')}
          >
            ⚙️ SETTINGS
          </button>
        </nav>

        <main>
          {activeTab === 'simulate' && (
            <div className="simulate-panel">
              {hasCredentials ? (
                <div className="quick-run">
                  <div className="credentials-summary">
                    <h2>Ready to Simulate</h2>
                    <div className="cred-pills">
                      <span className="pill">League: {config.league_id}</span>
                      <span className="pill">Team: {config.team_id}</span>
                      <span className="pill check">✓ Credentials Loaded</span>
                    </div>
                  </div>

                  <div className="sim-settings">
                    <div className="input-row">
                      <div className="input-group">
                        <label>Simulations</label>
                        <input
                          type="number"
                          value={config.sim_count}
                          onChange={(e) => setConfig({ ...config, sim_count: parseInt(e.target.value) || 10000 })}
                          min={1000}
                          max={50000}
                          step={1000}
                        />
                      </div>
                      <div className="input-group">
                        <label>Streamers to Test</label>
                        <input
                          type="number"
                          value={config.streamers_to_test}
                          onChange={(e) => setConfig({ ...config, streamers_to_test: parseInt(e.target.value) || 20 })}
                          min={5}
                          max={50}
                        />
                      </div>
                    </div>
                  </div>

                  <button onClick={handleSubmit} className="run-btn" disabled={loading}>
                    {loading ? (
                      <>
                        <span className="spinner"></span>
                        {progress || 'Running Simulation...'}
                      </>
                    ) : (
                      '🎲 RUN SIMULATION'
                    )}
                  </button>

                  {error && (
                    <div className="error-box">
                      <strong>Error:</strong> {error}
                      <p className="error-help">
                        If you're getting a 403 error, your ESPN cookies may have expired. 
                        Go to Settings to update them.
                      </p>
                    </div>
                  )}

                  <button 
                    className="edit-creds-btn"
                    onClick={() => setActiveTab('settings')}
                  >
                    Edit Credentials
                  </button>
                </div>
              ) : (
                <div className="no-credentials">
                  <h2>Welcome! 👋</h2>
                  <p>Set up your ESPN credentials to get started.</p>
                  <button 
                    className="setup-btn"
                    onClick={() => setActiveTab('settings')}
                  >
                    ⚙️ Set Up Credentials
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'settings' && (
            <form onSubmit={(e) => { e.preventDefault(); saveCredentials(); setActiveTab('simulate'); }} className="config-form">
              <div className="form-header">
                <h2>ESPN League Credentials</h2>
                {credentialsSaved && (
                  <span className="saved-badge">✓ Saved to this device</span>
                )}
              </div>

              <div className="form-section">
                <div className="input-group">
                  <label>League ID</label>
                  <input
                    type="text"
                    value={config.league_id}
                    onChange={(e) => setConfig({ ...config, league_id: e.target.value })}
                    placeholder="e.g., 267469544"
                    required
                  />
                  <span className="input-hint">Found in your league URL: leagueId=XXXXXX</span>
                </div>
                <div className="input-group">
                  <label>Team ID</label>
                  <input
                    type="text"
                    value={config.team_id}
                    onChange={(e) => setConfig({ ...config, team_id: e.target.value })}
                    placeholder="Your fantasy team ID (1-12)"
                    required
                  />
                  <span className="input-hint">Found in URL when viewing your team: teamId=X</span>
                </div>
                <div className="input-group">
                  <label>ESPN_S2 Cookie</label>
                  <textarea
                    value={config.espn_s2}
                    onChange={(e) => setConfig({ ...config, espn_s2: e.target.value })}
                    placeholder="Your espn_s2 cookie value (will be auto-decoded if URL-encoded)"
                    rows={3}
                    required
                  />
                  <span className="input-hint">Copy directly from browser - URL encoding will be handled automatically</span>
                </div>
                <div className="input-group">
                  <label>SWID Cookie</label>
                  <input
                    type="text"
                    value={config.swid}
                    onChange={(e) => setConfig({ ...config, swid: e.target.value })}
                    placeholder="{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}"
                    required
                  />
                </div>
              </div>

              <div className="button-row">
                <button type="submit" className="save-btn">
                  💾 Save & Continue
                </button>
                {credentialsSaved && (
                  <button type="button" className="clear-btn" onClick={clearCredentials}>
                    🗑️ Clear Saved Data
                  </button>
                )}
              </div>

              <div className="help-section">
                <h3>How to find your ESPN credentials:</h3>
                <ol>
                  <li>Log in to <a href="https://fantasy.espn.com/basketball" target="_blank" rel="noopener noreferrer">ESPN Fantasy Basketball</a></li>
                  <li>Open browser DevTools: <kbd>F12</kbd> or <kbd>Ctrl+Shift+I</kbd> (Windows) / <kbd>Cmd+Option+I</kbd> (Mac)</li>
                  <li>Go to <strong>Application</strong> tab → <strong>Cookies</strong> → <strong>espn.com</strong></li>
                  <li>Find and copy <code>espn_s2</code> and <code>SWID</code> values</li>
                  <li>Your League ID is in the URL after <code>leagueId=</code></li>
                </ol>
                <p className="privacy-note">
                  🔒 Your credentials are stored only on this device and never sent to any server except ESPN's API.
                </p>
              </div>
            </form>
          )}

          {activeTab === 'results' && results && (
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

              <button onClick={() => setActiveTab('simulate')} className="run-again-btn">
                🔄 Run Again
              </button>
            </div>
          )}

          {activeTab === 'streamers' && results?.streamers && (
            <div className="streamers-panel">
              <h2>Streamer Impact Analysis</h2>
              {results.streamers.length > 0 ? (
                <>
                  <p className="baseline-info">
                    Baseline: <strong>{results.baseline_cats.toFixed(2)}</strong> expected categories
                  </p>

                  <div className="table-wrapper">
                    <table className="streamers-table">
                      <thead>
                        <tr>
                          <th>Player</th>
                          <th>Games</th>
                          <th>Δ Cats</th>
                          <th>Exp Cats</th>
                          <th>Win %</th>
                          <th>Category Impacts</th>
                          <th>Risks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.streamers.map((s, i) => (
                          <tr key={i} className={s.delta_cats > 0.1 ? 'positive' : s.delta_cats < -0.1 ? 'negative' : ''}>
                            <td className="player-name">{s.player}</td>
                            <td className="games">{s.games}</td>
                            <td className={`delta ${s.delta_cats > 0 ? 'positive' : s.delta_cats < 0 ? 'negative' : ''}`}>
                              {s.delta_cats > 0 ? '+' : ''}{s.delta_cats.toFixed(2)}
                            </td>
                            <td>{s.exp_cats.toFixed(2)}</td>
                            <td>{s.win_pct.toFixed(1)}%</td>
                            <td className="impacts">{s.cat_impacts || '—'}</td>
                            <td className="risks">{s.risks || ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="no-streamers">
                  <p>Streamer analysis is not available yet.</p>
                  <p className="hint">This feature requires additional API calls and may be added in a future update.</p>
                </div>
              )}
            </div>
          )}
        </main>

        <footer>
          <p>Monte Carlo simulation • Data from ESPN Fantasy API</p>
        </footer>
      </div>

      <style jsx global>{`
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

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

        .app {
          max-width: 1000px;
          margin: 0 auto;
          padding: 20px;
          min-height: 100vh;
        }

        header {
          text-align: center;
          padding: 40px 0 30px;
        }

        .logo {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 15px;
        }

        .ball {
          font-size: 48px;
          animation: bounce 2s ease-in-out infinite;
        }

        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }

        h1 {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 48px;
          letter-spacing: 4px;
          color: var(--text);
        }

        h1 .accent {
          color: var(--accent);
        }

        .tagline {
          color: var(--text-dim);
          font-size: 12px;
          letter-spacing: 3px;
          text-transform: uppercase;
          margin-top: 8px;
        }

        .tabs {
          display: flex;
          gap: 4px;
          margin-bottom: 30px;
          border-bottom: 1px solid var(--border);
          padding-bottom: 4px;
          flex-wrap: wrap;
        }

        .tabs button {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 18px;
          letter-spacing: 2px;
          padding: 12px 24px;
          background: transparent;
          border: none;
          color: var(--text-dim);
          cursor: pointer;
          position: relative;
          transition: color 0.2s;
        }

        .tabs button:hover:not(:disabled) {
          color: var(--text);
        }

        .tabs button.active {
          color: var(--accent);
        }

        .tabs button.active::after {
          content: '';
          position: absolute;
          bottom: -5px;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--accent);
        }

        .tabs button:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }

        /* Simulate Panel */
        .simulate-panel {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 30px;
        }

        .quick-run {
          text-align: center;
        }

        .credentials-summary h2 {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 32px;
          letter-spacing: 2px;
          margin-bottom: 15px;
        }

        .cred-pills {
          display: flex;
          justify-content: center;
          gap: 10px;
          flex-wrap: wrap;
          margin-bottom: 30px;
        }

        .pill {
          padding: 8px 16px;
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: 20px;
          font-size: 13px;
        }

        .pill.check {
          background: rgba(0, 217, 126, 0.1);
          border-color: var(--success);
          color: var(--success);
        }

        .sim-settings {
          max-width: 400px;
          margin: 0 auto 30px;
        }

        .no-credentials {
          text-align: center;
          padding: 40px;
        }

        .no-credentials h2 {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 32px;
          margin-bottom: 10px;
        }

        .no-credentials p {
          color: var(--text-dim);
          margin-bottom: 30px;
        }

        .setup-btn {
          padding: 16px 32px;
          font-family: 'Bebas Neue', sans-serif;
          font-size: 20px;
          letter-spacing: 2px;
          background: var(--bg-input);
          border: 2px solid var(--accent);
          border-radius: 8px;
          color: var(--accent);
          cursor: pointer;
          transition: all 0.2s;
        }

        .setup-btn:hover {
          background: var(--accent);
          color: white;
        }

        .edit-creds-btn {
          margin-top: 20px;
          padding: 10px 20px;
          background: transparent;
          border: 1px solid var(--border);
          border-radius: 6px;
          color: var(--text-dim);
          font-family: 'Space Mono', monospace;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .edit-creds-btn:hover {
          border-color: var(--text-dim);
          color: var(--text);
        }

        /* Config Form */
        .config-form {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 30px;
        }

        .form-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          padding-bottom: 15px;
          border-bottom: 1px solid var(--border);
        }

        .form-header h2 {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 22px;
          letter-spacing: 2px;
          color: var(--accent);
        }

        .saved-badge {
          font-size: 12px;
          color: var(--success);
          background: rgba(0, 217, 126, 0.1);
          padding: 6px 12px;
          border-radius: 20px;
        }

        .form-section {
          margin-bottom: 30px;
        }

        .input-group {
          margin-bottom: 20px;
        }

        .input-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }

        label {
          display: block;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: var(--text-dim);
          margin-bottom: 8px;
        }

        input, textarea {
          width: 100%;
          padding: 14px 16px;
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text);
          font-family: 'Space Mono', monospace;
          font-size: 14px;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        input:focus, textarea:focus {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-glow);
        }

        input::placeholder, textarea::placeholder {
          color: var(--text-dim);
          opacity: 0.5;
        }

        .input-hint {
          display: block;
          font-size: 11px;
          color: var(--text-dim);
          margin-top: 6px;
          opacity: 0.7;
        }

        .button-row {
          display: flex;
          gap: 15px;
          flex-wrap: wrap;
        }

        .save-btn {
          flex: 1;
          padding: 16px;
          font-family: 'Bebas Neue', sans-serif;
          font-size: 20px;
          letter-spacing: 2px;
          background: linear-gradient(135deg, var(--accent), #ff8c5a);
          border: none;
          border-radius: 8px;
          color: white;
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s;
        }

        .save-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 30px var(--accent-glow);
        }

        .clear-btn {
          padding: 16px 24px;
          font-family: 'Space Mono', monospace;
          font-size: 13px;
          background: transparent;
          border: 1px solid var(--danger);
          border-radius: 8px;
          color: var(--danger);
          cursor: pointer;
          transition: all 0.2s;
        }

        .clear-btn:hover {
          background: var(--danger);
          color: white;
        }

        .run-btn {
          width: 100%;
          padding: 18px;
          font-family: 'Bebas Neue', sans-serif;
          font-size: 24px;
          letter-spacing: 3px;
          background: linear-gradient(135deg, var(--accent), #ff8c5a);
          border: none;
          border-radius: 8px;
          color: white;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          transition: transform 0.2s, box-shadow 0.2s;
        }

        .run-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 8px 30px var(--accent-glow);
        }

        .run-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .spinner {
          width: 20px;
          height: 20px;
          border: 2px solid transparent;
          border-top-color: white;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .error-box {
          margin-top: 20px;
          padding: 16px;
          background: rgba(230, 55, 87, 0.1);
          border: 1px solid var(--danger);
          border-radius: 8px;
          color: var(--danger);
          text-align: left;
        }

        .error-help {
          margin-top: 10px;
          font-size: 13px;
          opacity: 0.8;
        }

        .help-section {
          margin-top: 30px;
          padding: 20px;
          background: var(--bg-input);
          border-radius: 8px;
          font-size: 13px;
        }

        .help-section h3 {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 16px;
          letter-spacing: 1px;
          margin-bottom: 15px;
          color: var(--text-dim);
        }

        .help-section ol {
          padding-left: 20px;
          color: var(--text-dim);
        }

        .help-section li {
          margin-bottom: 8px;
        }

        .help-section code {
          background: var(--bg-card);
          padding: 2px 6px;
          border-radius: 4px;
          color: var(--accent);
        }

        .help-section a {
          color: var(--accent);
        }

        .help-section kbd {
          background: var(--bg-dark);
          padding: 2px 6px;
          border-radius: 4px;
          border: 1px solid var(--border);
          font-size: 11px;
        }

        .privacy-note {
          margin-top: 15px;
          padding-top: 15px;
          border-top: 1px solid var(--border);
          color: var(--success);
          font-size: 12px;
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
          margin-bottom: 40px;
          flex-wrap: wrap;
        }

        .matchup-header h2 {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 28px;
          letter-spacing: 2px;
        }

        .vs {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 18px;
          color: var(--text-dim);
          padding: 8px 16px;
          border: 1px solid var(--border);
          border-radius: 20px;
        }

        .win-probability-section {
          margin-bottom: 40px;
        }

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
          color: var(--text-dim);
        }

        .you-legend { color: var(--you-color); }
        .opp-legend { color: var(--opp-color); }

        .projected-score {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 30px;
          margin-bottom: 40px;
        }

        .score-box {
          text-align: center;
          padding: 20px 40px;
          background: var(--bg-input);
          border-radius: 12px;
          border: 2px solid var(--you-color);
        }

        .score-box.opp {
          border-color: var(--opp-color);
        }

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

        .outcomes-section {
          margin-bottom: 40px;
        }

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

        .table-wrapper {
          overflow-x: auto;
        }

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

        .categories-table .cat-name {
          font-weight: bold;
        }

        .swing-badge {
          margin-left: 8px;
        }

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

        .mini-you.winning {
          background: var(--you-color);
        }

        .pct {
          font-size: 14px;
          color: var(--text-dim);
        }

        .pct.winning {
          color: var(--you-color);
          font-weight: bold;
        }

        .projection {
          font-size: 13px;
          color: var(--text-dim);
        }

        .swing-section {
          margin-top: 30px;
          padding: 20px;
          background: rgba(255, 107, 53, 0.05);
          border: 1px solid var(--accent);
          border-radius: 8px;
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

        .run-again-btn {
          margin-top: 30px;
          width: 100%;
          padding: 14px;
          font-family: 'Bebas Neue', sans-serif;
          font-size: 18px;
          letter-spacing: 2px;
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text);
          cursor: pointer;
          transition: all 0.2s;
        }

        .run-again-btn:hover {
          border-color: var(--accent);
          color: var(--accent);
        }

        /* Streamers Panel */
        .streamers-panel {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 30px;
        }

        .streamers-panel h2 {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 28px;
          letter-spacing: 2px;
          margin-bottom: 10px;
        }

        .baseline-info {
          color: var(--text-dim);
          margin-bottom: 20px;
        }

        .streamers-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
          min-width: 600px;
        }

        .streamers-table th,
        .streamers-table td {
          padding: 12px 8px;
          text-align: left;
          border-bottom: 1px solid var(--border);
        }

        .streamers-table th {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: var(--text-dim);
          font-weight: normal;
        }

        .streamers-table tr.positive {
          background: rgba(0, 217, 126, 0.05);
        }

        .streamers-table tr.negative {
          background: rgba(230, 55, 87, 0.05);
        }

        .player-name {
          font-weight: bold;
        }

        .delta.positive {
          color: var(--success);
          font-weight: bold;
        }

        .delta.negative {
          color: var(--danger);
        }

        .impacts {
          font-size: 12px;
          color: var(--text-dim);
        }

        .risks {
          font-size: 11px;
          color: var(--danger);
        }

        .no-streamers {
          text-align: center;
          padding: 40px;
          color: var(--text-dim);
        }

        .no-streamers .hint {
          font-size: 13px;
          margin-top: 10px;
          opacity: 0.7;
        }

        footer {
          text-align: center;
          padding: 40px 0;
          color: var(--text-dim);
          font-size: 12px;
        }

        @media (max-width: 768px) {
          h1 {
            font-size: 32px;
          }

          .input-row {
            grid-template-columns: 1fr;
          }

          .matchup-header {
            flex-direction: column;
            gap: 10px;
          }

          .matchup-header h2 {
            font-size: 20px;
            text-align: center;
          }

          .projected-score {
            gap: 15px;
          }

          .score-box {
            padding: 15px 25px;
          }

          .score-box .score {
            font-size: 42px;
          }

          .tabs button {
            padding: 10px 16px;
            font-size: 14px;
          }

          .button-row {
            flex-direction: column;
          }
        }
      `}</style>
    </>
  );
}