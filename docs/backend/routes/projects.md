# routes/projects.js — Project CRUD

All routes require `requireAuth`.

---

## Document Shape (Firestore `projects/{projectId}`)

```json
{
  "userId":        "firebase-uid",
  "name":          "My React App",
  "repo_url":      "https://github.com/owner/repo",
  "rules":         ["No console.log in production", "..."],
  "docs":          "This project uses React 18 + TypeScript...",
  "review_config": {
    "strict_mode":          false,
    "strictness":           "medium",
    "check_edge_cases":     true,
    "check_code_structure": true,
    "check_performance":    false,
    "check_security":       true,
    "check_best_practices": true,
    "check_unit_tests":     false
  },
  "build_automation": {
    "enabled": true,
    "branches": ["main"],
    "android": { "apk_name_format": "app-{run}-{branch}" },
    "windows": { "enabled": false, "exe_name_format": "app-{run}-{branch}" },
    "workflow_path": ".github/workflows/flutter-build.yml",
    "workflow_name": "Flutter Build",
    "updated_at": "ISO8601 string"
  },
  "created_at": "Firestore server timestamp"
}
```

---

## GET /projects

Returns all projects for the authenticated user.

**Query:** Firestore `where('userId', '==', req.userId)` using the auto-created single-field index.

**Sort:** In-memory by `created_at` descending (avoids composite index).

---

## POST /projects

Create a project.

**Body:**
```json
{ "name": "My App", "repo_url": "https://github.com/..." }
```

Sets `userId`, `rules: []`, `docs: ''`, `review_config: {}`, `created_at`.

---

## PUT /projects/:id

Update a project. Allowed fields: `name`, `repo_url`, `rules`, `docs`, `review_config`, `build_automation`.

Verifies the document belongs to `req.userId` before updating.

---

## DELETE /projects/:id

Delete a project (ownership verified).

> Deleting a project does **not** cascade-delete its reviews. The `reviews` collection documents with that `projectId` remain but are orphaned (not visible in the UI).
