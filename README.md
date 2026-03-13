# Roster App API

State API for Roster Pro.

## Endpoints

- `GET /` health check.
- `POST /api/login` authenticate and receive a bearer token when `AUTH_PASSWORD` is configured.
- `POST /api/logout` invalidate the current token.
- `GET /api/session` verify the caller token and return session details.
- `GET /api/state` read current roster state.
- `GET /api/state/meta` read lightweight metadata (`bytes`, `updatedAt`, `lastModifiedBy`, `lastModifiedAt`).
- `PUT /api/state` overwrite current roster state.

When `AUTH_PASSWORD` is set, auth is required for `GET/PUT /api/state`, `GET /api/state/meta`, `GET /api/session`, and `POST /api/logout`.



### Stale-write protection (multi-device safe saves)

`PUT /api/state` now supports optimistic concurrency to prevent one device from silently overwriting newer cloud changes.

- `GET /api/state` returns `stateRevision` (also set as an `ETag` header).
- `GET /api/state/meta` returns `stateRevision`.
- Clients should send `X-State-Revision: <last seen revision>` with `PUT /api/state`.
- If cloud data changed since that revision, the API returns `409` with code `state_revision_conflict`.

This allows the app to fetch latest cloud data first, then retry save, instead of wiping schedules with stale payloads.

### Destructive-write protection

`PUT /api/state` now rejects accidental empty overwrites when cloud data already exists.

- If the current cloud state has staff/shifts and an incoming payload has **0 staff and 0 shifts**, the API returns `409` with code `destructive_write_blocked`.
- This prevents a newly opened/stale device from wiping shared data across devices.
- To intentionally replace cloud data with an empty state (for a real reset), send header:
  - `X-Force-Overwrite: true`

## Environment variables

- `PORT` (optional, defaults to `4000`)
- `AUTH_PASSWORD` (optional; if absent, auth is disabled)
- `STATE_FILE_PATH` (optional; defaults to `./state.json`)

## Persistent data on Railway

**Without a volume, data is lost on every deploy** because the container filesystem is recreated.

To keep roster data across deploys:

1. In your Railway project, open your service.
2. Go to **Variables** and add:
   - `STATE_FILE_PATH=/data/state.json`
3. Go to **Settings** → **Volumes** (or **Storage**) and add a volume:
   - Mount path: `/data`
4. Redeploy. State is now stored in the volume and will persist across pushes.
