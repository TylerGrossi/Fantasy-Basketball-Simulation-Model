import { useState, useEffect } from 'react';
import { useSession, signIn, signOut } from "next-auth/react";
import Head from 'next/head';

export default function Home() {
  const { data: session, status } = useSession();
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
  const [savingCreds, setSavingCreds] = useState(false);
  const [loadingCreds, setLoadingCreds] = useState(true);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState('');
  const [activeTab, setActiveTab] = useState('simulate');
  const [credentialsSaved, setCredentialsSaved] = useState(false);

  // Load saved credentials when logged in
  useEffect(() => {
    if (session) {
      loadCredentials();
    } else {
      setLoadingCreds(false);
    }
  }, [session]);

  const loadCredentials = async () => {
    try {
      const response = await fetch('/api/credentials');
      const data = await response.json();
      
      if (data.credentials) {
        setConfig(prev => ({
          ...prev,
          league_id: data.credentials.league_id || '',
          team_id: data.credentials.team_id || '',
          espn_s2: data.credentials.espn_s2 || '',
          swid: data.credentials.swid || '',
        }));
        setCredentialsSaved(true);
      }
    } catch (error) {
      console.error('Failed to load credentials:', error);
    } finally {
      setLoadingCreds(false);
    }
  };

  const saveCredentials = async () => {
    setSavingCreds(true);
    try {
      const response = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          league_id: config.league_id,
          team_id: config.team_id,
          espn_s2: config.espn_s2,
          swid: config.swid,
        }),
      });
      
      if (response.ok) {
        setCredentialsSaved(true);
        setActiveTab('simulate');
      }
    } catch (error) {
      console.error('Failed to save credentials:', error);
    } finally {
      setSavingCreds(false);
    }
  };

  const clearCredentials = async () => {
    try {
      await fetch('/api/credentials', { method: 'DELETE' });
      setConfig({
        league_id: '',
        espn_s2: '',
        swid: '',
        team_id: '',
        sim_count: 10000,
        streamers_to_test: 20,
      });
      setCredentialsSaved(false);
    } catch (error) {
      console.error('Failed to clear credentials:', error);
    }
  };

  const decodeIfNeeded = (str) => {
    if (!str) return str;
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

  // Loading state
  if (status === "loading" || (session && loadingCreds)) {
    return (
      <>
        <Head>
          <title>Fantasy Basketball Simulator</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
        </Head>
        <div className="loading-screen">
          <div className="ball">🏀</div>
          <p>Loading...</p>
        </div>
        <style jsx global>{`
          body {
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            background: #0a0a0f;
            color: #e8e8f0;
            margin: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .loading-screen {
            text-align: center;
          }
          .ball {
            font-size: 64px;
            animation: bounce 1s ease-in-out infinite;
          }
          @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-20px); }
          }
        `}</style>
      </>
    );
  }

  // Not logged in - show login page
  if (!session) {
    return (
      <>
        <Head>
          <title>Fantasy Basketball Simulator - Login</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
        </Head>
        <div className="login-page">
          <div className="login-card">
            <div className="logo">
              <span className="ball">🏀</span>
              <h1>FANTASY HOOPS<span className="accent">SIM</span></h1>
            </div>
            <p className="tagline">Monte Carlo Matchup Projections</p>
            
            <div className="features">
              <div className="feature">📊 Win probability simulations</div>
              <div className="feature">📈 Category-by-category breakdown</div>
              <div className="feature">🎯 Swing category detection</div>
              <div className="feature">💾 Save your credentials securely</div>
            </div>

            <button onClick={() => signIn('google')} className="google-btn">
              <svg viewBox="0 0 24 24" width="24" height="24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Sign in with Google
            </button>

            <p className="privacy">
              🔒 Your ESPN credentials are encrypted and stored securely.
              <br />We never share your data.
            </p>
          </div>
        </div>
        <style jsx global>{`
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }
          body {
            font-family: 'Space Mono', monospace;
            background: #0a0a0f;
            color: #e8e8f0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background-image: 
              radial-gradient(ellipse at 20% 0%, rgba(255, 107, 53, 0.08) 0%, transparent 50%),
              radial-gradient(ellipse at 80% 100%, rgba(0, 217, 126, 0.05) 0%, transparent 50%);
          }
          .login-page {
            padding: 20px;
            width: 100%;
            max-width: 480px;
          }
          .login-card {
            background: #12121a;
            border: 1px solid #2a2a3a;
            border-radius: 16px;
            padding: 40px;
            text-align: center;
          }
          .logo {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 15px;
            margin-bottom: 8px;
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
            font-size: 36px;
            letter-spacing: 3px;
            color: #e8e8f0;
          }
          h1 .accent {
            color: #ff6b35;
          }
          .tagline {
            color: #8888a0;
            font-size: 12px;
            letter-spacing: 2px;
            text-transform: uppercase;
            margin-bottom: 30px;
          }
          .features {
            text-align: left;
            margin-bottom: 30px;
          }
          .feature {
            padding: 12px 16px;
            background: #1a1a25;
            border-radius: 8px;
            margin-bottom: 10px;
            font-size: 14px;
          }
          .google-btn {
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            padding: 16px 24px;
            background: white;
            border: none;
            border-radius: 8px;
            font-family: 'Space Mono', monospace;
            font-size: 16px;
            font-weight: bold;
            color: #333;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
          }
          .google-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 30px rgba(255, 255, 255, 0.1);
          }
          .privacy {
            margin-top: 24px;
            font-size: 12px;
            color: #8888a0;
            line-height: 1.6;
          }
        `}</style>
      </>
    );
  }

  // Logged in - show main app
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
          <div className="header-row">
            <div className="logo">
              <span className="ball">🏀</span>
              <h1>FANTASY HOOPS<span className="accent">SIM</span></h1>
            </div>
            <div className="user-info">
              <img src={session.user.image} alt="" className="avatar" />
              <span className="user-name">{session.user.name?.split(' ')[0]}</span>
              <button onClick={() => signOut()} className="sign-out-btn">Sign Out</button>
            </div>
          </div>
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
                      {credentialsSaved && <span className="pill check">✓ Saved</span>}
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
                </div>
              ) : (
                <div className="no-credentials">
                  <h2>Welcome, {session.user.name?.split(' ')[0]}! 👋</h2>
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
            <div className="config-form">
              <div className="form-header">
                <h2>ESPN League Credentials</h2>
                {credentialsSaved && (
                  <span className="saved-badge">✓ Saved to your account</span>
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
                  />
                </div>
                <div className="input-group">
                  <label>ESPN_S2 Cookie</label>
                  <textarea
                    value={config.espn_s2}
                    onChange={(e) => setConfig({ ...config, espn_s2: e.target.value })}
                    placeholder="Your espn_s2 cookie value"
                    rows={3}
                  />
                </div>
                <div className="input-group">
                  <label>SWID Cookie</label>
                  <input
                    type="text"
                    value={config.swid}
                    onChange={(e) => setConfig({ ...config, swid: e.target.value })}
                    placeholder="{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}"
                  />
                </div>
              </div>

              <div className="button-row">
                <button onClick={saveCredentials} className="save-btn" disabled={savingCreds}>
                  {savingCreds ? 'Saving...' : '💾 Save Credentials'}
                </button>
                {credentialsSaved && (
                  <button type="button" className="clear-btn" onClick={clearCredentials}>
                    🗑️ Clear
                  </button>
                )}
              </div>

              <div className="help-section">
                <h3>How to find your ESPN credentials:</h3>
                <ol>
                  <li>Log in to <a href="https://fantasy.espn.com/basketball" target="_blank" rel="noopener noreferrer">ESPN Fantasy Basketball</a></li>
                  <li>Open DevTools: <kbd>F12</kbd> or <kbd>Ctrl+Shift+I</kbd></li>
                  <li>Go to <strong>Application</strong> → <strong>Cookies</strong> → <strong>espn.com</strong></li>
                  <li>Copy <code>espn_s2</code> and <code>SWID</code> values</li>
                </ol>
              </div>
            </div>
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
        </main>

        <footer>
          <p>Monte Carlo simulation • Data from ESPN Fantasy API</p>
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
        header { padding: 20px 0 30px; }
        .header-row { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 20px; }
        .logo { display: flex; align-items: center; gap: 15px; }
        .ball { font-size: 40px; animation: bounce 2s ease-in-out infinite; }
        @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        h1 { font-family: 'Bebas Neue', sans-serif; font-size: 36px; letter-spacing: 3px; }
        h1 .accent { color: var(--accent); }
        .user-info { display: flex; align-items: center; gap: 12px; }
        .avatar { width: 36px; height: 36px; border-radius: 50%; }
        .user-name { font-size: 14px; color: var(--text-dim); }
        .sign-out-btn { padding: 8px 16px; background: transparent; border: 1px solid var(--border); border-radius: 6px; color: var(--text-dim); font-family: inherit; font-size: 12px; cursor: pointer; transition: all 0.2s; }
        .sign-out-btn:hover { border-color: var(--danger); color: var(--danger); }
        .tabs { display: flex; gap: 4px; margin-bottom: 30px; border-bottom: 1px solid var(--border); padding-bottom: 4px; flex-wrap: wrap; }
        .tabs button { font-family: 'Bebas Neue', sans-serif; font-size: 18px; letter-spacing: 2px; padding: 12px 24px; background: transparent; border: none; color: var(--text-dim); cursor: pointer; position: relative; transition: color 0.2s; }
        .tabs button:hover:not(:disabled) { color: var(--text); }
        .tabs button.active { color: var(--accent); }
        .tabs button.active::after { content: ''; position: absolute; bottom: -5px; left: 0; right: 0; height: 2px; background: var(--accent); }
        .tabs button:disabled { opacity: 0.3; cursor: not-allowed; }
        .simulate-panel, .config-form, .results-panel { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 30px; }
        .quick-run { text-align: center; }
        .credentials-summary h2 { font-family: 'Bebas Neue', sans-serif; font-size: 32px; letter-spacing: 2px; margin-bottom: 15px; }
        .cred-pills { display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; margin-bottom: 30px; }
        .pill { padding: 8px 16px; background: var(--bg-input); border: 1px solid var(--border); border-radius: 20px; font-size: 13px; }
        .pill.check { background: rgba(0, 217, 126, 0.1); border-color: var(--success); color: var(--success); }
        .sim-settings { max-width: 300px; margin: 0 auto 30px; }
        .no-credentials { text-align: center; padding: 40px; }
        .no-credentials h2 { font-family: 'Bebas Neue', sans-serif; font-size: 32px; margin-bottom: 10px; }
        .no-credentials p { color: var(--text-dim); margin-bottom: 30px; }
        .setup-btn { padding: 16px 32px; font-family: 'Bebas Neue', sans-serif; font-size: 20px; letter-spacing: 2px; background: var(--bg-input); border: 2px solid var(--accent); border-radius: 8px; color: var(--accent); cursor: pointer; transition: all 0.2s; }
        .setup-btn:hover { background: var(--accent); color: white; }
        .form-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid var(--border); flex-wrap: wrap; gap: 10px; }
        .form-header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 22px; letter-spacing: 2px; color: var(--accent); }
        .saved-badge { font-size: 12px; color: var(--success); background: rgba(0, 217, 126, 0.1); padding: 6px 12px; border-radius: 20px; }
        .form-section { margin-bottom: 30px; }
        .input-group { margin-bottom: 20px; }
        .input-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); margin-bottom: 8px; }
        input, textarea { width: 100%; padding: 14px 16px; background: var(--bg-input); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-family: 'Space Mono', monospace; font-size: 14px; transition: border-color 0.2s, box-shadow 0.2s; }
        input:focus, textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
        input::placeholder, textarea::placeholder { color: var(--text-dim); opacity: 0.5; }
        .input-hint { display: block; font-size: 11px; color: var(--text-dim); margin-top: 6px; opacity: 0.7; }
        .button-row { display: flex; gap: 15px; flex-wrap: wrap; }
        .save-btn { flex: 1; padding: 16px; font-family: 'Bebas Neue', sans-serif; font-size: 20px; letter-spacing: 2px; background: linear-gradient(135deg, var(--accent), #ff8c5a); border: none; border-radius: 8px; color: white; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; }
        .save-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 30px var(--accent-glow); }
        .save-btn:disabled { opacity: 0.7; }
        .clear-btn { padding: 16px 24px; font-family: 'Space Mono', monospace; font-size: 13px; background: transparent; border: 1px solid var(--danger); border-radius: 8px; color: var(--danger); cursor: pointer; transition: all 0.2s; }
        .clear-btn:hover { background: var(--danger); color: white; }
        .run-btn { width: 100%; padding: 18px; font-family: 'Bebas Neue', sans-serif; font-size: 24px; letter-spacing: 3px; background: linear-gradient(135deg, var(--accent), #ff8c5a); border: none; border-radius: 8px; color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 12px; transition: transform 0.2s, box-shadow 0.2s; }
        .run-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 30px var(--accent-glow); }
        .run-btn:disabled { opacity: 0.7; cursor: not-allowed; }
        .spinner { width: 20px; height: 20px; border: 2px solid transparent; border-top-color: white; border-radius: 50%; animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .error-box { margin-top: 20px; padding: 16px; background: rgba(230, 55, 87, 0.1); border: 1px solid var(--danger); border-radius: 8px; color: var(--danger); text-align: left; }
        .error-help { margin-top: 10px; font-size: 13px; opacity: 0.8; }
        .help-section { margin-top: 30px; padding: 20px; background: var(--bg-input); border-radius: 8px; font-size: 13px; }
        .help-section h3 { font-family: 'Bebas Neue', sans-serif; font-size: 16px; letter-spacing: 1px; margin-bottom: 15px; color: var(--text-dim); }
        .help-section ol { padding-left: 20px; color: var(--text-dim); }
        .help-section li { margin-bottom: 8px; }
        .help-section code { background: var(--bg-card); padding: 2px 6px; border-radius: 4px; color: var(--accent); }
        .help-section a { color: var(--accent); }
        .help-section kbd { background: var(--bg-dark); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border); font-size: 11px; }
        .matchup-header { display: flex; align-items: center; justify-content: center; gap: 30px; margin-bottom: 40px; flex-wrap: wrap; }
        .matchup-header h2 { font-family: 'Bebas Neue', sans-serif; font-size: 28px; letter-spacing: 2px; text-align: center; }
        .vs { font-family: 'Bebas Neue', sans-serif; font-size: 18px; color: var(--text-dim); padding: 8px 16px; border: 1px solid var(--border); border-radius: 20px; }
        .win-probability-section, .outcomes-section, .categories-section { margin-bottom: 40px; }
        .win-probability-section h3, .outcomes-section h3, .categories-section h3, .swing-section h3 { font-family: 'Bebas Neue', sans-serif; font-size: 18px; letter-spacing: 2px; color: var(--text-dim); margin-bottom: 15px; }
        .probability-bar-container { padding: 20px; background: var(--bg-input); border-radius: 8px; }
        .probability-labels { display: flex; justify-content: space-between; margin-bottom: 10px; }
        .you-label { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: var(--you-color); }
        .opp-label { font-family: 'Bebas Neue', sans-serif; font-size: 36px; color: var(--opp-color); }
        .probability-bar { display: flex; height: 24px; border-radius: 12px; overflow: hidden; background: var(--bg-dark); }
        .you-bar { background: linear-gradient(90deg, var(--you-color), #00b368); transition: width 0.5s ease; }
        .opp-bar { background: linear-gradient(90deg, #c62e4a, var(--opp-color)); transition: width 0.5s ease; }
        .probability-legend { display: flex; justify-content: space-between; margin-top: 10px; font-size: 12px; color: var(--text-dim); }
        .you-legend { color: var(--you-color); }
        .opp-legend { color: var(--opp-color); }
        .projected-score { display: flex; align-items: center; justify-content: center; gap: 30px; margin-bottom: 40px; }
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
        .swing-section { margin-top: 30px; padding: 20px; background: rgba(255, 107, 53, 0.05); border: 1px solid var(--accent); border-radius: 8px; }
        .swing-section p { color: var(--text-dim); font-size: 13px; margin-bottom: 15px; }
        .swing-tags { display: flex; gap: 10px; flex-wrap: wrap; }
        .swing-tag { padding: 8px 16px; background: var(--accent); color: white; border-radius: 20px; font-size: 13px; font-weight: bold; }
        .run-again-btn { margin-top: 30px; width: 100%; padding: 14px; font-family: 'Bebas Neue', sans-serif; font-size: 18px; letter-spacing: 2px; background: var(--bg-input); border: 1px solid var(--border); border-radius: 8px; color: var(--text); cursor: pointer; transition: all 0.2s; }
        .run-again-btn:hover { border-color: var(--accent); color: var(--accent); }
        footer { text-align: center; padding: 40px 0; color: var(--text-dim); font-size: 12px; }
        @media (max-width: 768px) {
          h1 { font-size: 28px; }
          .header-row { justify-content: center; }
          .input-row { grid-template-columns: 1fr; }
          .matchup-header { flex-direction: column; gap: 10px; }
          .matchup-header h2 { font-size: 20px; }
          .projected-score { gap: 15px; }
          .score-box { padding: 15px 25px; }
          .score-box .score { font-size: 42px; }
          .tabs button { padding: 10px 16px; font-size: 14px; }
          .button-row { flex-direction: column; }
        }
      `}</style>
    </>
  );
}
