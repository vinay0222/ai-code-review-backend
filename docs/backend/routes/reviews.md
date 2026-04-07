# routes/reviews.js — Review History

---

## GET /reviews/:projectId

Fetch review history for a project (most recent first).

**Auth:** `requireAuth`

**Query params:**
- `limit` (optional, default 50, max 100)

**Processing:**
1. Verify the project exists and belongs to `req.userId` (ownership check)
2. Query Firestore `reviews` collection: `where('projectId', '==', projectId)`
3. Filter in-memory: `r.userId === req.userId` (security — ensures only owner sees their reviews)
4. Sort in-memory by `createdAt` descending
5. Slice to `limit`
6. Strip internal `userId` field from response

**Why in-memory sort?** To avoid needing a Firestore composite index on `(projectId, userId, createdAt DESC)` which requires manual deployment via `firestore.indexes.json`. The in-memory approach is safe for typical history sizes (< 100 records per project).

**Response:**
```json
{
  "reviews": [
    {
      "id":               "firestore-doc-id",
      "projectId":        "proj-id",
      "pr_url":           "https://github.com/...",
      "pr_title":         "Add search feature",
      "summary":          "The PR adds...",
      "verdict":          "needs_changes",
      "issues_count":     3,
      "issues_high":      1,
      "issues_medium":    1,
      "issues_low":       1,
      "confidence_score": 85,
      "prompt_mode":      "strict",
      "strictness":       "medium",
      "status":           "completed",
      "triggered_by":     "github_action",
      "auto_posted":      true,
      "createdAt":        "2024-01-15T10:00:00Z"
    }
  ],
  "total": 1
}
```

---

## DELETE /reviews/:reviewId

Delete a review record.

**Auth:** `requireAuth`

Fetches the document and verifies `data.userId === req.userId` before deleting. Returns 404 if not found, 403 if it belongs to another user.
