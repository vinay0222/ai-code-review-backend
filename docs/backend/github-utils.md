# backend/github.js

Shared GitHub API utilities used by `review.js`, `comment.js`, and `applyFix.js`.

> **Rule:** All GitHub API calls should go through this module or the equivalent helpers in `applyFix.js`. Never call the GitHub API inline inside a route.

---

## Exports

```js
module.exports = {
  parsePrUrl,
  ghHeaders,
  fetchPrData,
  isDuplicateReview,
  buildGeneralComment,
  postReviewToGitHub,
  postGeneralComment,
  tryInlineComment,
};
```

---

## parsePrUrl(url)

```js
parsePrUrl('https://github.com/owner/repo/pull/42')
// → { owner: 'owner', repo: 'repo', pull_number: 42 }
```

Throws a descriptive `Error` if the URL does not match `github.com/{owner}/{repo}/pull/{number}`.

---

## ghHeaders(accept?, token?)

Returns the standard GitHub API request headers object.

```js
ghHeaders('application/vnd.github.v3+json', token)
// → { Accept: '...', Authorization: 'Bearer ...', 'User-Agent': 'AI-Code-Review-Tool/1.0' }
```

Two media types are used:
- `application/vnd.github.v3+json` — for metadata (PR details, comments)
- `application/vnd.github.v3.diff` — for fetching the unified diff text

---

## fetchPrData(owner, repo, pull_number, token)

Fetches PR metadata and the unified diff **in parallel** using `Promise.all`.

```js
const { prDetails, diff } = await fetchPrData(owner, repo, pull_number, token);
```

- `prDetails` — full GitHub PR JSON object (title, state, head.sha, base.ref, user.login, etc.)
- `diff` — unified diff string (raw text, not JSON-parsed)

The diff request uses `transformResponse: [(data) => data]` to prevent axios from JSON-parsing the plain-text diff.

---

## isDuplicateReview(owner, repo, pull_number, token, windowMs?)

Checks whether an AI review comment was already posted within the last `windowMs` milliseconds (default 5 minutes).

```js
const isDupe = await isDuplicateReview(owner, repo, pull_number, token);
```

Detection marker: `## 🤖 AI Code Review` — this string must appear in the posted comment body (see `buildGeneralComment`). Never remove or rename it.

**Fails silently** — returns `false` if the check itself throws, so a failed duplicate check never blocks a review.

---

## buildGeneralComment(summary, confidence_score, issues, pr_title, triggered_by)

Builds the markdown body for the main PR summary comment. Includes:
- Dedup marker (`## 🤖 AI Code Review`)
- Summary text
- Confidence score
- Trigger type (if not manual)
- Issue count pills (🔴 high · 🟡 medium · 🟢 low)
- Each issue as a formatted card

---

## postReviewToGitHub(opts)

Posts the full review: general summary comment + inline diff comments (best-effort).

```js
const result = await postReviewToGitHub({
  owner, repo, pull_number, commit_sha, pr_title,
  summary, confidence_score, issues, triggered_by,
  token,
});
// result → { general_comment_url, inline_posted, inline_skipped }
```

Inline comments use `POST /repos/{owner}/{repo}/pulls/{pull_number}/comments` with `side: 'RIGHT'`.  
A 422 from GitHub (invalid line) is swallowed silently — other errors are logged as warnings.

---

## Constants

| Constant | Value | Purpose |
|---|---|---|
| `DEDUP_MARKER` | `'## 🤖 AI Code Review'` | Identifies AI review comments for dedup check |
| `DEDUP_WINDOW` | `5 * 60 * 1000` (5 min) | Time window for duplicate detection |
| `SEVERITY_EMOJI` | `{ high: '🔴', medium: '🟡', low: '🟢' }` | Used in comment formatting |
