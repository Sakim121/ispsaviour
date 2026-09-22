# Security & Performance Checklist

## 1. Row Level Security for `nodes` and `cables`

### Where this project currently stands

`backend/supabase/nodes_cables_schema.sql` (as delivered earlier) made a
deliberate choice: **no direct browser writes at all**. Reads are public
(`for select using (true)`), and every write goes through the existing
Node backend using the `service_role` key, which bypasses RLS and
enforces the app's own admin/engineer/viewer roles instead. That's a
valid, simpler production setup - one place decides who can write, and
RLS's only job is "don't let the anon key modify anything."

**This section is for if you'd rather enforce roles at the database
layer directly via Supabase Auth** (e.g. because the map's draw/edit
tools now call Supabase directly instead of through the backend, or you
want defense-in-depth even with the backend in front). Both approaches
are legitimate - pick one deliberately rather than ending up with half
of each.

### 1a. A `profiles` table holding each user's role

Supabase Auth's `auth.users` table doesn't have a role column you can
edit, so mirror the users you care about into your own table:

```sql
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('viewer', 'technician', 'admin')),
  created_at timestamptz default now()
);

alter table profiles enable row level security;

-- users can read their own profile (needed for the RLS policies below
-- to be able to look up "what's my role")
create policy "read own profile" on profiles for select
  using (auth.uid() = id);
```

Populate it via a trigger whenever someone signs up:

```sql
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, role) values (new.id, 'viewer');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
```

(New users default to `viewer` - promote someone to `technician`/`admin`
manually: `update profiles set role = 'technician' where id = '<uuid>';`)

### 1b. RLS policies using that role

```sql
-- Read: anyone with a valid Supabase session (any role) can view the map
drop policy if exists "public read nodes" on nodes;
create policy "authenticated read nodes" on nodes for select
  using (auth.role() = 'authenticated');

drop policy if exists "public read cables" on cables;
create policy "authenticated read cables" on cables for select
  using (auth.role() = 'authenticated');

-- Write: only technician or admin
create policy "technicians write nodes" on nodes for insert
  with check (
    exists (select 1 from profiles where id = auth.uid() and role in ('technician', 'admin'))
  );
create policy "technicians update nodes" on nodes for update
  using (exists (select 1 from profiles where id = auth.uid() and role in ('technician', 'admin')))
  with check (exists (select 1 from profiles where id = auth.uid() and role in ('technician', 'admin')));
create policy "technicians delete nodes" on nodes for delete
  using (exists (select 1 from profiles where id = auth.uid() and role in ('technician', 'admin')));

-- Repeat the same three for `cables`
create policy "technicians write cables" on cables for insert
  with check (exists (select 1 from profiles where id = auth.uid() and role in ('technician', 'admin')));
create policy "technicians update cables" on cables for update
  using (exists (select 1 from profiles where id = auth.uid() and role in ('technician', 'admin')))
  with check (exists (select 1 from profiles where id = auth.uid() and role in ('technician', 'admin')));
create policy "technicians delete cables" on cables for delete
  using (exists (select 1 from profiles where id = auth.uid() and role in ('technician', 'admin')));
```

If you go this route, the frontend needs actual Supabase Auth sessions
(`supabase.auth.signInWithPassword(...)`) instead of - or in addition to
- the existing custom login. Don't run both systems pretending to be the
same login; pick which one is the real source of truth for "who is this
user" and have the other defer to it.

### 1c. Sanity-check your RLS before trusting it

Easy to write a policy that looks right and isn't. Test with the anon
key directly, not just through your app:

```bash
curl "https://<project-ref>.supabase.co/rest/v1/nodes?select=*" \
  -H "apikey: <anon key>" \
  -H "Authorization: Bearer <anon key>"
```

Should return `[]` or a 401/403-style empty result if you intended no
public access, or your public rows if you intended public read - whatever
your policy says, confirmed from outside your app's code where a bug in
your own fetch calls can't hide a leak.

## 2. CORS

### Backend (Node.js in `server.js`)

Right now `send()` in `server.js` sets
`Access-Control-Allow-Origin: *` (wide open - fine for local development,
wrong for production). Restrict it to your actual frontend domain:

```javascript
// near the top of server.js
const ALLOWED_ORIGIN = process.env.ISP_ALLOWED_ORIGIN || 'http://localhost:8000';

// inside send(), replace the wildcard:
function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(json);
}
```

Set `ISP_ALLOWED_ORIGIN=https://yourapp.com` wherever you deploy the
backend (Section 3 below). If you need to allow both your production
domain and a staging one, check `req.headers.origin` against an allow-list
array instead of a single string, and echo back the matching one - never
echo back `req.headers.origin` unconditionally, that's equivalent to `*`
with extra steps.

### Supabase

Supabase's own API (PostgREST, Auth, Realtime, Edge Functions) is
designed to be called from a browser with the public anon key, so it
doesn't have a per-project CORS allow-list the way a custom backend
does - RLS is the actual security boundary there (Section 1), not CORS.
Edge Functions do let you set CORS headers yourself if you want to
restrict which sites can call them directly:

```typescript
// at the top of an Edge Function's handler
const ALLOWED_ORIGIN = "https://yourapp.com";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }
  // ... rest of the function, and include the same header on the real response too
});
```

## 3. Deploying the backend itself

Not asked for explicitly but implied by "restrict requests to our
production domain" - the backend needs to actually run somewhere
production-reachable for any of this to matter. It's a zero-dependency
Node script, so any platform that runs `node server.js` works: Render,
Railway, Fly.io, a plain VPS with `pm2` (see the OLT scanner doc for a
`pm2` example, same pattern applies here), etc. Whichever you pick, set
these as environment variables on that platform rather than editing
`server.js`:

```
ISP_ALLOWED_ORIGIN=https://yourapp.com
ISP_INTERNAL_KEY=<a long random string - not the demo default>
```

## 4. Performance checklist (quick pass)

- [ ] Supabase: confirm indexes exist for every column you filter/sort
      on in hot paths - `idx_nodes_status`, `idx_nodes_pon_port` etc. are
      already in the schema; add more as new query patterns show up.
- [ ] Realtime: only subscribe to the tables/events a given page actually
      needs (`useMapData`'s subscription already scopes to `nodes` and
      `cables` specifically, not `postgres_changes` on everything).
- [ ] Frontend: confirm `npm run build` output is what actually deploys
      (not a dev server) - Vite's production build minifies and
      tree-shakes automatically, but only if the build command is really
      what's configured on Vercel/Netlify (Section 2 of the frontend doc).
- [ ] OLT poller: keep the 60s interval (or slower) in production - GPON
      OLTs are not designed for aggressive polling, and a too-tight loop
      can itself cause SNMP timeouts that look like false "offline"
      events.
- [ ] Set a reasonable `poll_interval_ms` floor - the in-app Settings
      toggle already clamps this to 5000ms minimum in `server.js`
      (`Math.max(5000, ...)`) as a basic guardrail.
