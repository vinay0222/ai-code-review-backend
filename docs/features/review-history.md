# Feature: Review History

Every AI review is persisted to Firestore and displayed in the **Review History** table on the project's Review tab.

---

## What is Stored

Each review document in `reviews/{id}` contains:

| Field | Type | Description |
|---|---|---|
| `projectId` | string | Links to `projects/{id}` |
| `userId` | string | Project owner's Firebase UID |
| `pr_url` | string | Full GitHub PR URL |
| `pr_title` | string | PR title from GitHub |
| `summary` | string | AI-generated summary |
| `verdict` | string | `'approve'` or `'needs_changes'` |
| `issues` | array | Full issues array from the AI |
| `issues_count` | number | Total count |
| `issues_high/medium/low` | number | Per-severity counts |
| `confidence_score` | number | 0–100 |
| `prompt_mode` | string | `'strict'` or `'standard'` |
| `strictness` | string | `'low'`, `'medium'`, or `'high'` |
| `triggered_by` | string | `'manual'`, `'github_action'`, etc. |
| `auto_posted` | boolean | Whether a GitHub comment was posted |
| `createdAt` | timestamp | Firestore server timestamp |

---

## How History is Fetched

`GET /reviews/:projectId` (see [routes/reviews.md](../backend/routes/reviews.md)):
- Queries by `projectId` (single-field index)
- Filters by `userId` in-memory (security)
- Sorts by `createdAt` descending in-memory
- Returns up to `limit` (default 50) records

---

## History Table Columns

| Column | Source field |
|---|---|
| Pull Request | `pr_title`, `pr_url` |
| Verdict | `verdict` |
| Issues | `issues_high`, `issues_medium`, `issues_low` |
| Trigger | `triggered_by` |
| Date | `createdAt` |
| Actions | expand (summary), 🔧 Fix, × delete |

---

## Auto-Refresh

After a successful **manual review**, the parent `ReviewTab` increments a `refreshKey` state:
```js
setRefreshKey(k => k + 1);
```

`ReviewHistory` has `refreshKey` in its `useEffect` dependency array, so it re-fetches automatically.

---

## Delete

`DELETE /reviews/:reviewId` — verifies ownership before deleting. The review record is permanently removed from Firestore.
