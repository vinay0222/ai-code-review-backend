# Frontend Contexts

---

## AuthContext (`contexts/AuthContext.jsx`)

Wraps the entire app. Provides the current Firebase user.

```jsx
const { currentUser } = useAuth();
```

**What it does:**
- Calls `onAuthStateChanged(auth, user => setCurrentUser(user))`
- Shows a loading spinner until Firebase resolves the initial auth state
- `currentUser` is the Firebase `User` object (or `null` if not logged in)

**Auth gate in `App.jsx`:**
```jsx
if (!currentUser) return <LoginPage />;
```

---

## GitHubContext (`contexts/GitHubContext.jsx`)

Provides GitHub connection state to any component.

```jsx
const { connected, githubUsername, connect, disconnect, loading } = useGitHub();
```

| Property | Type | Description |
|---|---|---|
| `connected` | boolean | Whether the user has connected their GitHub account |
| `githubUsername` | string \| null | The connected GitHub username (e.g. `'vinay0222'`) |
| `loading` | boolean | True while fetching status on mount |
| `connect()` | function | Fetches OAuth URL from backend, redirects browser |
| `disconnect()` | function | Calls `DELETE /auth/github`, resets state |

**On mount:** Calls `getGitHubStatus()` to check connection state. This is what populates the Navbar badge and gates the "Run AI Review" button.

**`connect()` flow:**
1. `getGitHubAuthUrl()` → `{ url }` from backend
2. `window.location.href = url` — browser redirects to GitHub

After OAuth: GitHub redirects to `/auth/github/callback` on the backend, which stores the token and redirects back to `{FRONTEND_URL}?github_connected=true`. The frontend re-fetches the status when it sees this query param.
