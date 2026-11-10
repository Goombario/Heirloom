# Google Drive backup — self-hoster setup

The static/local-first build (PGlite in the browser: `dev:static`, the Cloudflare
deployment, and the Tauri desktop app) can back up its database to the user's own
Google Drive and restore from it. The feature is **manual backup/restore, not
sync**, and it is **entirely opt-in**: it renders only when
`NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID` is set at build time. Without it, the app
works normally with file-based backup/restore and no Google Cloud account is
needed.

The hosted PostgreSQL build ignores this variable — Drive backup is a
local-build feature only (`DRIVE_ENABLED` in `lib/data/drive/config.ts` requires
`DATA_MODE === 'local'`).

## What you get

- A **Connect Google Drive** option in the app's backup panel
- Backups uploaded to a visible **`Heirloom`** folder in the user's Drive
- Retention of the **last 10 backups** (older ones are pruned after each upload)
- Restore from any listed backup into the current browser/device

## Security model (why no secret is involved)

The app uses [Google Identity Services](https://developers.google.com/identity/oauth2/web/guides/overview)
(GIS) **token flow in the browser** — there is no server component and no client
secret. The client ID is a public identifier (that's why the env var is
`NEXT_PUBLIC_`); the only credential is a short-lived access token Google issues
directly to the signed-in user's browser session.

The requested scope is **`https://www.googleapis.com/auth/drive.file`** — the app
can only see and touch files *it created*, never the rest of the user's Drive.
This scope is classified by Google as **non-sensitive**, so no security
assessment (CASA) and no verification fee are required.

## Google Cloud setup (one-time, ~10 minutes)

1. **Create a project** at <https://console.cloud.google.com/> (or reuse one —
   the same project as your NextAuth OAuth credentials is fine).
2. **Enable the Google Drive API**: *APIs & Services → Library → Google Drive
   API → Enable*.
3. **Configure the OAuth consent screen** (*APIs & Services → OAuth consent
   screen*):
   - User type: **External** (unless you have a Workspace org).
   - Fill in the app name and support/developer emails.
   - Scopes: add `.../auth/drive.file` (non-sensitive).
   - While the consent screen is in **Testing** status, only email addresses you
     add as *Test users* can connect — add yourself. For a personal self-host
     you can stay in Testing forever; **Publish** only if other people will use
     your deployment.
4. **Create the client ID** (*APIs & Services → Credentials → Create
   credentials → OAuth client ID*):
   - Application type: **Web application**.
   - **Authorized JavaScript origins** — add every origin the static build is
     served from (the GIS token flow validates origins; there are **no redirect
     URIs** to configure):
     - `http://localhost:3010` (local `npm run dev:static`)
     - your Cloudflare URL, e.g. `https://your-app.your-subdomain.workers.dev`
   - Copy the generated client ID (`…apps.googleusercontent.com`).
5. **Set the env var and build**:

   ```bash
   # .env.local (or your CI build environment)
   NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID=1234567890-abc123.apps.googleusercontent.com
   ```

   Because the variable is inlined at **build time**, it must be present when
   `npm run build:static` (or `dev:static`) runs — setting it on a running
   deployment does nothing until the next build.

## Verifying it works

1. `npm run dev:static`, open <http://localhost:3010>.
2. Open the backup panel (Options → Local data). A **Google Drive** section
   appears alongside file backup.
3. Connect, approve the consent prompt, and run a backup — a `Heirloom` folder
   with the backup file appears in that Google account's Drive.

## Known limitations

- **Tauri desktop:** the OAuth token flow inside the WebView2 shell has not yet
  been verified end-to-end (release tracker §7.2) — treat desktop Drive backup
  as experimental until that test lands. The web/static flavors are the
  supported path.
- Token sessions are short-lived; reconnecting occasionally re-prompts for
  consent. Backups themselves are plain files in the user's own Drive and are
  never touched by any server.
