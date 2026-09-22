-- ISP Saviour - Map data schema (nodes + cables)
-- Paste into Supabase SQL Editor and run once.
--
-- This is a separate, map-focused schema from backend/supabase/schema.sql
-- (which models olts/pons/onus for the existing dashboard pages). Use
-- this one for the Leaflet map's draw/edit/delete + realtime feature.
-- If you want a single unified schema instead of two, see the note at
-- the bottom of this file.

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
do $$ begin
  create type node_type as enum ('olt', 'splitter', 'onu');
exception when duplicate_object then null; end $$;

do $$ begin
  create type node_status as enum ('online', 'offline', 'wire_down', 'power_off');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- nodes: every marker on the map (OLTs, splitters, ONUs)
-- ---------------------------------------------------------------------
create table if not exists nodes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type node_type not null,
  status node_status not null default 'offline',
  latitude double precision not null,
  longitude double precision not null,
  -- free-form per-type data: PPPoE username, RX/EST dBm, splitter ratio,
  -- distance, MAC, whatever a given node type needs, without new columns
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_nodes_type on nodes(type);
create index if not exists idx_nodes_status on nodes(status);

-- ---------------------------------------------------------------------
-- cables: fiber routes (polylines) drawn on the map
-- ---------------------------------------------------------------------
create table if not exists cables (
  id uuid primary key default gen_random_uuid(),
  name text,
  source_olt_id uuid references nodes(id) on delete set null,
  pon_port text,                 -- e.g. "PON 3"
  core_capacity int,             -- 2, 4, 6, 12, 24, 48, 96
  core_color text,               -- Blue, Orange, Green, ...
  manufacturer text,             -- BRB, Poly, Sterlite, Finolex, Generic
  -- Array of [lat, lng] pairs, e.g. [[14.75,78.54],[14.76,78.55]] -
  -- matches what Leaflet/Geoman gives you directly (layer.getLatLngs()),
  -- no geometry conversion needed on save or load.
  coordinates jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cables_source_olt on cables(source_olt_id);

-- Keep updated_at current on every UPDATE (handy for "last edited" and
-- for the realtime UPDATE payload to always carry a fresh timestamp)
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_nodes_updated_at on nodes;
create trigger trg_nodes_updated_at before update on nodes
  for each row execute function set_updated_at();

drop trigger if exists trg_cables_updated_at on cables;
create trigger trg_cables_updated_at before update on cables
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
-- Decision made: writes go through the existing Node backend
-- (server.js), which already has its own admin/engineer/viewer login
-- system. The backend talks to Supabase with the service_role key
-- (bypasses RLS entirely), so these tables need NO write policy at all -
-- only the backend can ever write, and only after its own role check.
--
-- The React map still reads + subscribes to Realtime DIRECTLY from the
-- browser (that part needs a direct connection either way), using the
-- public anon key - so SELECT is public. If you'd rather not expose map
-- data to anyone with the anon key, add an app-level gate before the map
-- page renders (e.g. don't mount it until your existing login has
-- succeeded), since RLS here isn't checking your custom JWT.

alter table nodes enable row level security;
alter table cables enable row level security;

drop policy if exists "public read nodes" on nodes;
create policy "public read nodes" on nodes for select using (true);
-- (intentionally no insert/update/delete policy on nodes - see note above)

drop policy if exists "public read cables" on cables;
create policy "public read cables" on cables for select using (true);
-- (intentionally no insert/update/delete policy on cables - see note above)

-- Required for Realtime: tell Supabase which tables to stream changes for
-- (Database -> Replication in the dashboard does this too, this is the
-- SQL equivalent so it's captured in version control).
alter publication supabase_realtime add table nodes;
alter publication supabase_realtime add table cables;

-- ---------------------------------------------------------------------
-- Topology columns - needed for fault tracing (ONU -> Splitter -> ... -> OLT)
-- ---------------------------------------------------------------------
-- parent_id: the node one hop closer to the OLT (an ONU's parent is
--   whatever splitter feeds it; a splitter's parent is the next splitter
--   or coupler upstream, or the OLT node itself at the top).
-- pon_port: which PON port this node is served by (e.g. "PON 3") -
--   denormalized onto every node so you don't have to walk the tree just
--   to answer "what port is this ONU on".
-- upstream_cable_id: the specific cables row representing the physical
--   run between this node and its parent - this is what fault tracing
--   highlights on the map once it identifies the broken segment.
alter table nodes add column if not exists parent_id uuid references nodes(id) on delete set null;
alter table nodes add column if not exists pon_port text;
alter table nodes add column if not exists upstream_cable_id uuid references cables(id) on delete set null;

create index if not exists idx_nodes_parent on nodes(parent_id);
create index if not exists idx_nodes_pon_port on nodes(pon_port);

-- ---------------------------------------------------------------------
-- get_upstream_path: walk from any node up to its root (the OLT),
-- returning one row per hop. Root first, requested node last.
-- ---------------------------------------------------------------------
create or replace function get_upstream_path(start_node_id uuid)
returns table (
  id uuid,
  name text,
  type node_type,
  status node_status,
  latitude double precision,
  longitude double precision,
  pon_port text,
  parent_id uuid,
  upstream_cable_id uuid,
  depth int
) as $$
  with recursive upstream as (
    select n.id, n.name, n.type, n.status, n.latitude, n.longitude,
           n.pon_port, n.parent_id, n.upstream_cable_id, 0 as depth
    from nodes n
    where n.id = start_node_id

    union all

    select p.id, p.name, p.type, p.status, p.latitude, p.longitude,
           p.pon_port, p.parent_id, p.upstream_cable_id, u.depth + 1
    from nodes p
    join upstream u on p.id = u.parent_id
  )
  select * from upstream order by depth desc; -- OLT (root) first, requested node last
$$ language sql stable;

-- Example: select * from get_upstream_path('11111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------
-- external_ref / mac_address - needed for the SNMP OLT scanner's upsert
-- ---------------------------------------------------------------------
-- The scanner (scripts/olt-scanner.js) discovers ONUs from the OLT
-- itself, not from someone clicking "Add ONU" in the UI - it needs a
-- STABLE key to upsert against so re-running the scan updates the same
-- row instead of creating duplicates every cycle. The nodes.id UUID is
-- generated on insert and the scanner has no way to know it in advance,
-- so external_ref (a human-readable id built from the OLT + PON port +
-- ONU index, e.g. "vsol-192.168.80.2-pon1-onu3") fills that role.
alter table nodes add column if not exists external_ref text unique;
alter table nodes add column if not exists mac_address text;

create index if not exists idx_nodes_external_ref on nodes(external_ref);

-- ---------------------------------------------------------------------
-- Optional: PostGIS instead of JSONB coordinates
-- ---------------------------------------------------------------------
-- If you want real geospatial queries (ST_Length for cable distance,
-- ST_DWithin for "ONUs within 500m", proper spatial indexing), enable
-- PostGIS and use a geometry column instead. This is more powerful but
-- means converting to/from GeoJSON on every read/write instead of using
-- the coordinates array as-is - only worth it once you actually need
-- those spatial queries.
--
-- create extension if not exists postgis;
--
-- alter table cables add column geom geometry(LineString, 4326);
-- create index idx_cables_geom on cables using gist(geom);
--
-- -- Populate geom from an array of [lng, lat] pairs (note: PostGIS wants
-- -- lng/lat order, the opposite of the [lat, lng] Leaflet convention):
-- -- update cables set geom = ST_SetSRID(ST_MakeLine(
-- --   array(select ST_MakePoint((pt->>1)::float, (pt->>0)::float)
-- --         from jsonb_array_elements(coordinates) pt)
-- -- ), 4326);
--
-- -- Example query once populated: cable length in meters
-- -- select id, name, ST_Length(geom::geography) as length_m from cables;

-- ---------------------------------------------------------------------
-- Note on the two schemas
-- ---------------------------------------------------------------------
-- backend/supabase/schema.sql (olts/pons/onus/fiber_paths/rx_history)
-- powers the existing dashboard pages via the Node backend + service_role
-- key. This file (nodes/cables) powers the new Leaflet draw/edit map via
-- direct browser <-> Supabase calls + Realtime. They can coexist, but
-- you'll eventually want to pick one model for "what is an ONU" rather
-- than maintaining both - the straightforward merge is to drop the
-- separate onus/olts tables and let `nodes` (filtered by type) be the
-- single source of truth, with the dashboard's REST endpoints in
-- server.js reading from `nodes` too.
