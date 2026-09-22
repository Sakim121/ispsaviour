-- ISP SAVIOUR 2.0 - Supabase schema
-- Paste this whole file into the Supabase SQL Editor (your project ->
-- SQL Editor -> New query -> paste -> Run) and it creates everything the
-- backend needs, pre-loaded with the same demo data as backend/data.json,
-- so switching storage to Supabase doesn't change what you see.
--
-- Column names match backend/server.js's onuPublic()/db shape exactly,
-- so once you flip "Use Supabase for storage" on in Settings, nothing
-- else needs to change.

create table if not exists olts (
  id bigint primary key generated always as identity,
  name text not null,
  ip_address text,
  location text,
  status text default 'Online'
);

create table if not exists pons (
  id bigint primary key generated always as identity,
  olt_id bigint references olts(id) on delete cascade,
  name text not null,
  port int,
  output_power numeric,
  status text default 'Active',
  label text
);

create table if not exists onus (
  id bigint primary key generated always as identity,
  name text not null,
  onu_id text,
  pon_id bigint references pons(id) on delete set null,
  mac text,
  status text default 'Online',
  distance numeric,
  rx_power numeric,
  est_power numeric,
  connected_at timestamptz,
  disconnected_at timestamptz,
  reason text,
  latitude numeric,
  longitude numeric,
  radius_username text,
  radius_account text,
  radius_status text,
  radius_mac text,
  radius_ip text,
  logged_in_at timestamptz,
  download_usage_gb numeric,
  upload_usage_mb numeric
);

create table if not exists rx_history (
  id bigint primary key generated always as identity,
  onu_id bigint references onus(id) on delete cascade,
  "timestamp" timestamptz not null default now(),
  rx_power numeric not null
);

create table if not exists fiber_paths (
  id bigint primary key generated always as identity,
  name text not null,
  olt_id bigint references olts(id),
  pon_id bigint references pons(id),
  color text default 'Blue',
  style text default 'Solid',
  width int default 2,
  "offset" text default 'None',
  coordinates jsonb,
  fiber_company text,
  fiber_type text,
  batch_no text,
  fiber_year text,
  installed_by text,
  comments text,
  created_at timestamptz default now()
);

create table if not exists landmarks (
  id bigint primary key generated always as identity,
  name text not null,
  latitude numeric,
  longitude numeric,
  type text
);

-- ---- Row Level Security ----
-- The backend talks to Supabase with the service_role key (entered in
-- Settings), which bypasses RLS entirely - that's the intended setup for
-- this project, since server.js is the only thing that should ever see
-- your Supabase credentials, and it already has its own login/roles in
-- front of it (admin/engineer/viewer). Enabling RLS here with no open
-- policies just means: if that key were ever leaked or someone hit the
-- REST API with the anon key, they'd get nothing back by default.
alter table olts enable row level security;
alter table pons enable row level security;
alter table onus enable row level security;
alter table rx_history enable row level security;
alter table fiber_paths enable row level security;
alter table landmarks enable row level security;
-- No policies are created, which means: no access via the anon key.
-- Only the service_role key (used server-side, bypasses RLS) can read/write.

-- ---- Seed data (mirrors backend/data.json exactly) ----
insert into olts (id, name, ip_address, location, status) overriding system value values
  (1, 'Ark OLT 1', '10.10.0.1', 'HQ - YMR', 'Online')
on conflict (id) do nothing;

insert into pons (id, olt_id, name, port, output_power, status, label) overriding system value values
  (1, 1, 'PON 1', 1, 9.0, 'Active', null),
  (2, 1, 'PON 2', 2, 7.0, 'Active', null),
  (3, 1, 'PON 3', 3, 8.0, 'Active', 'PON 3 - YMR, Korrapadu Rd, HB Colony'),
  (4, 1, 'PON 4', 4, 8.5, 'Active', null)
on conflict (id) do nothing;

