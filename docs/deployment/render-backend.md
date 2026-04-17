# Backend Deployment — Render

**Service type:** Web Service
**Runtime:** Node.js
**Repo:** `github.com/vinay0222/ai-code-review-backend`
**Config file:** `backend/render.yaml`

---

## render.yaml

```yaml
services:
  - type: web
    name: ai-code-review-backend
    env: node
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
```

The `start` script in `package.json` is `node server.js`.

> `render.yaml` must be at the **root of the repo** (which is the `backend/` directory, since it's a separate repo).

---

## Auto-deploy

Render auto-deploys when code is pushed to the `main` branch.

**Critical:** If the deployment fails (e.g. bad env var, module not found), Render keeps the **previous deployment** running. The old code serves requests, which can cause confusing "route not found" errors for newly added routes.

**To force a fresh deploy:** Render Dashboard → Manual Deploy → Clear Build Cache & Deploy.

---

## Common Deployment Issues

| Symptom | Cause | Fix |
|---|---|---|
| New routes return 404 | Old deployment still running after a crash | Check Render logs; fix the crash and redeploy |
| Build tab calls **404** on old paths | Older clients used `/build-status` at API root | Deploy frontend + backend with `/auth/github/build-status`; verify `curl …/auth/github/build-status` → **401** |
| `ERR_REQUIRE_ESM` | A dependency switched to ESM-only | Pin the dependency to a CJS-compatible version |
| Firebase auth error at startup | `FIREBASE_PRIVATE_KEY` formatting wrong | Re-paste without surrounding quotes |
| `CORS blocked` in browser | `ALLOWED_ORIGINS` missing the frontend URL | Add Vercel URL to `ALLOWED_ORIGINS` in Render env |

---

## Local Vite UI + Render backend

Use this when `VITE_API_URL` in `frontend/.env` points at your Render service (real API) while the app runs at `http://localhost:5173`.

1. **Render → Environment → `ALLOWED_ORIGINS`**  
   Use a **comma-separated** list that includes **both** your production frontend and local Vite, for example:  
   `https://your-app.vercel.app,http://localhost:5173`  
   Redeploy (or restart) so CORS preflight succeeds.

2. **`FRONTEND_URL` on Render** can stay your production URL. After GitHub OAuth, the backend redirects using the **`Origin`** captured when OAuth started (must match an entry in `ALLOWED_ORIGINS`), so you return to localhost when you connected from localhost.

3. **GitHub OAuth app**  
   The **Authorization callback URL** must remain the **Render** URL, e.g. `https://ai-code-review-backend-jyab.onrender.com/auth/github/callback` — not localhost.

---

## Checking Logs

Render Dashboard → your service → **Logs** tab.

Startup log (healthy):
```
🚀 AI Code Review server running on port 10000
   Environment:     production
   Allowed origins: https://ai-code-review-frontend-five.vercel.app
   OpenAI key:      ✅ set
   GitHub OAuth:    ✅ configured
   GitHub token:    ✅ set (server fallback)
   Firebase:        ✅ configured
```

If any item shows ❌ or ⚠️, check the corresponding env var.
