// supabase/functions/telegram-alert/index.ts
// Triggered by a Postgres webhook (see docs/DEPLOY_SUPABASE.md Section 4c)
// whenever a node's status changes to 'offline' or 'wire_down'. Posts a
// message to a Telegram chat via the Bot API.
//
// Deploy: supabase functions deploy telegram-alert
// Secrets: supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=...
//
// I have not been able to run this against a live Deno/Supabase runtime
// or a real Telegram bot while writing it - the serve() pattern and the
// fetch-to-Telegram call follow Supabase's and Telegram's documented
// APIs, but test it with the curl command in the deploy doc (Section 4d)
// before wiring the real DB trigger to it.

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");
const ALLOWED_ORIGIN = Deno.env.get("ISP_ALLOWED_ORIGIN") || "*";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return new Response(
      JSON.stringify({ error: "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not configured" }),
      { status: 500, headers: corsHeaders() }
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

    return new Response(JSON.stringify({ sent: true }), { headers: corsHeaders() });
  } catch (err) {
    console.error("telegram-alert failed:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: corsHeaders(),
    });
  }
});
