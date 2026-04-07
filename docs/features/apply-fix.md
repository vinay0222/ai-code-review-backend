# Feature: Apply Fixes with AI

Generates targeted code fixes for a PR, creates a new branch with the patched files, and opens a new pull request — all automatically.

---

## User Flow

1. User opens the **Review History** table
2. Clicks the **🔧 Fix** button on any review row
3. `FixPanel` opens below the row
4. User reads the description and clicks **"Generate & Apply Fixes"**
5. Backend fetches files, calls GPT-4o, commits fixes, opens PR
6. Panel shows a success banner with a link to the new PR + patch preview

---

## Backend Flow

See full detail in [backend/routes/apply-fix.md](../backend/routes/apply-fix.md).

**Summary:**
```
POST /apply-fix  { pr_url, project_id }
        │
        ├── Fetch PR metadata  (state check — must be open)
        ├── Fetch changed file list  (max 6, skip binary/deleted)
        ├── Fetch file contents  (max 30 KB per file)
        ├── Load review issues + project rules from Firestore  (context)
        ├── GPT-4o: fix ONLY the issues, return fixed_content per file
        ├── Generate unified diffs  (diff@5 createPatch)
        ├── GitHub Git Tree API:
        │     create blobs → create tree → create commit → create branch
        └── Create PR: "🤖 AI Patch Fix for #N — {title}"
```

---

## The Fix Prompt

The AI is instructed to:
- Fix **only** the identified issues
- **Never** rewrite unrelated code
- Preserve all formatting and indentation
- Return the **full corrected file content** (not a patch — the backend generates the diff)

This is more reliable than asking the model to generate a patch directly, because:
- Unified diff patches require exact line numbers that can shift
- The model reliably produces complete file content
- The `diff` package generates a correct unified diff from original vs fixed

---

## Branch Naming

```
ai-fix-{pull_number}-{Date.now()}
```

Example: `ai-fix-42-1712345678901`

This is unique per PR + timestamp so multiple fix attempts don't conflict.

---

## Diff Viewer (Frontend)

`DiffViewer` parses the unified diff returned by the backend:

| Line type | CSS class | Colour |
|---|---|---|
| `+++` / `---` file headers | `diff-header` | grey |
| `@@` hunk headers | `diff-hunk` | blue |
| `+` additions | `diff-add` | green |
| `-` removals | `diff-remove` | red |
| context lines | `diff-context` | normal |

The first 4 lines (file headers) are skipped — only hunks are shown.
Max height: 400px with scroll.

---

## Error Resilience

- If GitHub operations fail (create branch, create PR), the backend returns HTTP 502 **but still includes the `patches` array**. The `FixPanel` can potentially show the diffs even if the PR creation failed.
- Closed PRs are rejected with a clear 400 error (cannot apply fixes to a merged/closed PR).
- Binary files, files > 30 KB, and deleted files are silently skipped.

---

## Known Limitations

1. **Token permissions:** The user's GitHub OAuth token must have write access to the repository. Read-only tokens will fail at the "create branch" step.

2. **File size:** Files larger than 30 000 bytes are skipped. For very large files, consider refactoring them first.

3. **Context window:** Each file is truncated to 8 000 chars when sent to the AI. For large files, the AI may miss issues in the truncated portion.

4. **Correctness:** The AI-generated fixes must be reviewed by a human before merging. The new PR is intentionally created as a draft-like state for human review — it does not auto-merge.

5. **`diff` package version:** Must remain at `^5.x` (CommonJS). Upgrading to `v8+` breaks `require('diff')` because v8 is ESM-only.
