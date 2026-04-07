# POST /review

Core AI review route. Handles both manual reviews (from the dashboard) and automated reviews (from GitHub Actions).

---

## Request Body

```json
{
  "pr_url":       "https://github.com/owner/repo/pull/42",
  "project_id":   "firestore-doc-id",
  "triggered_by": "manual | label | comment | github_action | webhook",
  "auto_post":    true,
  "rules":        ["No console.log in production", "..."],
  "docs":         "This project uses React + TypeScript...",
  "config": {
    "strict_mode":          false,
    "strictness":           "medium",
    "check_edge_cases":     true,
    "check_code_structure": true,
    "check_performance":    false,
    "check_security":       true,
    "check_best_practices": true,
    "check_unit_tests":     false
  }
}
```

All fields except `pr_url` are optional.

---

## Response

```json
{
  "summary":          "The PR adds a login form...",
  "verdict":          "needs_changes",
  "confidence_score": 85,
  "issues": [
    {
      "category":   "edge_case",
      "file":       "src/auth/LoginForm.jsx",
      "line":       42,
      "severity":   "high",
      "issue":      "Password field is not validated...",
      "suggestion": "Add minimum length check..."
    }
  ],
  "pr_meta": {
    "owner": "vinay0222", "repo": "demo-flutter-app",
    "pull_number": 1, "commit_sha": "abc123",
    "pr_title": "Add search feature", "pr_url": "https://github.com/..."
  },
  "triggered_by":      "manual",
  "token_source":      "user",
  "auto_posted":       false,
  "skipped_duplicate": false,
  "request_id":        "uuid-v4"
}
```

---

## Processing Steps

### Step 0 — Project config hydration
When `project_id` is set and `config`/`rules`/`docs` are empty in the body, the backend fetches the project document from Firestore and fills them in. This makes auto-triggered reviews (GitHub Actions) respect the saved project settings.

```js
if (project_id && db) {
  const projectDoc = await db.collection('projects').doc(project_id).get();
  // backfill rules, docs, config from project
}
```

### Step 1 — Validation
- `pr_url` must be present
- `OPENAI_API_KEY` must be set

### Step 2 — GitHub token resolution
`resolveGitHubToken(req.userId)` — user token → server token → 401.

### Step 3 — Parse PR URL
`parsePrUrl(pr_url)` → `{ owner, repo, pull_number }`

### Step 4 — Duplicate detection
If `shouldAutoPost` is true, check for existing AI review comment in the last 5 minutes.  
Returns `{ skipped: true, skipped_duplicate: true }` if duplicate found.

### Step 5 — Fetch PR data
`fetchPrData(owner, repo, pull_number, token)` → `{ prDetails, diff }`

### Step 6 — OpenAI review
```js
openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { role: 'system', content: buildSystemPrompt(config) },
    { role: 'user',   content: buildUserPrompt(diff, rules, docs, config, prDetails) },
  ],
  response_format: { type: 'json_object' },
  temperature: 0.2,
})
```

### Step 7 — Normalise response
- Default `issues` to `[]`
- Default `summary` to `'Review complete.'`
- Default `confidence_score` to `80`
- Derive `verdict` from issue severities if model omitted it
- Add `category: 'code_quality'` default to any issue missing a category

### Step 8 — Auto-post to GitHub (if `shouldAutoPost`)
`postReviewToGitHub(...)` — posts general comment + inline diff comments.

### Step 9 — Return response

### Step 10 — Persist to Firestore `reviews` collection
```js
await db.collection('reviews').add({
  projectId, userId, pr_url, pr_title, summary, verdict,
  issues, issues_count, issues_high, issues_medium, issues_low,
  confidence_score, prompt_mode, strictness, status, triggered_by,
  auto_posted, request_id, createdAt: FieldValue.serverTimestamp()
});
```

`userId` is resolved from `req.userId` (authenticated) or by looking up the project owner in Firestore (GitHub Actions trigger).

---

## `auto_post` Logic

```
auto_post field absent:
  → true  if triggered_by !== 'manual'
  → false if triggered_by === 'manual'

auto_post field present:
  → use the provided boolean directly
```

---

## Valid `triggered_by` Values

`'manual'`, `'label'`, `'comment'`, `'github_action'`, `'webhook'`

Any other value defaults to `'manual'`.
