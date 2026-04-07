# Environment Variables

---

## Backend (Render)

Set these in **Render → your service → Environment**.

| Variable | Required | Example / Notes |
|---|---|---|
| `PORT` | No | Render sets this automatically |
| `NODE_ENV` | No | `production` |
| `LOG_LEVEL` | No | `info` |
| `ALLOWED_ORIGINS` | **Yes** | `https://ai-code-review-frontend-five.vercel.app` |
| `BACKEND_URL` | No | `https://ai-code-review-backend-jyab.onrender.com` — embedded in generated workflow YAMLs |
| `OPENAI_API_KEY` | **Yes** | `sk-...` — from platform.openai.com |
| `GITHUB_CLIENT_ID` | **Yes** | From GitHub → Settings → Developer Settings → OAuth Apps |
| `GITHUB_CLIENT_SECRET` | **Yes** | Same location |
| `GITHUB_CALLBACK_URL` | **Yes** | `https://ai-code-review-backend-jyab.onrender.com/auth/github/callback` |
| `FRONTEND_URL` | **Yes** | `https://ai-code-review-frontend-five.vercel.app` |
| `GITHUB_TOKEN` | Recommended | Server-level PAT — used for GitHub Actions auto-reviews and as fallback |
| `FIREBASE_PROJECT_ID` | **Yes** | `ai-code-review-dashboard` |
| `FIREBASE_CLIENT_EMAIL` | **Yes** | From Firebase service account JSON |
| `FIREBASE_PRIVATE_KEY` | **Yes** | **See note below** |

### FIREBASE_PRIVATE_KEY — Render Setup

1. Open the service account JSON file
2. Copy the `private_key` value (the multi-line string between `-----BEGIN/END PRIVATE KEY-----`)
3. In Render, paste it as a single string with real newlines (do **not** wrap in quotes, do **not** escape `\n` — Render stores it verbatim)
4. The `backend/firebase.js` `parsePrivateKey()` function handles normalisation

Common mistake: pasting with `"` surrounding quotes or `\\n` double-escaped newlines → Firebase init fails with `DECODER routines::unsupported`.

---

## Frontend (Vercel)

Set these in **Vercel → your project → Settings → Environment Variables**.

| Variable | Required | Value |
|---|---|---|
| `VITE_API_URL` | **Yes** | `https://ai-code-review-backend-jyab.onrender.com` |
| `VITE_FIREBASE_API_KEY` | **Yes** | From Firebase Console → Project Settings → General → Your apps |
| `VITE_FIREBASE_AUTH_DOMAIN` | **Yes** | `ai-code-review-dashboard.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | **Yes** | `ai-code-review-dashboard` |

These are baked into the JavaScript bundle at build time. **Never put secrets in `VITE_*` variables.**

---

## Local Development (`.env` files)

### `backend/.env` (never commit)
```env
PORT=3001
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:5173
OPENAI_API_KEY=sk-...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_CALLBACK_URL=http://localhost:3001/auth/github/callback
FRONTEND_URL=http://localhost:5173
GITHUB_TOKEN=ghp_...
FIREBASE_PROJECT_ID=ai-code-review-dashboard
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

### `frontend/.env` (never commit)
```env
VITE_API_URL=
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=ai-code-review-dashboard.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=ai-code-review-dashboard
```

`VITE_API_URL` is intentionally empty in dev — Vite's proxy handles all `/api` calls to `localhost:3001`.
