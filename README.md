# Roster App API

State API for Roster Pro (GET/PUT `/api/state`).

## Persistent data on Railway

**Without a volume, data is lost on every deploy** because the container filesystem is recreated.

To keep roster data across deploys:

1. In your Railway project, open your service.
2. Go to **Variables** and add:
   - `STATE_FILE_PATH=/data/state.json`
3. Go to **Settings** → **Volumes** (or **Storage**) and add a volume:
   - Mount path: `/data`
4. Redeploy. State is now stored in the volume and will persist across pushes.
