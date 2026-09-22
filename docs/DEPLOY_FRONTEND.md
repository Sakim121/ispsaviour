# Frontend Deployment Guide (Vercel / Netlify)

Applies once `frontend-react/` is a real Vite app (`npm create vite@latest`
+ the components already delivered dropped in). This assumes that setup
is done - see `frontend-react/README.md` for the npm install list.

## 1. Environment variables

Vite only exposes variables prefixed `VITE_` to the browser bundle -
anything else stays server-side-only (not that there is a server side
here; this is a static SPA).

Create `.env.production` in the project root (never commit this - add it
to `.gitignore`):

```bash
# .env.production
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...   # the PUBLIC anon key - safe to ship in the bundle
VITE_ISP_BACKEND_URL=https://api.yourdomain.com
```

**Never put the Supabase `service_role` key here.** It belongs only in
the Node backend's environment (Section 2 of `DEPLOY_SUPABASE.md`) and
must never reach a browser bundle. The anon key is *meant* to be public;
Row Level Security is what actually protects the data (see
`SECURITY_CHECKLIST.md`).

### Setting them on the hosting platform

Both Vercel and Netlify build your app fresh from git on every deploy, so
`.env.production` on your laptop doesn't help in production - set the
same three variables in the platform's dashboard instead:

- **Vercel**: Project → Settings → Environment Variables → add each one,
  scoped to "Production" (and "Preview" too if you want preview deploys
  to work against the same or a staging Supabase project).
- **Netlify**: Site configuration → Environment variables → same idea.

## 2. Build configuration

Standard Vite build - no special flags needed:

```
Build command:  npm run build
Output directory: dist
Install command: npm install
Node version: 18.x or later
```

Set the Node version explicitly on both platforms (Vercel: Settings →
General → Node.js Version; Netlify: `netlify.toml` or a `.nvmrc` file) so
a platform default upgrade doesn't unexpectedly break the build later.

## 3. SPA routing (the part that bites people)

A React SPA has one real file, `index.html`, and client-side routing
fakes the rest. Deployed as-is, refreshing the browser on
`yourapp.com/dashboard/map` 404s, because the host looks for an actual
`map` file/folder that doesn't exist. Fix it by rewriting every path back
to `index.html` and letting React Router take over from there.

### Vercel - `vercel.json`

Create this at the project root:

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

### Netlify - `public/_redirects`

Create `public/_redirects` (Vite copies everything in `public/` into the
build output automatically):

```
/*    /index.html   200
```

Or equivalently in `netlify.toml`:

```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

Either way, deploy once after adding this and manually test a hard
refresh on a nested route (not just clicking around inside the app) -
that's the failure mode this specifically fixes, and clicking-around
navigation will look fine even without it, which is exactly why it's
easy to ship broken.

## 4. Connecting your custom domain

Both platforms: Project/Site settings → Domains → add your domain → follow
their DNS instructions (usually a CNAME to their edge, or an A record for
an apex domain). HTTPS certificates are automatic on both. Once your
domain is live, come back to `SECURITY_CHECKLIST.md`'s CORS section and
restrict the backend to that exact domain.

## 5. Quick pre-flight checklist before your first production deploy

- [ ] `.env.production` values set in the platform dashboard (not just
      locally)
- [ ] `vercel.json` or `_redirects` committed
- [ ] `VITE_SUPABASE_ANON_KEY` used - NOT the service_role key
- [ ] `VITE_ISP_BACKEND_URL` points at your deployed backend (Section 2),
      not `localhost:5000`
- [ ] A production build runs clean locally first: `npm run build && npm run preview`
