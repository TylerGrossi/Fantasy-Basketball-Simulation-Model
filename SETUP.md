# Fantasy Basketball Simulator - Setup Guide

This version includes **Google Sign-In** so your ESPN credentials are saved to your account and work across all your devices!

## 🚀 Setup Instructions

### Step 1: Update Your GitHub Repository

Replace all files in your repo with the contents of this zip file.

### Step 2: Set Up Google OAuth (Required for Login)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Go to **APIs & Services** → **Credentials**
4. Click **Create Credentials** → **OAuth 2.0 Client IDs**
5. Choose **Web application**
6. Add these Authorized redirect URIs:
   - `http://localhost:3000/api/auth/callback/google` (for local dev)
   - `https://YOUR-APP.vercel.app/api/auth/callback/google` (replace with your Vercel URL)
7. Copy your **Client ID** and **Client Secret**

### Step 3: Set Up Vercel KV (Free Database)

1. Go to your [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project
3. Go to **Storage** tab
4. Click **Create Database** → **KV**
5. Name it something like `fantasy-basketball-kv`
6. Click **Create**
7. It will automatically add the environment variables to your project

### Step 4: Add Environment Variables in Vercel

Go to your Vercel project → **Settings** → **Environment Variables**

Add these variables:

| Name | Value |
|------|-------|
| `GOOGLE_CLIENT_ID` | Your Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Your Google OAuth Client Secret |
| `NEXTAUTH_SECRET` | A random string (generate one at https://generate-secret.vercel.app/32) |
| `NEXTAUTH_URL` | Your Vercel URL (e.g., `https://fantasy-basketball-simulation-model.vercel.app`) |

The KV variables (`KV_URL`, `KV_REST_API_URL`, etc.) should be auto-added when you created the KV store.

### Step 5: Redeploy

After adding all environment variables:
1. Go to **Deployments** tab
2. Click the **...** menu on the latest deployment
3. Click **Redeploy**

## ✅ Done!

Now you can:
1. Sign in with Google
2. Save your ESPN credentials once
3. Access from any device - iPhone, iPad, laptop, anywhere!

## Troubleshooting

### "NEXTAUTH_URL" error
Make sure you added `NEXTAUTH_URL` with your full Vercel URL including `https://`

### Google login not working
- Check that your redirect URI in Google Console matches exactly
- Make sure both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set

### Credentials not saving
- Make sure Vercel KV is set up and connected to your project
- Check that KV environment variables are present

---

## Files in this package:

```
pages/
├── _app.js                 # NextAuth SessionProvider wrapper
├── index.js                # Main app with login UI
└── api/
    ├── auth/
    │   └── [...nextauth].js  # Google authentication
    ├── credentials.js        # Save/load user credentials
    └── simulate.js           # Monte Carlo simulation
package.json
next.config.js
vercel.json
.gitignore
SETUP.md (this file)
```
