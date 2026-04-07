# ConfigTab.jsx

The project review configuration screen. Saved settings apply to all future reviews — manual and auto-triggered.

---

## Fields

### `strict_mode` (boolean, default `false`)

The main toggle. Switches between two AI prompt modes:
- **Standard** (`false`) — balanced expert review, returns empty issues array if code is clean
- **Strict** (`true`) — 6-point analysis, never skips issues, always explains WHY

Displayed as an animated toggle switch with descriptive text.

### `strictness` ('low' | 'medium' | 'high', default 'medium')

Controls analysis depth within the selected mode:
- `low` — critical issues only (high severity)
- `medium` — high + medium issues; low only when forming a pattern
- `high` — exhaustive, surface every issue including style

Displayed as a 3-card selector (replaced the old dropdown).

### Check flags (boolean)

| Flag | Default | What it adds to the review |
|---|---|---|
| `check_edge_cases` | `true` | Boundary conditions, null/undefined, empty arrays |
| `check_code_structure` | `true` | Architecture, naming, organisation |
| `check_performance` | `false` | Bottlenecks, N+1, blocking I/O |
| `check_security` | `true` | Injection, auth bypass, exposed secrets |
| `check_best_practices` | `true` | DRY, SOLID, magic numbers |
| `check_unit_tests` | `false` | Missing coverage, brittle tests |

In **strict mode**, the first 4 checks (logical errors, return values, unused variables, naming mismatches) are always active regardless of these flags. The config flags add more categories on top.

---

## Default Config

```js
const DEFAULT_CONFIG = {
  strict_mode:          false,
  check_edge_cases:     true,
  check_code_structure: true,
  check_performance:    false,
  check_security:       true,
  check_best_practices: true,
  check_unit_tests:     false,
  strictness:           'medium',
};
```

This is merged with `project.review_config` on mount (`{ ...DEFAULT_CONFIG, ...project.review_config }`), so missing fields in old projects get sensible defaults.

---

## Save Flow

```js
await onUpdate({ review_config: config });  // PUT /projects/:id
```

The `onUpdate` prop is passed down from the project detail page. Changes are not auto-saved — the user must click "Save Config".

---

## How Config Reaches the AI

1. **Manual review:** Config is read from `project.review_config` in the frontend and sent in the `POST /review` body.
2. **Auto review (GitHub Actions):** The workflow sends only `project_id`. The backend fetches `review_config` from Firestore and applies it to `buildSystemPrompt(config)`.
