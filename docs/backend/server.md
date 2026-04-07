# backend/server.js

The main Express application. Handles global middleware, route mounting, and the health endpoint.

---

## Startup Order

```
1. require('dotenv').config()          ← load .env
2. require('./firebase')               ← MUST be first (Admin SDK init before any route uses db)
3. express app created
4. CORS middleware
5. express.json() body parser
6. globalLimiter (rate limit)
7. request logger
8. Routes mounted
9. Health endpoint
10. Global error handler
11. app.listen(PORT, '0.0.0.0')
```

> Firebase must be initialised before routes are imported because routes do
> `require('../firebase')` at module load time.

---

## CORS

```js
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
  .split(',').map(o => o.trim()).filter(Boolean);
```

- Requests with **no `Origin`** header (server-to-server, GitHub Actions curl, Render health checks) are **always allowed**.
- Browser requests must come from an origin in `ALLOWED_ORIGINS`.
- In production: set `ALLOWED_ORIGINS=https://ai-code-review-frontend-five.vercel.app` in Render env vars.

---

## Routes Mounted

```js
app.use('/projects',       projectsRouter);
app.use('/review',         reviewRouter);
app.use('/comment',        commentRouter);
app.use('/auth/github',    authRouter);       // all OAuth routes under /auth/github/*
app.use('/setup-workflow', setupWorkflowRouter);
app.use('/reviews',        reviewsRouter);
app.use('/apply-fix',      applyFixRouter);
```

---

## Health Endpoint

`GET /health`

Returns:
```json
{
  "status": "ok",
  "uptime": 1234,
  "services": {
    "openai":       true,
    "github_oauth": true,
    "github_token": true,
    "firebase":     true
  }
}
```

Each `services` flag simply checks whether the corresponding env var is set — it does not make a live API call.

---

## Global Error Handler

```js
app.use((err, _req, res, _next) => {
  logger.error('http.unhandled_error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});
```

---

## Environment Variables Used

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | No | `3001` | Listen port |
| `NODE_ENV` | No | `development` | Env label in logs |
| `ALLOWED_ORIGINS` | No | `http://localhost:5173` | CORS allowlist |
| `BACKEND_URL` | No | — | Logged at startup (used in workflow YAML generation) |
| All service keys | See [env-variables.md](../deployment/environment-variables.md) | — | — |
