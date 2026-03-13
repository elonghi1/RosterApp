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
