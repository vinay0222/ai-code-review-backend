# routes/auth.js — GitHub OAuth

All routes are mounted under `/auth/github/*`.

---

## GET /auth/github/url

Returns the GitHub OAuth authorization URL.

**Auth:** `requireAuth`

**Response:**
```json
{ "url": "https://github.com/login/oauth/authorize?client_id=...&state=...&scope=repo" }
```

A random CSRF nonce (`state`) is generated with `crypto.randomUUID()` and stored in Firestore `oauth_states/{nonce}` with a TTL. The frontend redirects the browser to this URL.

---

## GET /auth/github/callback

GitHub redirects here after the user authorises the app.

**Auth:** None (browser redirect)

**Query params:** `?code=...&state=...`

**Processing:**
1. Validate `state` against `oauth_states` collection (CSRF protection)
2. Exchange `code` for access token:
   ```
   POST https://github.com/login/oauth/access_token
   { client_id, client_secret, code }
   ```
3. Fetch GitHub user profile:
   ```
   GET https://api.github.com/user
   Authorization: Bearer {access_token}
   ```
4. Store in Firestore `users/{userId}`:
   ```json
   { "githubToken": "gho_...", "githubUsername": "vinay0222", "connectedAt": "..." }
   ```
5. Redirect browser to `{FRONTEND_URL}?github_connected=true`

---

## GET /auth/github/status

Returns the current GitHub connection status for the logged-in user.

**Auth:** `requireAuth`

**Response:**
```json
{
  "connected":    true,
  "githubUsername": "vinay0222",
  "connectedAt":  "2024-01-15T10:00:00Z"
}
```

Never returns the actual `githubToken`.

---

## DELETE /auth/github

Disconnects GitHub by removing `githubToken` and `githubUsername` from Firestore.

**Auth:** `requireAuth`

---

## GET /auth/github/repos

Lists all GitHub repositories accessible to the user (personal + organisation).

**Auth:** `requireAuth`

Uses the user's stored `githubToken` to call:
```
GET https://api.github.com/user/repos?per_page=100&type=all&sort=updated
```

**Response:**
```json
{
  "repos": [
    {
      "id":         12345,
      "name":       "my-repo",
      "full_name":  "vinay0222/my-repo",
      "html_url":   "https://github.com/vinay0222/my-repo",
      "owner":      "vinay0222",
      "owner_type": "User",
      "private":    false,
      "description": "..."
    }
  ]
}
```

`owner_type` is `"User"` or `"Organization"` — used by the frontend to group repos in the RepoPicker.

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `GITHUB_CLIENT_ID` | OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | OAuth App client secret |
| `GITHUB_CALLBACK_URL` | Must match exactly what is set in the GitHub App settings |
| `FRONTEND_URL` | Redirect destination after OAuth completes |

**GitHub OAuth App setup:**
- Homepage URL: your Vercel frontend URL
- Authorization callback URL: `https://your-backend.onrender.com/auth/github/callback`
