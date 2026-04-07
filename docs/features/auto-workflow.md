# Feature: Auto AI Review (GitHub Actions Workflow)

Automatically runs an AI review when a PR is opened or updated — without any manual input.

---

## Setup Flow (from the UI)

1. User opens a project → **Review** tab → **AutoReviewCard**
2. Clicks **"Enable Auto AI Review"**
3. Frontend calls `POST /setup-workflow` with `{ repo: "owner/repo", project_id: "..." }`
4. Backend generates the YAML, pushes it to `.github/workflows/ai-review.yml`

**On page load / refresh**, the `AutoReviewCard` calls `GET /setup-workflow/status?repo=owner/repo`. If the file exists on GitHub, it shows the "Active ✓" badge. This makes the state persistent across refreshes.

---

## Generated Workflow YAML

```yaml
name: AI Code Review
on:
  pull_request:
    types: [opened, synchronize, reopened]
jobs:
  ai-review:
    name: Run AI Review
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Call AI Review API
        run: |
          RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "https://backend.onrender.com/review" \
            -H "Content-Type: application/json" \
            -d '{
              "project_id": "firestore-project-id",
              "pr_url": "${{ github.event.pull_request.html_url }}",
              "triggered_by": "github_action"
            }')
          HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
          BODY=$(echo "$RESPONSE" | head -n -1)
          echo "Status: $HTTP_CODE"
          echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
          if [ "$HTTP_CODE" != "200" ]; then
            echo "::warning::AI review returned HTTP $HTTP_CODE"
          fi
        continue-on-error: true
```

Key points:
- `project_id` is **embedded at generation time** — this is what links the auto review to the correct project and user
- `continue-on-error: true` — the workflow never fails the PR check
- No GitHub secrets are needed — the server uses its own `GITHUB_TOKEN` env var
- `triggered_by: "github_action"` causes the backend to auto-post the review comment on the PR

---

## How Auto Reviews Are Saved to History

This was a critical design challenge: GitHub Actions has no Firebase auth token, so `req.userId` is `null`.

**Solution:**
1. The YAML contains `project_id`
2. When the review is saved to Firestore, if `req.userId` is null but `project_id` is set, the backend looks up `projects/{project_id}.userId` to get the owner's UID
3. The review is saved with that `userId` so it appears in the project owner's history

```js
if (!saveUserId && project_id && db) {
  const projectDoc = await db.collection('projects').doc(project_id).get();
  saveUserId = projectDoc.data().userId;
}
```

---

## Auto-trigger Config Hydration

When triggered by GitHub Actions, the `POST /review` body contains only `pr_url`, `project_id`, and `triggered_by`. The backend fetches the project document to get `rules`, `docs`, and `review_config` (including `strict_mode` and `strictness`). This ensures auto reviews honour the same settings as manual reviews.

---

## Fallback: Manual Workflow Copy

If the push to GitHub fails (e.g. the user's token lacks write access to the repo), the backend returns:
```json
{
  "success":       false,
  "push_failed":   true,
  "reason":        "Repository not found or token lacks write access",
  "workflow_yaml": "name: AI Code Review\n...",
  "file_path":     ".github/workflows/ai-review.yml"
}
```

The frontend shows a `WorkflowCopyPanel` with:
- Human-readable failure reason
- Copy-to-clipboard button
- Download as `ai-review.yml` button
- Step-by-step manual setup instructions

---

## Required GitHub Repository Permission

The user's OAuth token needs **write access** to the repository to push the workflow file. For organisation repos, the user must have at least "Maintain" permission.
