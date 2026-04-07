# Frontend Deployment — Vercel

**Framework preset:** Vite
**Repo:** `github.com/vinay0222/ai-code-review-frontend`
**Build command:** `npm run build`
**Output directory:** `dist`
**Config file:** `frontend/vercel.json`

---

## vercel.json

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

This is the standard SPA rewrite rule — all paths are served by `index.html` and handled by React Router client-side.

---

## Auto-deploy

Vercel auto-deploys when code is pushed to `main`.

Preview deployments are created for every PR (if connected).

---

## Required Vercel Environment Variables

Set in **Vercel → Project → Settings → Environment Variables**:

```
VITE_API_URL           = https://ai-code-review-backend-jyab.onrender.com
VITE_FIREBASE_API_KEY  = ...
VITE_FIREBASE_AUTH_DOMAIN = ai-code-review-dashboard.firebaseapp.com
VITE_FIREBASE_PROJECT_ID  = ai-code-review-dashboard
```

After changing env vars, trigger a redeploy: Vercel Dashboard → Deployments → Redeploy.

---

## Common Issues

| Symptom | Cause | Fix |
|---|---|---|
| API calls fail in production | `VITE_API_URL` not set or wrong URL | Check env vars in Vercel |
| Firebase login broken | `VITE_FIREBASE_*` vars missing | Add them and redeploy |
| Page refreshes give 404 | Missing `vercel.json` rewrite rule | Add the rewrite to `vercel.json` |
| CORS error in browser | Backend `ALLOWED_ORIGINS` missing Vercel URL | Add Vercel URL to Render env |

---

## GitHub OAuth Callback

The OAuth callback hits the **backend** (Render), not Vercel. After completing OAuth, the backend redirects the browser to:
```
https://ai-code-review-frontend-five.vercel.app?github_connected=true
```

The frontend detects the `?github_connected=true` param and re-fetches the GitHub connection status.
