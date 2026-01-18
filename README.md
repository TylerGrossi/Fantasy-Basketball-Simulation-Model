
# 🏀 Fantasy Basketball Win Percentage Simulator

A web-based Monte Carlo simulation tool for ESPN Fantasy Basketball matchups.

![Streamlit](https://img.shields.io/badge/Streamlit-FF4B4B?style=for-the-badge&logo=Streamlit&logoColor=white)
![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)

## Features

* **Monte Carlo Simulation** : Run thousands of simulations to estimate true win probability
* **Category Analysis** : See which categories are locks vs. swing categories
* **Streamer Impact Analysis** : Find the best free agent pickups to maximize expected categories won
* **Live ESPN Data** : Automatically pulls your current matchup data from ESPN
* **Beautiful Dashboard** : Modern, dark-themed UI with interactive Plotly charts

## Quick Start

### Option 1: Run Locally

```bash
# Clone or download the files
# Install dependencies
pip install -r requirements.txt

# Run the app
streamlit run fantasy_basketball_app.py
```

### Option 2: Deploy to Streamlit Cloud (Free)

1. **Create a GitHub Repository**
   * Create a new repo on GitHub
   * Upload `fantasy_basketball_app.py` and `requirements.txt`
2. **Deploy on Streamlit Cloud**
   * Go to [share.streamlit.io](https://share.streamlit.io/)
   * Sign in with GitHub
   * Click "New app"
   * Select your repository
   * Set the main file path to `fantasy_basketball_app.py`
   * Click "Deploy"
3. **Access from Any Device**
   * Your app will be available at `https://[your-app-name].streamlit.app`
   * Access it from phone, tablet, or any computer!

### Option 3: Deploy to Railway/Render

Both platforms offer free tiers:

**Railway:**

1. Connect GitHub repo
2. Add environment variable: `PORT=8501`
3. Deploy with command: `streamlit run fantasy_basketball_app.py --server.port $PORT`

**Render:**

1. Create new Web Service
2. Connect GitHub repo
3. Build command: `pip install -r requirements.txt`
4. Start command: `streamlit run fantasy_basketball_app.py --server.port 10000`

## Configuration

### Getting ESPN Credentials

1. **League ID** : Found in your ESPN Fantasy Basketball league URL

* Example: `https://fantasy.espn.com/basketball/league?leagueId=267469544`
* League ID = `267469544`

1. **Team ID** : Your team's ID (1-12 typically)

* Go to your team page and check the URL

1. **ESPN S2 & SWID Cookies** (for private leagues):
   * Open ESPN Fantasy in Chrome
   * Press F12 → Application → Cookies → espn.com
   * Find `espn_s2` and `SWID` values
   * Copy the full values including any special characters

## How It Works

1. **Data Collection** : Pulls player stats from ESPN API (season + last 30 days)
2. **Games Remaining** : Fetches NBA schedule to count remaining games this week
3. **Stat Blending** : Combines recent and season stats (configurable weight)
4. **Monte Carlo** : Simulates each game with variance factors for realistic projections
5. **Category Comparison** : Compares simulated totals across all categories
6. **Streamer Analysis** : Tests adding free agents to find best pickups

## Simulation Details

The simulation uses realistic variance factors for each stat category:

| Category      | Variance | Notes                      |
| ------------- | -------- | -------------------------- |
| PTS, FGM, 3PM | 0.7      | High game-to-game variance |
| STL, BLK      | 0.8      | Very high variance         |
| REB, AST      | 0.4      | Moderate variance          |
| FTM, FTA      | 0.2      | Low variance               |
| TO            | 0.5      | Moderate variance          |

## Troubleshooting

 **"Connection Error"** : Check your ESPN credentials, especially for private leagues

 **"No players found"** : Make sure you're using the correct team ID and season year

 **Slow loading** : NBA schedule fetching can take 10-20 seconds. Results are cached.

## License

MIT License - feel free to modify and share!
