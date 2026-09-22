# Supabase Production Provisioning Guide

Covers pushing the schema (including the fault-tracing PL/pgSQL function)
from local/staging into production safely, plus deploying an Edge
Function for Telegram alerts.

## 1. Set up the Supabase CLI + link your project

```bash
npm install -g supabase
supabase login
```

Inside the project root:

```bash
supabase init                     # creates supabase/ folder if you don't have one
supabase link --project-ref <your-production-project-ref>
```

Find `<your-production-project-ref>` in the Supabase dashboard URL:
`https://supabase.com/dashboard/project/<this-part>`.

## 2. Turn the existing SQL files into migrations

Right now `backend/supabase/schema.sql` and
`backend/supabase/nodes_cables_schema.sql` are meant to be pasted into the
SQL Editor by hand - fine for a first setup, risky for repeatable
production deploys (easy to run twice, run out of order, or forget on a
new environment). Convert them into tracked migrations once:

```bash
mkdir -p supabase/migrations
cp backend/supabase/schema.sql               supabase/migrations/00001_core_schema.sql
cp backend/supabase/nodes_cables_schema.sql   supabase/migrations/00002_nodes_cables_and_fault_tracing.sql
```

(Keep the numeric prefixes in order - Supabase applies migrations in
filename order.)

**Test on staging first.** Either use a second free Supabase project as
staging, or at minimum run this against a fresh local instance:

```bash
supabase start                    # spins up local Postgres + Studio via Docker
supabase db reset                 # applies every migration in supabase/migrations/ from scratch
```

Fix anything that errors here - it's much cheaper to find a typo now than
mid-deploy against production.

## 3. Push to production

Once staging applies cleanly:

```bash
supabase db push
```

This diffs your local migrations against production and applies whatever
hasn't run yet. It's safe to re-run - already-applied migrations are
skipped.

**Before running this against a live database with real customer data**,
take a manual backup regardless of Supabase's automatic ones: Supabase
dashboard → Database → Backups → "Create a backup now" (or
`pg_dump` via the connection string in Settings → Database if you want a
local copy too).

### The fault-tracing function specifically

`get_upstream_path()` in `nodes_cables_schema.sql` is a plain SQL
function (`language sql stable`) - nothing Supabase-specific about
deploying it, `supabase db push` handles it like any other schema object.
Verify it after deploying:

```sql
-- Supabase SQL Editor, production project
select * from get_upstream_path('<a real node id from your nodes table>');
```

## 4. Deploying the Telegram alert Edge Function

### 4a. Create the function

```bash
supabase functions new telegram-alert
```

This creates `supabase/functions/telegram-alert/index.ts`. Replace its
contents with something like:

```typescript
// supabase/functions/telegram-alert/index.ts
// Triggered by a Postgres webhook (Section 4c) whenever a node's status
// changes to 'offline' or 'wire_down'. Posts a message to a Telegram
// chat via the Bot API.

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");

serve(async (req) => {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return new Response(
      JSON.stringify({ error: "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const payload = await req.json();
    // Supabase DB webhooks send { type, table, record, old_record, ... }
    const node = payload.record ?? payload;

    const text =
      `⚠️ *${node.name ?? "Unknown node"}* is now *${node.status ?? "unknown"}*\n` +
      (node.pon_port ? `PON: ${node.pon_port}\n` : "") +
      (node.type ? `Type: ${node.type}` : "");

    const tgRes = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text,
          parse_mode: "Markdown",
        }),
      }
    );

    if (!tgRes.ok) {
      const detail = await tgRes.text();
      throw new Error(`Telegram API error: ${detail}`);
    }

    return new Response(JSON.stringify({ sent: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("telegram-alert failed:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
```

> I haven't been able to run this against a live Deno/Supabase runtime or
> a real Telegram bot in writing this doc - the `serve()` pattern and
> `fetch`-to-Telegram call follow Supabase's and Telegram's documented
> APIs correctly, but test it against your actual bot token before
> relying on it (Section 4d below shows how).

### 4b. Set secrets (never commit tokens to git)

```bash
supabase secrets set TELEGRAM_BOT_TOKEN=123456:ABC-your-real-token
supabase secrets set TELEGRAM_CHAT_ID=-1001234567890
```

List what's set (values are hidden) to confirm:

```bash
supabase secrets list
```

### 4c. Deploy it

```bash
supabase functions deploy telegram-alert
```

Then wire a Postgres trigger to call it whenever a node's status
changes - Database → Webhooks in the dashboard is the easiest way:
"Create a new webhook" → table `nodes` → event `UPDATE` → condition
`status changes to offline or wire_down` (or leave unconditional and
filter inside the function) → URL = your deployed function's URL (shown
after `functions deploy`, looks like
`https://<project-ref>.supabase.co/functions/v1/telegram-alert`).

Equivalent as raw SQL, if you'd rather keep it in a migration (needs the
`pg_net` extension, enabled by default on Supabase):

```sql
create or replace function notify_telegram_on_status_change()
returns trigger as $$
begin
  if new.status in ('offline', 'wire_down') and new.status is distinct from old.status then
    perform net.http_post(
      url := 'https://<project-ref>.supabase.co/functions/v1/telegram-alert',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('record', row_to_json(new))
    );
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_notify_telegram on nodes;
create trigger trg_notify_telegram after update on nodes
  for each row execute function notify_telegram_on_status_change();
```

### 4d. Test it before trusting it

```bash
curl -X POST https://<project-ref>.supabase.co/functions/v1/telegram-alert \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your anon or service_role key>" \
  -d '{"record": {"name": "Test ONU", "status": "offline", "pon_port": "PON 3"}}'
```

Confirm the message actually lands in your Telegram chat before wiring
the real DB trigger - much easier to debug a `curl` command than a
production outage notification that silently never sent.

## 5. Rolling back

If a migration causes problems in production:

```bash
supabase migration list          # see what's applied, locally vs remote
```

There's no automatic "undo" - write a new migration that reverses the
change (drop the column/table/function you just added) and push that.
This is also why the manual backup in Section 3 matters.
