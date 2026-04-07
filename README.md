# AI Code Review — Backend

Node.js/Express API for AI-powered GitHub PR reviews. Integrates with OpenAI GPT-4o, Firebase Firestore, and GitHub OAuth.

## Stack

- **Runtime:** Node.js 18+
- **Framework:** Express
- **Database:** Firebase Firestore
- **AI:** OpenAI GPT-4o
- **Auth:** Firebase Admin SDK + GitHub OAuth 2.0
- **Deployment:** Render (see `render.yaml`)

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | None | Health check |
| GET | `/projects` | Firebase token | List user's projects |
| POST | `/projects` | Firebase token | Create project |
| PUT | `/projects/:id` | Firebase token | Update project |
| DELETE | `/projects/:id` | Firebase token | Delete project |
| POST | `/review` | Optional | Run AI review + auto-post results |
| POST | `/comment` | Optional | Post review to GitHub PR |
| GET | `/auth/github/url` | Firebase token | Get GitHub OAuth URL |
| GET | `/auth/github/callback` | None | OAuth callback from GitHub |
| GET | `/auth/github/status` | Firebase token | GitHub connection status |
| DELETE | `/auth/github` | Firebase token | Disconnect GitHub account |

## Local Development

```bash
npm install
cp .env.example .env
# Fill in .env values
npm run dev        # starts on http://localhost:3001
```

Verify:
```bash
curl http://localhost:3001/health
```

## Deploy on Render

This repo includes `render.yaml` — a Render Blueprint for one-click deployment.

### Option A: Blueprint (recommended)

1. Push this repo to GitHub.
2. Go to [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint**.
3. Select this repo. Render reads `render.yaml` and creates the service.
4. Open the service → **Environment** tab → fill in all secret variables.

### Option B: Manual

1. Render Dashboard → **New → Web Service** → connect this repo.
2. Settings:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Health check path:** `/health`
3. Add all environment variables from the table below.

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | Yes | Set to `production` |
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| `ALLOWED_ORIGINS` | Yes | Frontend URL, e.g. `https://your-app.vercel.app` |
| `GITHUB_CLIENT_ID` | Yes | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | Yes | GitHub OAuth App client secret |
| `GITHUB_CALLBACK_URL` | Yes | `https://your-backend.onrender.com/auth/github/callback` |
| `FRONTEND_URL` | Yes | `https://your-app.vercel.app` |
| `GITHUB_TOKEN` | No | Server fallback PAT (for GitHub Actions) |
| `FIREBASE_PROJECT_ID` | Yes | Firebase project ID |
| `FIREBASE_CLIENT_EMAIL` | Yes | Service account email |
| `FIREBASE_PRIVATE_KEY` | Yes | Service account private key (wrap in quotes, use `\n`) |
| `LOG_LEVEL` | No | `debug` / `info` / `warn` / `error` (default: `info`) |

### After Deploying

Note your backend URL: `https://ai-code-review-backend.onrender.com`

Update your frontend's `VITE_API_URL` to this value, and set `ALLOWED_ORIGINS` here to your Vercel frontend URL.

---

## GitHub Actions — Auto-Review Template

Copy `examples/ai-review.yml` into any target repo at `.github/workflows/ai-review.yml` to trigger automatic AI reviews on every PR.

Replace `AI_REVIEW_URL` with your Render backend URL in that repo's secrets.

---

## GitHub OAuth App Setup

Create at [github.com/settings/developers](https://github.com/settings/developers) → OAuth Apps → New:

| Field | Dev value | Production value |
|---|---|---|
| Homepage URL | `http://localhost:5173` | `https://your-app.vercel.app` |
| Callback URL | `http://localhost:3001/auth/github/callback` | `https://your-backend.onrender.com/auth/github/callback` |
