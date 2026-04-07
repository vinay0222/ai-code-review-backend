# Feature: AI Code Review

End-to-end walkthrough of the core review feature.

---

## User Flow

1. User opens a project and goes to the **Review** tab
2. Pastes a GitHub PR URL (e.g. `https://github.com/owner/repo/pull/42`)
3. Clicks **Run AI Review**
4. Frontend sends `POST /review` with `pr_url`, `project_id`, `rules`, `docs`, `config`
5. Backend fetches the PR diff from GitHub, builds the prompt, calls GPT-4o
6. Results appear: **verdict banner**, **AI summary**, **issue cards**

---

## Prompt System (Modular)

All prompt logic lives in `backend/prompts.js`. See [backend/prompts.md](../backend/prompts.md) for full details.

### Two Modes

```
config.strict_mode = false  →  buildStandardSystemPrompt(config)
config.strict_mode = true   →  buildStrictSystemPrompt(config)
```

### Strict Mode — 6-Point Analysis

Always checks:
1. Logical errors
2. Incorrect return values
3. Unused variables
4. Naming mismatches

Additionally checks (based on enabled config flags):
5. Edge cases (if `check_edge_cases`)
6. Security (if `check_security`)
7. Performance (if `check_performance`)
8. Code quality (if `check_best_practices`)
9. Test coverage (if `check_unit_tests`)
10. Code structure (if `check_code_structure`)

**Key difference from standard mode:** In strict mode, the model is explicitly instructed: *"NEVER say 'looks good' or 'no issues' if ANY issue exists."*

### Strictness Depth

Both modes use `config.strictness` to set the analysis depth:
- `'low'` → critical (high severity) only
- `'medium'` → high + medium, low only when forming a pattern
- `'high'` → exhaustive, include every issue

---

## AI Response Structure

```json
{
  "summary":          "...",
  "verdict":          "approve | needs_changes",
  "confidence_score": 0-100,
  "issues": [
    {
      "category":   "...",
      "file":       "...",
      "line":       42,
      "severity":   "high | medium | low",
      "issue":      "...",
      "suggestion": "..."
    }
  ]
}
```

### Verdict Derivation Rule

```
verdict = 'needs_changes'  if any issue has severity 'high' or 'medium'
verdict = 'approve'        if all issues are 'low' or issues array is empty
```

If the model omits `verdict`, the backend derives it from the issues array.

---

## Issue Categories

| Category | Description |
|---|---|
| `logical_error` | Wrong conditions, off-by-one, incorrect branching |
| `return_value` | Wrong return type, null/undefined leaks |
| `unused_variable` | Declared but never read |
| `naming_mismatch` | Misleading function/variable names |
| `edge_case` | Missing null checks, empty array handling |
| `code_quality` | Duplication, magic numbers, missing error handling |
| `security` | Injection, auth bypass, exposed secrets |
| `performance` | N+1, blocking I/O, memory leaks |
| `test_coverage` | Missing assertions, untested paths |

---

## Frontend Results Display

After a successful review:
1. **Verdict Banner** — green (Approved) or red (Needs Changes) with blocking issue count
2. **Summary Banner** — AI-generated 2–4 sentence summary
3. **Issue Cards** — one card per issue, sorted by severity (high → medium → low). Each card shows: category badge, file path, line number, severity badge, description, suggestion.
4. **Post to GitHub button** — calls `POST /comment` to post the summary + inline comments on the PR

---

## Review saved to Firestore

After every review (manual or auto), a document is written to `reviews/{id}` with `prompt_mode` and `strictness` recorded so the history shows how each review was run.
