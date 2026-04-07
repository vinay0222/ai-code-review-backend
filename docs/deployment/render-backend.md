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
| `ERR_REQUIRE_ESM` | A dependency switched to ESM-only | Pin the dependency to a CJS-compatible version |
| Firebase auth error at startup | `FIREBASE_PRIVATE_KEY` formatting wrong | Re-paste without surrounding quotes |
| `CORS blocked` in browser | `ALLOWED_ORIGINS` missing the frontend URL | Add Vercel URL to `ALLOWED_ORIGINS` in Render env |

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
