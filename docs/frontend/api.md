# frontend/src/api/index.js

Centralised API helper. All backend communication goes through this module.

---

## Base URL

```js
const API_BASE = import.meta.env.VITE_API_URL || '';
```

In development: `''` — requests are relative paths, handled by Vite proxy.
In production: `https://ai-code-review-backend-jyab.onrender.com`.

---

## `request(url, options)` — Internal Helper

All exported functions use this:

```js
async function request(url, options = {}) {
  const token = await getToken();   // Firebase ID token (null if not logged in)
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { headers, ...options });

  // Guard: if server returns HTML (proxy 404, Render cold-start), don't crash with JSON parse error
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    throw new Error(`Server returned HTTP ${res.status}${text.includes('Cannot') ? ` — route not found (${url})` : ''}`);
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
```

The non-JSON guard was added to prevent the confusing `"Unexpected token '<'"` error when the backend returns an HTML 404/502 page (e.g. during a deploy restart).

---

## Exported Functions

### Projects
| Function | Method | Endpoint | Auth |
|---|---|---|---|
| `getProjects()` | GET | `/projects` | Required |
| `createProject(body)` | POST | `/projects` | Required |
| `updateProject(id, body)` | PUT | `/projects/:id` | Required |
| `deleteProject(id)` | DELETE | `/projects/:id` | Required |

### Review
| Function | Method | Endpoint | Auth |
|---|---|---|---|
| `runReview(body)` | POST | `/review` | Optional |
| `postComment(body)` | POST | `/comment` | Required |

`runReview` body: `{ pr_url, project_id, rules, docs, config }`

### GitHub OAuth
| Function | Method | Endpoint | Notes |
|---|---|---|---|
| `getGitHubAuthUrl()` | GET | `/auth/github/url` | Returns `{ url }` to redirect to |
| `getGitHubStatus()` | GET | `/auth/github/status` | Returns `{ connected, githubUsername }` |
| `disconnectGitHub()` | DELETE | `/auth/github` | Removes stored token |
| `getGitHubRepos()` | GET | `/auth/github/repos` | Returns `{ repos[] }` |

### Workflow Setup
| Function | Method | Endpoint | Notes |
|---|---|---|---|
| `setupWorkflow(body)` | POST | `/setup-workflow` | Body: `{ repo, project_id }` |
| `getWorkflowStatus(repo)` | GET | `/setup-workflow/status?repo=...` | Returns `{ exists, file_url }` |

### Review History
| Function | Method | Endpoint | Notes |
|---|---|---|---|
| `getReviews(projectId)` | GET | `/reviews/:projectId` | Returns `{ reviews[] }` |
| `deleteReview(reviewId)` | DELETE | `/reviews/:reviewId` | — |

### Apply Fix
| Function | Method | Endpoint | Notes |
|---|---|---|---|
| `applyFix(body)` | POST | `/apply-fix` | Body: `{ pr_url, project_id }` |

### Build automation (Flutter CI)
| Function | Method | Endpoint | Notes |
|---|---|---|---|
| `getBuildBranches(repo)` | GET | `/auth/github/branches?repo=` | Branch names for Build UI |
| `setupBuildWorkflow(body)` | POST | `/setup-build-workflow` | Push `flutter-build.yml` + store `build_automation` (supports `fallback_on_push_failure` and `auto_merge_fallback_pr`) |
| `getBuildStatus(repo, projectId?)` | GET | `/auth/github/build-status?repo=&project_id=` | Latest run + artifacts |
