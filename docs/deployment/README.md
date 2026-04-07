# Deployment

The backend and frontend are separate git repos deployed independently.

| Service | Repo | Platform | URL |
|---|---|---|---|
| Backend | `github.com/vinay0222/ai-code-review-backend` | Render | `https://ai-code-review-backend-jyab.onrender.com` |
| Frontend | `github.com/vinay0222/ai-code-review-frontend` | Vercel | `https://ai-code-review-frontend-five.vercel.app` |

---

## Quick Links

- [Backend deployment (Render)](./render-backend.md)
- [Frontend deployment (Vercel)](./vercel-frontend.md)
- [All environment variables](./environment-variables.md)

---

## Connecting the Two

The only connection between the repos is the `VITE_API_URL` env var in the Vercel frontend pointing to the Render backend URL, and the `ALLOWED_ORIGINS` env var in the Render backend allowing the Vercel frontend domain.

```
Vercel frontend VITE_API_URL  =  https://ai-code-review-backend-jyab.onrender.com
Render backend ALLOWED_ORIGINS = https://ai-code-review-frontend-five.vercel.app
```
