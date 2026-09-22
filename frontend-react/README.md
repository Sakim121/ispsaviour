# frontend-react/ (work in progress)

This is where the React conversion of the isp-project frontend lives,
built up piece by piece. It's not a runnable app on its own yet (no
package.json / build tool wired up here) - these are the components and
services delivered so far, ready to drop into a Vite or Next.js project.

## What's here

```
components/
  FiberMapView.jsx        - Live Fiber Map: Leaflet + Geoman draw/edit/delete,
                             status-colored markers, floating filter panel
  mapIcons.js              - colored marker icon factory (OLT/Splitter/ONU x status)
  MapPageWithSupabase.jsx  - example page wiring FiberMapView + Supabase together

services/
  supabaseClient.js  - Supabase client (anon key, safe for the browser)
  mapService.js       - saveNewNode/saveNewCable (-> backend API) +
                         fetchMapData/subscribeToRealtimeChanges (-> Supabase directly)
  useMapData.js        - React hook wrapping mapService with loading/error state
```

Database schema for the tables these expect: `backend/supabase/nodes_cables_schema.sql`
(separate from `backend/supabase/schema.sql`, which powers the existing
dashboard pages via the onus/olts/pons tables - see that file's own notes
on how the two relate).

## Setup once you scaffold the React app

```bash
npm install react react-dom leaflet react-leaflet @geoman-io/leaflet-geoman-free @supabase/supabase-js
```

Add to your `.env`:
```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Import once in your app's entry file:
```js
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
```

Run `backend/supabase/nodes_cables_schema.sql` in your Supabase project's
SQL Editor before using the map - it creates the `nodes` and `cables`
tables, RLS policies, and registers them for Realtime.

## How the pieces fit together

- **Reads + live updates**: the browser talks to Supabase directly
  (`fetchMapData`, `subscribeToRealtimeChanges`) - RLS allows public
  SELECT, so this needs no login of its own.
- **Writes**: `saveNewNode` / `saveNewCable` call the existing Node
  backend (`POST /api/nodes`, `POST /api/cables` in `server.js`), which
  checks the logged-in user's role (admin/engineer can write, viewer
  can't) and then writes to Supabase using the service_role key. This
  keeps one single place (`server.js`) that decides who's allowed to
  change the network, instead of splitting that logic between the
  backend and Supabase RLS.
- `mapService.js` reads the same `isp_backend_url` / `isp_auth`
  localStorage keys the rest of the vanilla-HTML pages already use
  (`config.js` / `auth.js`), so once this is dropped into the real app it
  shares the same login session automatically.

## Not built yet

- The rest of the pages (Home, Manage ONUs, Fiber Paths, Settings, Live
  Offline ONUs, Topology) as React components - still HTML/vanilla JS in
  the project root.
- A real router (react-router / Next.js) - `MapPageWithSupabase.jsx`
  simulates navigation with local state as a placeholder.
- Editing/deleting existing nodes/cables from the map UI (the backend
  endpoints exist - `PUT`/`DELETE /api/nodes/:id` and `/api/cables/:id` -
  but `FiberMapView`'s Geoman wiring currently only calls `onGeometryChange`
  for newly created shapes; extending it to edit/remove is the next
  natural step once you're ready for it).
