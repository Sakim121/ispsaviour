// supabaseClient.js
// Single shared Supabase client for the React app. Uses the PUBLIC
// anon key (safe to ship in frontend bundles - the RLS policies in
// nodes_cables_schema.sql are what actually control access, not this
// key being secret). Never put the service_role key in frontend code.
//
// Set these in your .env file:
//   Vite:      VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
//   Next.js:   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
//              (swap the two lines below if you're on Next.js)

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
// Next.js users: comment the two lines above and use these instead:
// const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
// const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing Supabase env vars - set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see comment at the top of supabaseClient.js)"
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});
