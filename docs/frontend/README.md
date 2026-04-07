# Frontend — Module Index

**Location:** `frontend/`
**Framework:** React 18 + Vite 5
**Deployment:** Vercel
**Entry:** `frontend/src/main.jsx` → `App.jsx`

---

## File Map

```
frontend/src/
├── main.jsx                        ← React entry point
├── App.jsx                         ← Router, auth gate, layout
├── App.css                         ← All application styles (single file)
│
├── firebase.js                     ← Firebase web SDK initialisation
│
├── api/
│   └── index.js                    ← All backend API helpers
│
├── contexts/
│   ├── AuthContext.jsx             ← Firebase Auth state (currentUser)
│   └── GitHubContext.jsx           ← GitHub connection state + connect/disconnect
│
└── components/
    ├── Spinner.jsx                 ← Loading spinner
    ├── IssueCard.jsx               ← Single issue display card
    ├── ProjectForm.jsx             ← Create/edit project modal (RepoPicker)
    └── tabs/
        ├── OverviewTab.jsx         ← Project name, repo URL
        ├── DocsTab.jsx             ← Project documentation textarea
        ├── RulesTab.jsx            ← Project rules editor
        ├── ConfigTab.jsx           ← Review config (strict mode, strictness, checks)
        └── ReviewTab.jsx           ← AI review panel + auto workflow + history
```

---

## Component Docs

- [api/index.js](./api.md)
- [contexts.md](./contexts.md)
- [components/review-tab.md](./components/review-tab.md)
- [components/config-tab.md](./components/config-tab.md)
- [components/issue-card.md](./components/issue-card.md)
- [components/project-form.md](./components/project-form.md)

---

## Vite Dev Proxy

`frontend/vite.config.js` proxies all API paths to `http://localhost:3001`:

```js
proxy: {
  '/projects':       'http://localhost:3001',
  '/review':         'http://localhost:3001',
  '/comment':        'http://localhost:3001',
  '/health':         'http://localhost:3001',
  '/auth':           'http://localhost:3001',
  '/setup-workflow': 'http://localhost:3001',
  '/reviews':        'http://localhost:3001',
  '/apply-fix':      'http://localhost:3001',
}
```

In production, `VITE_API_URL=https://your-backend.onrender.com` is set in Vercel. The `api/index.js` helper uses `import.meta.env.VITE_API_URL || ''` so dev requests use the proxy (empty base = relative path).

---

## Environment Variables

| Variable | Dev value | Prod value |
|---|---|---|
| `VITE_API_URL` | (empty — use proxy) | `https://ai-code-review-backend-jyab.onrender.com` |
| `VITE_FIREBASE_API_KEY` | Firebase project API key | same |
| `VITE_FIREBASE_AUTH_DOMAIN` | `*.firebaseapp.com` | same |
| `VITE_FIREBASE_PROJECT_ID` | `ai-code-review-dashboard` | same |

All `VITE_*` vars are public (baked into the JS bundle at build time). Never put secrets in `VITE_*` vars.
