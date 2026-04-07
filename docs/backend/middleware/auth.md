# backend/middleware/auth.js

Three exports: two Express middleware functions and one utility.

---

## requireAuth

```js
const { requireAuth } = require('../middleware/auth');
router.post('/', requireAuth, handler);
```

- Reads `Authorization: Bearer <firebase_id_token>` header
- Calls `admin.auth().verifyIdToken(token)`
- On success: sets `req.userId` and `req.userEmail`, calls `next()`
- On failure: returns `401 { error: '...' }`

**Used on:** `/projects`, `/comment`, `/setup-workflow`, `/reviews`, `/apply-fix`

---

## optionalAuth

Like `requireAuth` but **never rejects**. If the header is absent or the token is invalid, the request continues with `req.userId === undefined`.

```js
router.post('/', optionalAuth, handler);
// handler can check: if (!req.userId) { /* anonymous caller */ }
```

**Used on:** `POST /review` — supports both logged-in users (manual review) and GitHub Actions (automated, no Firebase session).

---

## resolveGitHubToken(userId)

```js
const { token, source } = await resolveGitHubToken(req.userId);
```

**Priority:**
1. `users/{userId}.githubToken` from Firestore (user's personal OAuth token)
2. `process.env.GITHUB_TOKEN` (server-level fallback)
3. `{ token: null, source: null }` if neither is set

**`source`** is one of `'user' | 'server' | null` — logged for diagnostics.

### When is `null` returned?

- User is not authenticated AND `GITHUB_TOKEN` env var is not set
- In this case the calling route should return 401

### Security note

The GitHub token is **never sent to the frontend**. It lives exclusively in Firestore and/or env vars, and is only attached to server-side HTTP requests to `api.github.com`.
