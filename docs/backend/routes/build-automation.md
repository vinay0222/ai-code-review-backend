# Build automation — Flutter CI

Routes for generating and pushing `.github/workflows/flutter-build.yml`, persisting settings on the project, and reading GitHub Actions status.

---

## POST /setup-build-workflow

Creates or updates the workflow file in the target repository via the [GitHub Contents API](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents).

**Auth:** `requireAuth` + user GitHub OAuth token with repo write access.

**Body:**

```json
{
  "repo": "owner/repo",
  "project_id": "optional-firestore-id",
  "enabled": true,
  "branches": ["main", "develop"],
  "android": {
    "apk_name_format": "app-{run}-{branch}"
  },
  "windows": {
    "enabled": false,
    "exe_name_format": "app-{run}-{branch}"
  },
  "fallback_on_push_failure": true,
  "auto_merge_fallback_pr": false
}
```

- **`enabled`:** If `false`, the workflow only runs on `workflow_dispatch` (no push triggers).
- **`branches`:** Used in `on.push.branches` when `enabled` is true.
- **Name formats:** Tokens `{run}`, `{run_number}`, `{branch}`, `{sha}`, `{short_sha}` are expanded into the generated bash (see `backend/lib/flutterBuildWorkflow.js`).
- **Fallback options:** when `fallback_on_push_failure` is true, direct push errors can auto-open a PR; with `auto_merge_fallback_pr`, backend also attempts to merge that PR.

**Success (HTTP 200):**

```json
{
  "success": true,
  "action": "created" | "updated",
  "file_url": "https://github.com/...",
  "commit_url": "https://github.com/...",
  "file_path": ".github/workflows/flutter-build.yml",
  "message": "...",
  "build_automation": { ... },
  "workflow_yaml": "...",
  "fallback": {
    "enabled": true,
    "used": false
  }
}
```

If `project_id` is provided and the project belongs to the user, `build_automation` is written to `projects/{projectId}`.

**Push failure (HTTP 200, same pattern as `setup-workflow`):** `success: false`, `push_failed: true`, `reason`, optional `details: string[]`, and `workflow_yaml` for manual copy.

If fallback PR succeeds, response stays `success: true` with:

```json
{
  "action": "fallback_pr_created" | "fallback_pr_merged",
  "fallback": {
    "enabled": true,
    "used": true,
    "pr_url": "https://github.com/owner/repo/pull/123",
    "pr_number": 123,
    "branch": "ai-build-workflow-...",
    "base": "main",
    "auto_merge_requested": true,
    "auto_merge": {
      "merged": true | false,
      "message": "..."
    }
  }
}
```

---

## GET /auth/github/build-status

Returns the latest GitHub Actions run for the Flutter build workflow (by workflow file path) and artifact metadata.

**Implementation:** `routes/auth.js` → `lib/githubFlutterBuildStatus.js`.

**Auth:** `requireAuth` + GitHub token.

**Query:**

| Param | Required | Description |
|--------|----------|-------------|
| `repo` | yes | `owner/repo` |
| `project_id` | no | If set, ownership is checked and stored `build_automation` from Firestore is included as `stored_config`. |

**Response (abbreviated):**

```json
{
  "repo": "owner/repo",
  "workflow_file": ".github/workflows/flutter-build.yml",
  "workflow_name": "Flutter Build",
  "workflow_installed": true,
  "stored_config": { ... } | null,
  "latest": {
    "id": 123,
    "status": "completed",
    "conclusion": "success",
    "html_url": "https://github.com/...",
    "run_number": 42,
    "head_branch": "main",
    "head_sha": "...",
    "head_sha_short": "abcdefg",
    "created_at": "...",
    "display_title": "...",
    "event": "push"
  },
  "artifacts": [
    {
      "name": "android-apk-main",
      "size_in_bytes": 12345,
      "expired": false,
      "archive_download_url": "https://api.github.com/..."
    }
  ],
  "hint": null
}
```

`archive_download_url` requires authorization to download; the UI links users to the run page for artifacts.

---

## Branch list (shared with auth)

Branch names for the Build UI use **`GET /auth/github/branches?repo=owner/repo`** (see `routes/auth.js`).

---

## Implementation files

| File | Role |
|------|------|
| `backend/lib/flutterBuildWorkflow.js` | YAML generator |
| `backend/lib/githubFlutterBuildStatus.js` | Flutter Actions status JSON |
| `backend/routes/buildAutomation.js` | `POST /setup-build-workflow` |
| `backend/routes/auth.js` | `GET /auth/github/branches`, `GET /auth/github/build-status` |
| `backend/server.js` | Registers routers |
