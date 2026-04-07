# Feature: GitHub Integration

---

## GitHub OAuth Flow

Users connect their GitHub account to enable:
- Reviewing private repositories
- Posting comments on PRs
- Setting up GitHub Action workflows
- Applying AI fixes (creating branches + PRs)

### Flow Diagram

```
User clicks "Connect GitHub"
        │
        ▼
frontend: GET /auth/github/url  (requires Firebase auth)
        │
        ▼
backend: generate state nonce, store in oauth_states/{nonce}
         return { url: "https://github.com/login/oauth/authorize?client_id=...&state=..." }
        │
        ▼
frontend: window.location.href = url
        │
        ▼
GitHub: user authorises → redirects to GITHUB_CALLBACK_URL
        │
        ▼
backend: GET /auth/github/callback?code=...&state=...
  1. Validate state nonce (CSRF check)
  2. POST https://github.com/login/oauth/access_token → access_token
  3. GET https://api.github.com/user → { login: 'vinay0222', ... }
  4. Firestore: users/{userId} = { githubToken, githubUsername, connectedAt }
  5. Redirect → FRONTEND_URL?github_connected=true
        │
        ▼
frontend: sees ?github_connected=true, re-fetches status
```

### Required Env Vars

```
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_CALLBACK_URL=https://your-backend.onrender.com/auth/github/callback
FRONTEND_URL=https://your-frontend.vercel.app
```

---

## Token Storage and Usage

| Location | What is stored | Who accesses it |
|---|---|---|
| Firestore `users/{uid}.githubToken` | User's OAuth access token | Backend only |
| `process.env.GITHUB_TOKEN` | Server-level PAT | Backend only (fallback) |
| Frontend memory | **Nothing** — token is never sent to browser | — |

The token is used by `resolveGitHubToken(userId)` in every route that calls GitHub.

---

## GitHub Scope

The OAuth app requests `scope=repo`. This grants:
- Read/write access to public and private repositories
- Read access to organisation repos (if user approves)
- Ability to create branches, commits, and PRs

---

## Posting Review Comments

`POST /comment` (or auto-post from `POST /review`):

1. **General comment** on the PR issue thread:
   ```
   POST /repos/{owner}/{repo}/issues/{pull_number}/comments
   { "body": "## 🤖 AI Code Review\n..." }
   ```

2. **Inline diff comments** (best-effort, one per issue with a valid file + line):
   ```
   POST /repos/{owner}/{repo}/pulls/{pull_number}/comments
   { "body": "...", "commit_id": "...", "path": "...", "line": 42, "side": "RIGHT" }
   ```
   A 422 (invalid line) is swallowed silently.

### Duplicate Detection

Before auto-posting, `isDuplicateReview()` fetches the last 10 PR comments and looks for the marker `## 🤖 AI Code Review` within the last 5 minutes. If found, the review is skipped with `skipped_duplicate: true`.

---

## Repository Picker

`GET /auth/github/repos` → `{ repos[] }`

Used by `ProjectForm` to let users select from their connected repos instead of typing a URL. Repos are grouped into **Personal** and **Organisation** sections and filtered in real time by search.
