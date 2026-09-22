# OLT Scanner (SNMP -> Supabase)

Polls a physical EPON/GPON OLT over SNMP v2c and syncs ONU status + RX
power into Supabase's `nodes` table. Configured by default for a VSOL
V1600D8 at `192.168.80.2` (community `public`), overridable via `.env`.

## ⚠️ Read this before running against your real OLT

I could not test this against real hardware or a real network from where
this was written - no access to your local network, obviously. What
**is** actually verified (16 + 11 = 27 real unit/integration test
checks, not just "looks right"):

```bash
npm install
npm test
```

This runs:
1. `oltParsers.test.js` - the interface-index parsing, status mapping,
   and RX-power scaling logic, checked against known input/output pairs.
2. `integration.test.js` - the full `scanOnce()` flow from
   `olt-scanner.js`, run against **mocked** SNMP responses (fake data
   shaped like a VSOL response) and a mocked Supabase client, asserting
   on the exact upsert payload it would send.

What this test suite does **not** and cannot verify: whether
`1.3.6.1.2.1.155.1.4.1.1.1.1` / `1.3.6.1.4.1.37950...` are the actual
correct OIDs for your specific V1600D8's firmware, or whether its
interface-index encoding matches the last-2/next-2-digit convention
`oltParsers.js` assumes. Those are genuinely device/firmware-specific
and I have no way to confirm them without your hardware in front of me.

## Step 1: Discover mode - find your device's real OID layout

Before trusting any parsed output, run:

```bash
cp .env.example .env
# edit .env with your real Supabase URL/key (OLT settings can stay default)
npm run discover
```

This walks the configured OID trees and prints every raw
`oid = value` pair it finds - nothing gets written to Supabase in this
mode. Compare the printed ifIndex numbers and values against what your
OLT's own web UI shows for the same ONUs (port, ONU id, signal
strength). If they don't line up:

- Wrong OIDs entirely (empty output) → check your OLT's SNMP is enabled
  (often off by default) and try `snmpwalk -v2c -c public 192.168.80.2
  1.3.6.1.2.1.155` from a machine with `net-snmp-utils`/`snmp` installed,
  to explore the tree manually.
- Right table, wrong ifIndex math → adjust `parseInterfaceIndex()` in
  `oltParsers.js` (and re-run `npm test` to confirm your fix against the
  existing test cases, then update them to match your device's real
  scheme).
- Right status OID, wrong "online" value → set `STATUS_ONLINE_VALUE` in
  `.env`.
- RX power numbers look off by a factor of 10 or 100 → adjust
  `RX_POWER_DIVISOR` in `.env`.

## Step 2: Run it for real

```bash
npm start
```

Expect a log line every cycle:
```
OLT Scan Complete: 14 ONUs Online, 2 ONUs Offline
```

Network drop or OLT timeout logs a warning and keeps running - it does
not crash the process:
```
[scan] WARNING - OLT unreachable or SNMP error: Request timed out
```

## Step 3: Run it in the background with pm2

```bash
npm install -g pm2
mkdir -p logs
pm2 start ecosystem.config.js
pm2 save                 # persist across reboots
pm2 startup              # follow the printed command to enable on-boot start
```

Useful commands:
```bash
pm2 logs olt-scanner      # tail live output
pm2 restart olt-scanner   # after editing .env or the script
pm2 stop olt-scanner
```

## Read-only, by design

This script only ever calls `session.walk()` (SNMP GET/GETNEXT under the
hood) - there is no `session.set()` anywhere in the file, so it cannot
modify the OLT's configuration even if pointed at the wrong OID by
mistake. The only thing it writes to is your own Supabase `nodes` table.

## Files in this folder

| File | What it is |
|---|---|
| `olt-scanner.js` | The script itself |
| `oltParsers.js` | Pure parsing/mapping helpers (testable without hardware) |
| `oltParsers.test.js` | Unit tests for the above |
| `integration.test.js` | Full scan-cycle test against mocked SNMP/Supabase |
| `__mocks__/` | Fake `net-snmp` / `@supabase/supabase-js` / `dotenv` used only by the test above |
| `.env.example` | Config template |
| `ecosystem.config.js` | pm2 process definition |
