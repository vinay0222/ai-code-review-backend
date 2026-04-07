# ProjectForm.jsx (Create/Edit Project)

Modal for creating a new project. Includes an integrated **RepoPicker** that lists the user's GitHub repositories.

---

## RepoPicker

When GitHub is connected, the form shows a searchable repo list instead of a plain text input.

**Data source:** `getGitHubRepos()` → `GET /auth/github/repos`

**Grouping:**
- Repos where `owner_type === 'User'` → **Personal** section
- Repos where `owner_type === 'Organization'` → **Organisation** section

**Search:** Client-side filter on `full_name` and `name` (case-insensitive).

**On repo select:**
- Auto-fills **Project Name** with `repo.name`
- Auto-fills **Repo URL** with `repo.html_url`

**Fallback:** If GitHub is not connected, or the user prefers manual entry, a plain URL input is shown instead.

---

## Form Fields

| Field | Required | Notes |
|---|---|---|
| Project Name | Yes | Free text |
| Repo URL | Yes | Full `https://github.com/...` URL |

On submit: `POST /projects` → navigates to the new project's detail page.
