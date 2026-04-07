# Backend — Module Index

**Location:** `backend/`
**Deployment:** Render (Node.js web service)
**Entry point:** `backend/server.js`
**Port:** `process.env.PORT` (defaults to `3001` in dev)

---

## File Map

```
backend/
├── server.js                  ← Express app, CORS, route mounting, global middleware
├── firebase.js                ← Firebase Admin SDK init (non-fatal startup)
├── logger.js                  ← Structured JSON logger
├── github.js                  ← GitHub API utilities (shared across routes)
├── prompts.js                 ← AI prompt builders (strict / standard mode)
│
├── middleware/
│   ├── auth.js                ← requireAuth, optionalAuth, resolveGitHubToken
│   └── rateLimiter.js         ← express-rate-limit configs
│
└── routes/
    ├── projects.js            ← CRUD for projects
    ├── review.js              ← POST /review (core AI review flow)
    ├── comment.js             ← POST /comment (manual GitHub comment post)
    ├── auth.js                ← GitHub OAuth flow + status/disconnect
    ├── setupWorkflow.js       ← POST /setup-workflow + GET /status
    ├── reviews.js             ← GET /reviews/:projectId, DELETE /reviews/:id
    └── applyFix.js            ← POST /apply-fix (AI patch + PR creation)
```

---

## Route Summary

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Server + service health check |
| `GET` | `/projects` | Required | List user's projects |
| `POST` | `/projects` | Required | Create project |
| `PUT` | `/projects/:id` | Required | Update project (rules/docs/config) |
| `DELETE` | `/projects/:id` | Required | Delete project |
| `POST` | `/review` | Optional | Run AI review on a PR |
| `POST` | `/comment` | Required | Manually post review to GitHub |
| `GET` | `/auth/github/url` | Required | Get GitHub OAuth redirect URL |
| `GET` | `/auth/github/callback` | None | OAuth callback (exchange code for token) |
| `GET` | `/auth/github/status` | Required | Check if GitHub is connected |
| `DELETE` | `/auth/github` | Required | Disconnect GitHub |
| `GET` | `/auth/github/repos` | Required | List user's GitHub repos |
| `POST` | `/setup-workflow` | Required | Push AI review workflow to a repo |
| `GET` | `/setup-workflow/status` | Required | Check if workflow exists |
| `GET` | `/reviews/:projectId` | Required | Fetch review history for a project |
| `DELETE` | `/reviews/:reviewId` | Required | Delete a review record |
| `POST` | `/apply-fix` | Required | Generate AI fixes and open a PR |

---

## Module Docs

- [server.js](./server.md)
- [prompts.js](./prompts.md)
- [github.js](./github-utils.md)
- [firebase.js](./firebase.md)
- [logger.js](./logger.md)
- [middleware/auth.js](./middleware/auth.md)
- [middleware/rateLimiter.js](./middleware/rate-limiter.md)
- Routes:
  - [review.md](./routes/review.md)
  - [projects.md](./routes/projects.md)
  - [auth.md](./routes/auth.md)
  - [comment.md](./routes/comment.md)
  - [setup-workflow.md](./routes/setup-workflow.md)
  - [reviews.md](./routes/reviews.md)
  - [apply-fix.md](./routes/apply-fix.md)
