# backend/prompts.js

Centralised AI prompt builders. All prompt logic lives here — routes never construct prompts inline.

---

## Public API

```js
const { buildSystemPrompt, buildUserPrompt } = require('../prompts');
```

| Function | Arguments | Returns |
|---|---|---|
| `buildSystemPrompt(config)` | `config` object | System prompt string |
| `buildUserPrompt(diff, rules, docs, config, prDetails)` | — | User prompt string |

---

## buildSystemPrompt(config)

Dispatches to either **strict** or **standard** mode based on `config.strict_mode`.

```js
function buildSystemPrompt(config = {}) {
  return config.strict_mode
    ? buildStrictSystemPrompt(config)
    : buildStandardSystemPrompt(config);
}
```

### Strict Mode (`config.strict_mode === true`)

Enforces a 6-point analysis framework. The model is instructed to **never say "no issues"** if any issue exists.

**Always-on checks (regardless of config):**
1. Logical errors — wrong conditions, off-by-one, incorrect branching
2. Incorrect return values — null/undefined leaks, wrong type
3. Unused variables — dead assignments
4. Naming mismatch — misleading function/variable names

**Config-driven checks** (enabled when the flag is `!== false`):

| Config flag | Check added |
|---|---|
| `check_edge_cases` | Empty input, null, zero, negative, concurrent calls |
| `check_security` | Injection, auth bypass, exposed secrets |
| `check_performance` | N+1 queries, blocking I/O, memory leaks |
| `check_best_practices` | Duplication, magic numbers, missing error handling |
| `check_unit_tests` | Untested paths, missing assertions |
| `check_code_structure` | Poor separation of concerns, deep nesting |

### Standard Mode (`config.strict_mode !== true`)

Expert balanced review. The model surfaces meaningful issues, returns empty array if code is clean.

### Strictness Depth (`config.strictness`)

Both modes respect the `strictness` field:

| Value | Behaviour |
|---|---|
| `'low'` | Critical (high severity) issues only |
| `'medium'` | High + medium issues; low only when they form a pattern |
| `'high'` | Exhaustive — surface every issue including style and naming |

---

## Response Schema (both modes)

```json
{
  "summary":          "<2–4 sentence overview>",
  "verdict":          "approve" | "needs_changes",
  "confidence_score": 0-100,
  "issues": [
    {
      "category":   "logical_error | return_value | unused_variable | naming_mismatch | edge_case | code_quality | security | performance | test_coverage",
      "file":       "<path from diff header, or 'general'>",
      "line":       <integer | null>,
      "severity":   "high | medium | low",
      "issue":      "<what is wrong and WHY>",
      "suggestion": "<concrete fix>"
    }
  ]
}
```

**Verdict derivation** (in `review.js` normalisation step, if the model omits it):
```js
const hasHighOrMedium = issues.some(i => i.severity === 'high' || i.severity === 'medium');
verdict = hasHighOrMedium ? 'needs_changes' : 'approve';
```

---

## buildUserPrompt(diff, rules, docs, config, prDetails)

Assembles the context the model receives as the `user` message.

**Content (in order):**
1. PR title and author (`@username`)
2. PR description (first 500 chars)
3. Mode + strictness line
4. Focus areas (from enabled config flags)
5. Project-specific rules (numbered list)
6. Project documentation / context
7. PR diff (truncated to 14 000 chars if longer)

---

## How to Extend

- To add a new check category: add it to the `checks` array in `buildStrictSystemPrompt` and add the corresponding `category` value to the schema comment.
- To add a new prompt mode: add a new builder function, export it, and add a dispatch case in `buildSystemPrompt`.
- Do **not** add prompt logic inside route files — keep it all here.
