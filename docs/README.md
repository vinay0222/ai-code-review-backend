# AI Code Review — Documentation Index

> **Read this file first before making any change to the codebase.**
> Every folder below maps directly to a part of the implementation.

---

## Repository Layout

```
ai-code-review/
├── backend/          → Node.js / Express API server (deployed on Render)
├── frontend/         → React / Vite SPA (deployed on Vercel)
├── docs/             → This folder — comprehensive implementation docs
└── README.md         → Quick-start instructions
```

The two sub-projects are **independent git repositories** that are deployed separately.

---

## Documentation Map

| Folder | What it covers |
|---|---|
| [`architecture/`](./architecture/overview.md) | System design, tech stack, request flow |
| [`backend/`](./backend/README.md) | All server-side modules, routes, middleware |
| [`frontend/`](./frontend/README.md) | React components, contexts, API helpers |
| [`features/`](./features/ai-review.md) | End-to-end feature walkthroughs |
| [`database/`](./database/firestore-schema.md) | Firestore collections and document shapes |
| [`deployment/`](./deployment/README.md) | Render + Vercel setup, all env variables |

---

## Quick Feature Index

| Feature | Backend route | Frontend component | Doc |
|---|---|---|---|
| Run AI review | `POST /review` | `ReviewTab` | [features/ai-review.md](./features/ai-review.md) |
| Strict / Standard mode | `prompts.js` | `ConfigTab` | [features/ai-review.md](./features/ai-review.md) |
| GitHub OAuth | `GET /auth/github/url` → callback | `GitHubContext` | [features/github-integration.md](./features/github-integration.md) |
| Post review to GitHub | `POST /comment` | `ReviewTab` button | [features/github-integration.md](./features/github-integration.md) |
| Auto workflow setup | `POST /setup-workflow` | `AutoReviewCard` | [features/auto-workflow.md](./features/auto-workflow.md) |
| Review history | `GET /reviews/:projectId` | `ReviewHistory` | [features/review-history.md](./features/review-history.md) |
| Apply fixes with AI | `POST /apply-fix` | `FixPanel` + `DiffViewer` | [features/apply-fix.md](./features/apply-fix.md) |

---

## Key Design Decisions

1. **Two separate repos** — `backend/` and `frontend/` are independent git repos. This allows separate deployment pipelines (Render for backend, Vercel for frontend).

2. **Firebase for auth + storage** — Firebase Auth handles Email/Password login. Firestore stores projects, users, OAuth state, and review history. The Admin SDK runs exclusively on the backend; the browser SDK runs only on the frontend.

3. **Per-user GitHub tokens** — Users connect their GitHub account via OAuth. The token is stored encrypted in Firestore per user. The backend uses this token for all GitHub API calls, falling back to the server-level `GITHUB_TOKEN` for unauthenticated callers (GitHub Actions).

4. **Modular prompt system** — All AI prompt logic lives in `backend/prompts.js`. Two modes: **strict** (6-point analysis, never skips issues) and **standard** (balanced expert review). Both modes are dynamic — they adapt to the project's `review_config` checkboxes and `strictness` level.

5. **Auto-trigger hydration** — When GitHub Actions calls `POST /review` without a Firebase token, the backend looks up the project's config (rules, docs, review_config) from Firestore using `project_id` and applies it to the prompt. This means auto-triggered reviews honour the saved project settings.
