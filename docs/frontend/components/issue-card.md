# IssueCard.jsx

Displays a single AI review issue.

---

## Props

```jsx
<IssueCard issue={issue} />
```

`issue` shape:
```json
{
  "category":   "edge_case",
  "file":       "src/auth/LoginForm.jsx",
  "line":       42,
  "severity":   "high",
  "issue":      "Password field is not validated before submission",
  "suggestion": "Add minimum length check and trim whitespace"
}
```

---

## Category Badges

| `category` value | Badge label | Icon |
|---|---|---|
| `logical_error` | Logical Error | ⚙️ |
| `return_value` | Return Value | ↩️ |
| `unused_variable` | Unused Variable | 🗑️ |
| `naming_mismatch` | Naming Mismatch | 🏷️ |
| `edge_case` | Edge Case | ⚠️ |
| `code_quality` | Code Quality | 🔧 |
| `security` | Security | 🔒 |
| `performance` | Performance | ⚡ |
| `test_coverage` | Test Coverage | *(not in CATEGORY_LABELS — fallback to Code Quality)* |

Any unknown category defaults to the `code_quality` label.

---

## Severity Colours

Controlled by CSS classes `.issue-card.high`, `.issue-card.medium`, `.issue-card.low`:
- `high` → red border/background
- `medium` → yellow/amber
- `low` → green

---

## Layout

```
┌─────────────────────────────────────────────────┐
│  [⚠️ Edge Case badge]  src/auth/LoginForm.jsx  line 42   │  [🔴 high]  │
├─────────────────────────────────────────────────┤
│  Password field is not validated before submission      │
├─────────────────────────────────────────────────┤
│  💡 Suggestion: Add minimum length check...              │
└─────────────────────────────────────────────────┘
```
