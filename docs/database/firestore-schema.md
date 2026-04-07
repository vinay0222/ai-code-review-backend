# Firestore Schema

Firebase project: `ai-code-review-dashboard`

---

## Collections

### `users/{userId}`

Stores per-user account data. Document ID = Firebase Auth UID.

```
users/
  {uid}/
    email:           string
    githubToken:     string    ← never exposed to frontend
    githubUsername:  string
    connectedAt:     timestamp
```

`githubToken` is written by the OAuth callback and read only by the backend.

---

### `projects/{projectId}`

One document per project.

```
projects/
  {projectId}/
    userId:        string      ← Firebase Auth UID (owner)
    name:          string
    repo_url:      string      ← full GitHub URL, e.g. https://github.com/owner/repo
    rules:         string[]    ← project-specific review rules
    docs:          string      ← project context text for the AI prompt
    review_config: {
      strict_mode:          boolean
      strictness:           'low' | 'medium' | 'high'
      check_edge_cases:     boolean
      check_code_structure: boolean
      check_performance:    boolean
      check_security:       boolean
      check_best_practices: boolean
      check_unit_tests:     boolean
    }
    created_at:    timestamp
```

**Indexes:** Single-field auto-index on `userId` is sufficient (queries filter by `userId` and sort in-memory).

---

### `reviews/{reviewId}`

One document per AI review run.

```
reviews/
  {reviewId}/
    projectId:       string | null   ← null for reviews without a project
    userId:          string          ← owner's Firebase UID
    pr_url:          string
    pr_title:        string | null
    summary:         string
    verdict:         'approve' | 'needs_changes'
    issues:          Issue[]         ← full array from AI response
    issues_count:    number
    issues_high:     number
    issues_medium:   number
    issues_low:      number
    confidence_score: number
    prompt_mode:     'strict' | 'standard'
    strictness:      'low' | 'medium' | 'high'
    status:          'completed'
    triggered_by:    'manual' | 'github_action' | ...
    auto_posted:     boolean
    request_id:      string
    createdAt:       timestamp
```

**Issue document shape:**
```json
{
  "category":   "logical_error | return_value | unused_variable | naming_mismatch | edge_case | code_quality | security | performance | test_coverage",
  "file":       "src/utils/auth.js",
  "line":       42,
  "severity":   "high | medium | low",
  "issue":      "Description of the problem",
  "suggestion": "How to fix it"
}
```

**Indexes:** Only a single-field index on `projectId` is needed. The `reviews.js` route filters by `userId` and sorts by `createdAt` in-memory to avoid deploying composite indexes.

---

### `oauth_states/{nonce}`

Temporary CSRF nonces for the GitHub OAuth flow.

```
oauth_states/
  {nonce}/
    userId:    string
    createdAt: timestamp
```

These are created in `GET /auth/github/url` and consumed in `GET /auth/github/callback`. Stale documents can be cleaned up manually or with a scheduled Cloud Function.

---

## Security Rules (Firestore)

The backend always uses the Firebase Admin SDK which bypasses Firestore security rules. The frontend (browser SDK) only uses Firebase Auth — it does **not** read or write Firestore directly.

> If you ever add direct Firestore access from the browser, add rules to enforce `request.auth.uid == resource.data.userId` on `projects` and `reviews`.

---

## Backup & Limits

- Firestore free tier (Spark): 1 GiB storage, 50K reads/day, 20K writes/day
- Review documents can be large (issues array with full text). Consider adding a `summary_only` variant if storage becomes a concern.
- The `issues` array is stored in full inside each review document. For projects with many large PRs, consider storing only counts and fetching on-demand.
