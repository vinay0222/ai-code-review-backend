# routes/setupWorkflow.js

Manages GitHub Actions workflow files in user repositories.

---

## POST /setup-workflow

Generates and pushes the AI review workflow YAML to a target repository.

**Auth:** `requireAuth`

**Request Body:**
```json
{
  "repo":       "owner/repo",
  "project_id": "firestore-doc-id"
}
```

`repo` is normalised by `normaliseSlug()` which strips:
- `https://github.com/` prefix
- `.git` suffix
- trailing slashes

**What the generated workflow does:**
- Triggers on `pull_request` types: `opened`, `synchronize`, `reopened`
- Calls `POST {backendUrl}/review` with the `project_id` embedded
- Uses `continue-on-error: true` so it never blocks the PR
- Logs the response body and HTTP status

**Workflow generation (`generateWorkflow` function):**
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
          RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "{backendUrl}/review" \
            -H "Content-Type: application/json" \
            -d '{
              "project_id": "{projectId}",
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

**Push mechanism (GitHub Contents API):**
1. Check if `.github/workflows/ai-review.yml` already exists → get its `sha` for update
2. `PUT /repos/{owner}/{repo}/contents/.github/workflows/ai-review.yml`
   ```json
   { "message": "...", "content": "<base64>", "sha": "existing-sha-or-omit" }
   ```

**Response (success):**
```json
{
  "success":   true,
  "message":   "Workflow file pushed successfully.",
  "file_url":  "https://github.com/owner/repo/blob/main/.github/workflows/ai-review.yml",
  "file_path": ".github/workflows/ai-review.yml"
}
```

**Response (push failed — fallback):**

When the push fails (e.g. token lacks write access), the route returns **HTTP 200** with `push_failed: true` and the YAML content so the frontend can offer a manual copy/download:

```json
{
  "success":       false,
  "push_failed":   true,
  "reason":        "Repository not found or token lacks write access",
  "workflow_yaml": "name: AI Code Review\n...",
  "file_path":     ".github/workflows/ai-review.yml"
}
```

---

## GET /setup-workflow/status

Check whether the workflow file already exists in a repo.

**Auth:** `requireAuth`

**Query:** `?repo=owner/repo`

**Response:**
```json
{
  "exists":   true,
  "file_url": "https://github.com/owner/repo/blob/main/.github/workflows/ai-review.yml"
}
```

The frontend calls this on mount to persist the "workflow enabled" state across page refreshes — without this, the UI would always show "Enable" even after setup.

---

## Important: project_id in workflow

The `project_id` is embedded directly in the generated YAML. This is critical because:
- GitHub Actions calls `/review` with no Firebase auth token
- The backend uses `project_id` to look up the project owner (to save the review to the right user's history) and to load the project config (strict mode, rules, docs)
- Without `project_id`, auto-triggered reviews would be saved as orphaned records