insert into onus (id, name, onu_id, pon_id, mac, status, distance, rx_power, est_power, connected_at, disconnected_at, reason, latitude, longitude, radius_username, radius_account, radius_status, radius_mac, radius_ip, logged_in_at, download_usage_gb, upload_usage_mb) overriding system value values
  (1, 'healthcare2', 'EPON0/2:13', 2, '8C:8A:BB:57:DC:74', 'Online', 411, -11.48, null, '2026-05-06T19:22:16Z', null, null, 14.7538, 78.5460, 'healthcare2 (10122)', 'Active', 'Online', 'A4:2B:8C:61:F6:A7', '10.31.32.18', '2026-05-06T19:26:10Z', 3.90, 383.56),
  (2, 'abdul1', 'EPON0/3:3', 3, '30:D1:7E:9E:57:C5', 'Online', 720, -13.85, null, '2026-03-31T17:05:00Z', null, null, 14.4995, 78.4986, 'abdul1 (10201)', 'Active', 'Online', '30:D1:7E:9E:57:C5', '10.21.22.40', '2026-03-31T17:06:00Z', 5.10, 402.20),
  (3, 'rrraja', 'EPON0/3:23', 3, '4C:AE:1C:B8:5B:DC', 'Power Off', 4847, null, null, null, '2026-05-07T12:42:00Z', 'Power Off', 14.4986, 78.4970, null, null, null, null, null, null, null, null),
  (4, 'shekarshop', 'EPON0/3:24', 3, 'A8:E2:07:31:B6:65', 'Online', 646, -16.11, null, '2026-04-14T11:06:00Z', null, null, 14.5004, 78.5027, 'shekarshop (10014)', 'Active', 'Online', 'F4:8C:EB:8D:7C:E1', '10.21.22.31', '2026-05-07T09:33:00Z', 11.41, 985.03),
  (5, 'ArkComboBox', 'EPON0/3:51', 3, '14:A7:2B:A6:19:37', 'Wire Down', 946, null, null, null, '2026-04-24T10:04:00Z', 'Wire Down', 14.5006, 78.4964, null, null, null, null, null, null, null, null),
  (6, 'teja', 'EPON0/1:15', 1, '9A:1D:20:33:44:55', 'Online', 3106, -25.38, -12.64, '2026-04-01T08:00:00Z', null, null, 14.7500, 78.5300, null, null, null, null, null, null, null, null),
  (7, 'munwar', 'EPON0/1:16', 1, '9A:1D:20:33:44:56', 'Online', 3146, -26.02, -12.66, '2026-04-01T08:00:00Z', null, null, 14.7502, 78.5302, null, null, null, null, null, null, null, null),
  (8, 'kanwarbasha', 'EPON0/1:17', 1, '9A:1D:20:33:44:57', 'Online', 3087, -27.45, -12.63, '2026-04-01T08:00:00Z', null, null, 14.7504, 78.5304, null, null, null, null, null, null, null, null),
  (9, 'dgiri', 'EPON0/1:29', 1, null, 'Offline', null, null, null, null, '2026-04-02T15:58:05Z', 'Wire Down', null, null, null, null, null, null, null, null, null, null),
  (10, 'jrcollege', 'EPON0/1:42', 1, null, 'Offline', null, null, null, null, '2026-05-07T13:49:14Z', 'Power Off', null, null, null, null, null, null, null, null, null, null),
  (11, 'radha1', 'EPON0/1:41', 1, null, 'Offline', null, null, null, null, '2026-05-07T08:48:23Z', 'Power Off', null, null, null, null, null, null, null, null, null, null),
  (12, 'ksreddy', 'EPON0/1:9', 1, null, 'Offline', null, null, null, null, '2026-05-02T21:25:46Z', 'Power Off', null, null, null, null, null, null, null, null, null, null),
  (13, 'murthy1', 'EPON0/1:33', 1, null, 'Offline', null, null, null, null, '2026-04-23T20:18:20Z', 'Power Off', null, null, null, null, null, null, null, null, null, null),
  (14, 'vk_traders', 'EPON0/2:5', 2, null, 'Offline', null, null, null, null, '2026-05-06T10:12:02Z', 'Power Off', null, null, null, null, null, null, null, null, null, null),
  (15, 'sunitastores', 'EPON0/2:11', 2, null, 'Offline', null, null, null, null, '2026-05-06T22:40:11Z', 'Power Off', null, null, null, null, null, null, null, null, null, null),
  (16, 'rreddy2', 'EPON0/2:18', 2, null, 'Offline', null, null, null, null, '2026-05-05T07:05:44Z', 'N/A', null, null, null, null, null, null, null, null, null, null),
  (17, 'ktraders', 'EPON0/2:21', 2, null, 'Offline', null, null, null, null, '2026-05-07T02:15:09Z', 'Power Off', null, null, null, null, null, null, null, null, null, null),
  (18, 'lakshmi_store', 'EPON0/2:27', 2, null, 'Offline', null, null, null, null, '2026-05-04T19:44:00Z', 'N/A', null, null, null, null, null, null, null, null, null, null),
  (19, 'abhi_collections', 'EPON0/2:33', 2, null, 'Offline', null, null, null, null, '2026-05-07T09:30:00Z', 'Power Off', null, null, null, null, null, null, null, null, null, null),
  (20, 'arjun_mart', 'EPON0/3:8', 3, null, 'Offline', null, null, null, null, '2026-05-02T11:05:00Z', 'Wire Down', null, null, null, null, null, null, null, null, null, null),
  (21, 'preethi', 'EPON0/3:12', 3, null, 'Offline', null, null, null, null, '2026-05-06T14:20:00Z', 'N/A', null, null, null, null, null, null, null, null, null, null),
  (22, 'harish_shop', 'EPON0/3:19', 3, null, 'Offline', null, null, null, null, '2026-05-05T21:55:00Z', 'N/A', null, null, null, null, null, null, null, null, null, null),
  (23, 'venkat_traders', 'EPON0/3:25', 3, null, 'Offline', null, null, null, null, '2026-05-07T06:10:00Z', 'N/A', null, null, null, null, null, null, null, null, null, null),
  (24, 'chandrika', 'EPON0/3:31', 3, null, 'Offline', null, null, null, null, '2026-05-06T03:33:00Z', 'N/A', null, null, null, null, null, null, null, null, null, null)
on conflict (id) do nothing;

insert into rx_history (onu_id, "timestamp", rx_power) values
  (4, '2026-05-07T15:30:00Z', -16.25),
  (4, '2026-05-07T11:50:00Z', -16.09),
  (4, '2026-05-07T08:00:00Z', -16.16),
  (4, '2026-05-07T01:35:00Z', -16.04),
  (4, '2026-05-06T21:50:00Z', -16.07)
on conflict do nothing;

insert into landmarks (id, name, latitude, longitude, type) overriding system value values
  (1, 'VK Hall', 14.7548, 78.5445, 'hall'),
  (2, 'SEH Gate', 14.7536, 78.5460, 'gate')
on conflict (id) do nothing;

-- keep the identity sequences ahead of the manually-inserted ids above,
-- so the next INSERT from the app doesn't collide with seed data
select setval(pg_get_serial_sequence('olts','id'), (select max(id) from olts));
select setval(pg_get_serial_sequence('pons','id'), (select max(id) from pons));
select setval(pg_get_serial_sequence('onus','id'), (select max(id) from onus));
select setval(pg_get_serial_sequence('landmarks','id'), (select max(id) from landmarks));
