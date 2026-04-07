# ReviewTab.jsx

The main review interface. Lives inside the project detail page under the "Review" tab.

---

## Sub-components (all in the same file)

```
ReviewTab
├── GitHubWarningBanner       ← shown when GitHub is not connected
├── AutoReviewCard            ← enable/disable GitHub Action workflow
│   └── WorkflowCopyPanel     ← fallback manual copy if push fails
├── [Manual review input]     ← PR URL input + Run AI Review button
├── [Error banner]
├── [Loading spinner]
├── [Results]
│   ├── VerdictBanner         ← approve / needs_changes
│   ├── SummaryBanner         ← AI summary text
│   ├── IssueCard × N         ← one card per issue
│   └── [Post to GitHub btn]
└── ReviewHistory
    └── HistoryRow × N
        ├── [Summary expand]
        └── FixPanel          ← Apply Fixes with AI
            └── DiffViewer
```

---

## AutoReviewCard

Controls the GitHub Action workflow for the project.

**State:**
- `workflowExists` — `null` (unknown), `true` (active), `false` (not set up)
- `setupResult` — result from `POST /setup-workflow`
- `pushFailed` — true when the push failed but YAML is available for manual copy

**On mount:**
```js
useEffect(() => {
  if (!connected || !repoSlug) return;
  getWorkflowStatus(repoSlug).then(({ exists }) => setWorkflowExists(exists));
}, [connected, repoSlug]);
```

This ensures the "Active ✓" badge persists after page refresh — the state comes from GitHub (whether the file exists), not from React state.

**Repo slug normalisation:**
The `repo_url` field (e.g. `https://github.com/owner/repo.git`) is normalised to `owner/repo` by stripping the prefix, `.git` suffix, and trailing slashes.

**WorkflowCopyPanel (fallback):**
When auto-push fails (e.g. token lacks write access), `setupResult.push_failed === true` and the YAML content is in `setupResult.workflow_yaml`. `WorkflowCopyPanel` shows:
- The reason for the failure
- A copy button that puts the YAML in the clipboard
- A download button that saves it as `ai-review.yml`
- Step-by-step instructions for manual setup

---

## FixPanel

Handles the "Apply Fixes with AI" flow for a single review row.

**States:** `idle` → `loading` → `done` | `error`

**On "Generate & Apply Fixes":**
```js
const data = await applyFix({ pr_url: review.pr_url, project_id: projectId });
```

**Done state shows:**
1. Success banner with link to the new PR (`data.pr_url`)
2. File tabs (one per fixed file)
3. `DiffViewer` for the selected file

---

## DiffViewer

Parses a unified diff string and renders it with colour coding.

```
line starting with +++/---  → 'header' (grey)
line starting with @@        → 'hunk'   (blue)
line starting with +         → 'add'    (green)
line starting with -         → 'remove' (red)
all other lines              → 'context' (normal)
```

The first 4 lines of a unified diff (file headers) are skipped — only hunks are rendered.

---

## ReviewHistory

Fetches and displays `reviews[]` for `projectId`.

**Refresh trigger:** `refreshKey` state in the parent (`ReviewTab`) increments after a successful manual review, causing `ReviewHistory` to re-fetch.

**Columns:** Pull Request | Verdict | Issues (pills) | Trigger | Date | Actions

**HistoryRow actions:**
- `▼ / ▲` — expand/collapse summary
- `🔧 Fix` — toggle `FixPanel`
- `×` — delete with confirmation

---

## Issue Count Pills (SeverityPill)

```jsx
<SeverityPill count={review.issues_high}   sev="high" />   // 🔴 N
<SeverityPill count={review.issues_medium} sev="medium" />  // 🟡 N
<SeverityPill count={review.issues_low}    sev="low" />     // 🟢 N
```
