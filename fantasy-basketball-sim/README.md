# 🏀 Fantasy Basketball Monte Carlo Simulator

A web-based fantasy basketball matchup simulator that uses Monte Carlo simulations to predict your weekly win probability. Access it from any device - iPhone, iPad, laptop, or PC!

## Features

- **Monte Carlo Simulation**: Runs thousands of simulations to predict win probability
- **Current Week Totals**: Integrates live stats from your current matchup
- **Category Breakdown**: See win probability for each statistical category
- **Swing Category Detection**: Identifies close categories to focus streaming efforts
- **Streamer Analysis**: Tests free agents to find the best pickups
- **Mobile Responsive**: Works on any device

---

## 🚀 Deployment Guide (Step-by-Step)

### Prerequisites

1. A **GitHub account** (free): https://github.com/signup
2. A **Vercel account** (free): https://vercel.com/signup (sign up with GitHub)

---

### Step 1: Create a GitHub Repository

1. Go to https://github.com/new
2. Name it `fantasy-basketball-sim`
3. Keep it **Public** (or Private if you prefer)
4. Click **Create repository**
5. You'll see instructions - keep this page open

---

### Step 2: Upload the Code

**Option A: Using GitHub Web Upload (Easiest)**

1. On your new repo page, click **"uploading an existing file"**
2. Drag and drop ALL the files from the project folder:
   - `package.json`
   - `next.config.js`
   - `vercel.json`
   - `requirements.txt`
   - `.gitignore`
   - `pages/index.jsx`
   - `api/simulate.py`
3. Click **Commit changes**

**Option B: Using Git Command Line**

```bash
# Clone your new repo
git clone https://github.com/YOUR_USERNAME/fantasy-basketball-sim.git
cd fantasy-basketball-sim

# Copy all the project files into this folder, then:
git add .
git commit -m "Initial commit"
git push origin main
```

---

### Step 3: Deploy to Vercel

1. Go to https://vercel.com/new
2. Click **Import** next to your `fantasy-basketball-sim` repository
3. Keep all default settings
4. Click **Deploy**
5. Wait 2-3 minutes for deployment to complete
6. 🎉 You'll get a URL like `https://fantasy-basketball-sim.vercel.app`

---

### Step 4: Find Your ESPN Credentials

To use the app, you need your ESPN Fantasy credentials:

#### League ID
1. Go to your ESPN Fantasy Basketball league
2. Look at the URL: `fantasy.espn.com/basketball/league?leagueId=XXXXXXXX`
3. The number after `leagueId=` is your League ID

#### Team ID
1. Click on your team in ESPN
2. Look at the URL: `...teamId=X`
3. That number is your Team ID (usually 1-12)

#### ESPN_S2 and SWID Cookies
1. Log into ESPN Fantasy Basketball in your browser
2. Open Developer Tools:
   - **Chrome/Edge**: Press `F12` or `Ctrl+Shift+I` (Windows) / `Cmd+Option+I` (Mac)
   - **Firefox**: Press `F12`
   - **Safari**: Enable Developer menu in Preferences, then `Cmd+Option+I`
3. Go to **Application** tab (Chrome) or **Storage** tab (Firefox)
4. Click **Cookies** → `https://www.espn.com`
5. Find and copy:
   - `espn_s2` - a long string starting with `AEB...`
   - `SWID` - looks like `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}`

---

### Step 5: Use Your App!

1. Open your Vercel URL on any device
2. Enter your ESPN credentials
3. Click **RUN SIMULATION**
4. View your win probability, category breakdowns, and streamer recommendations!

---

## 📱 Using on Mobile

Simply open your Vercel URL in Safari (iPhone/iPad) or Chrome (Android). The interface is fully responsive!

**Pro tip**: Add to Home Screen for app-like access:
- **iPhone/iPad**: Tap Share → Add to Home Screen
- **Android**: Tap Menu → Add to Home Screen

---

## Troubleshooting

### "Simulation failed" error
- Double-check your ESPN credentials are correct
- Make sure your league is a **private** league (public leagues don't need cookies)
- Verify the `espn_s2` cookie hasn't expired (re-copy from browser)

### Slow simulation
- Reduce simulation count to 5000 for faster results
- The free Vercel tier has a 60-second timeout

### No streamers showing
- The app tests free agents with games remaining this week
- If it's late in the week, fewer options are available

---

## Local Development

If you want to run locally:

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Open http://localhost:3000
```

For the Python API locally, you'll need Python 3.9+ and:
```bash
pip install espn-api
```

---

## Tech Stack

- **Frontend**: Next.js + React
- **Backend**: Python (Vercel Serverless Functions)
- **API**: ESPN Fantasy API via `espn-api` library
- **Hosting**: Vercel (free tier)

---

## Credits

Based on the Fantasy Basketball Win Percentage Simulation V4 script. Converted to a web application for cross-device access.

---

## License

MIT License - feel free to modify and use as you like!
