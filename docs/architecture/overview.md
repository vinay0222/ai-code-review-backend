# Architecture Overview

## System Diagram

```
Browser (React SPA — Vercel)
        │
        │  HTTPS + Firebase ID Token
        ▼
Express API Server (Render)
        │
        ├──► Firebase Admin SDK ──► Firestore (projects, users, reviews)
        ├──► OpenAI API           (GPT-4o)
        └──► GitHub REST API      (diffs, comments, branches, PRs)

GitHub Actions (automated trigger)
        │
        │  HTTP POST (no auth token)
        ▼
Express API Server  →  looks up project config via project_id
                    →  uses server GITHUB_TOKEN env var
```

---

## Tech Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| Frontend | React | 18 | UI |
| Frontend build | Vite | 5 | Dev server + bundler |
| Frontend hosting | Vercel | — | CDN + edge network |
| Backend runtime | Node.js | 18+ | Server |
| Backend framework | Express | 4 | HTTP routing |
| Backend hosting | Render | — | Web service |
| AI | OpenAI API | GPT-4o | Code review + fix generation |
| Auth | Firebase Auth | v9 (web SDK) | Email/Password login |
| Database | Firebase Firestore | — | Persistent storage |
| GitHub OAuth | GitHub OAuth Apps | — | Per-user GitHub access |
| HTTP client | axios | — | GitHub API calls (backend) |
| Diff generation | diff | v5 (CJS) | Unified patch preview |
| Rate limiting | express-rate-limit | — | Global + per-route limits |

> **Important — `diff` package version:** Must be `v5.x` (CommonJS). `v8+` switched to ESM and breaks `require('diff')`. The `package.json` pins `"diff": "^5.2.2"`.

---

## Request Authentication Flow

```
Frontend                    Backend
   │
   │  1. Firebase login
   │     (email/password)
   │
   │  2. getIdToken()       ──────────────────────────────►
   │                         requireAuth middleware
   │                         admin.auth().verifyIdToken(token)
   │                         → req.userId, req.userEmail
   │
   │  3. API call with token ──────────────────────────────►
   │     Authorization: Bearer <firebase_id_token>
   │
   │                         resolveGitHubToken(req.userId)
   │                         → Firestore users/{userId}.githubToken
   │                         → OR process.env.GITHUB_TOKEN (fallback)
   │
   │  4. GitHub API call ─────────────────────────────────►
   │                         github.com/api/v3
```

### Authentication middleware variants

| Middleware | Used on | Behaviour |
|---|---|---|
| `requireAuth` | `/projects`, `/comment`, `/setup-workflow`, `/reviews`, `/apply-fix` | Returns 401 if no valid Firebase token |
| `optionalAuth` | `/review` | Populates `req.userId` if token present, continues anonymously if not |

---

## GitHub Token Resolution

`resolveGitHubToken(userId)` in `middleware/auth.js`:

1. If `userId` is set → fetch `users/{userId}.githubToken` from Firestore
2. Else → use `process.env.GITHUB_TOKEN` (server-level fallback)
3. If neither → return `{ token: null }` → caller returns 401

This allows:
- **Logged-in users** — use their own GitHub token (OAuth)
- **GitHub Actions** — use the server-level token (no Firebase session)

---

## Data Flow: Manual Review

```
User pastes PR URL → clicks "Run AI Review"
        │
        ▼
POST /review
  ├── optionalAuth (attach userId if logged in)
  ├── project config hydration (fetch from Firestore if project_id present)
  ├── resolveGitHubToken
  ├── parsePrUrl → { owner, repo, pull_number }
  ├── isDuplicateReview (skip if already reviewed in last 5 min)
  ├── fetchPrData → { prDetails, diff }
  ├── buildSystemPrompt(config) → strict or standard mode
  ├── buildUserPrompt(diff, rules, docs, config, prDetails)
  ├── OpenAI GPT-4o → { summary, verdict, confidence_score, issues[] }
  ├── normalise (derive verdict if missing, add category defaults)
  ├── (optional) postReviewToGitHub if auto_post=true
  ├── save to Firestore reviews collection
  └── return response to frontend
```

## Data Flow: GitHub Actions Auto-trigger

```
PR opened/updated on GitHub
        │
        ▼
GitHub Actions runs ai-review.yml
  curl -X POST /review
    { "pr_url": "...", "project_id": "...", "triggered_by": "github_action" }
        │
        ▼
POST /review (no Firebase token)
  ├── optionalAuth → req.userId = undefined
  ├── project config hydration:
  │     db.collection('projects').doc(project_id).get()
  │     → rules, docs, review_config (including strict_mode)
  ├── resolveGitHubToken(undefined) → server GITHUB_TOKEN
  ├── ... (same review flow) ...
  ├── auto_post = true → postReviewToGitHub
  ├── save to Firestore:
  │     userId resolved from project owner (not from token)
  └── return response (GitHub Actions logs it)
```
