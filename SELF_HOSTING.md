# Self-hosting Heirloom

Heirloom runs three ways from the same code. Pick the one that fits your family:

| Flavor | Where data lives | Sign-in | Good for |
| --- | --- | --- | --- |
| **Hosted server** (Docker, e.g. Railway) | PostgreSQL + a media folder on your server | Google accounts you invite | Several people sharing one tree from any device |
| **Static site** (any static host, e.g. Cloudflare) | Each visitor's own browser (in-browser PostgreSQL) | None | One person, no server to run |
| **Desktop app** (Tauri) | The computer it is installed on | None | One person, offline |

The static site and the desktop app need no Google setup and no database. Skip to
[Static site](#static-site) or [Desktop app](#desktop-app) if that is all you want.

## Hosted server

### What you need

- A host that runs a Docker image and gives it a **persistent volume** (for photos and documents).
- **PostgreSQL 14 or newer** (16 is what CI tests against).
- A **Google OAuth client** (below).
- A public HTTPS URL for the app, for example `https://heirloom.example.com`.

The schema is created on the first database connection and upgraded automatically when a
new version starts, so there is no separate migration step.

### Environment variables

| Variable | Required | Value |
| --- | --- | --- |
| `DATABASE_URL` | yes | `postgresql://user:password@host:5432/dbname` |
| `AUTH_SECRET` | yes | A random string: `openssl rand -base64 32`. Keep it secret and stable. The server refuses to run with the `.env.example` placeholder. |
| `AUTH_GOOGLE_ID` | yes | OAuth client ID |
| `AUTH_GOOGLE_SECRET` | yes | OAuth client secret |
| `NEXTAUTH_URL` | yes | Your public URL, e.g. `https://heirloom.example.com` |
| `AUTH_TRUST_HOST` | behind a proxy | `true` on Railway and most PaaS hosts |
| `AUTH_BOOTSTRAP_EMAIL` | first start | The Google address of the first admin (see [First sign-in](#first-sign-in)) |
| `DATA_DIR` | no | Media folder. The Docker image already sets `/data`. |
| `MEDIA_TREE_QUOTA_BYTES` | no | Per-tree media limit. Default 100 MB. |
| `DEBUG_LOGS` | no | `true` for verbose operational logs while debugging |
| `SOURCE_URL` | if you change the code | Where people can get your copy's source. Read at build time; see [Source code link](#source-code-link). |
| `HEIRLOOM_HOSTED` | no | `true` makes the About page say "Hosted server" instead of "Self-hosted server". Read at build time. |

[`.env.example`](.env.example) documents every variable, including the optional map style ones.

### Google OAuth client

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a project
   (or pick one).
2. Go to **Google Auth Platform** (older consoles: **APIs & Services → OAuth consent screen**):
   - **Branding:** an app name and your support email.
   - **Audience:** choose **External**. While the app is in **Testing**, only the addresses
     you add under **Test users** can sign in, which is fine for a family. To skip that list,
     **Publish** the app; Heirloom only asks for the basic `openid email profile` scopes, which
     need no Google verification.
3. **Clients → Create client → Web application**:
   - **Authorized JavaScript origins:** `https://heirloom.example.com` (and
     `http://localhost:3000` for local development).
   - **Authorized redirect URIs:** `https://heirloom.example.com/api/auth/callback/google`
     (and `http://localhost:3000/api/auth/callback/google`).
4. Copy the client ID and secret into `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.

You do not need to enable any Google API. (Old guides say "enable the Google+ API"; it was
retired and is not needed.)

### First sign-in

Who may sign in is stored in the database and managed on the **Members** page, which only
admins see.

1. Set `AUTH_BOOTSTRAP_EMAIL` to your own Google address and start the app.
2. Sign in with that account. Whenever there is no admin, that address becomes one.
3. Invite everyone else from **Members**.

A production server with no members and no bootstrap address lets nobody in.

### Option A: Railway

1. Create a Railway project and add the **PostgreSQL** service. Railway provides its
   `DATABASE_URL`; reference it from the app service as `${{Postgres.DATABASE_URL}}`.
2. Add a service from your fork of this repository. Railway builds it with the `Dockerfile`.
3. Attach a **volume** to the app service, mounted at `/data`.
4. Set the variables from the table above, with `AUTH_TRUST_HOST=true`.
5. Generate a domain under **Settings → Networking**, put it in `NEXTAUTH_URL`, and add it to
   the Google OAuth client.

**Infrastructure as Code (optional).** Railway can manage the service from a
`.railway/railway.ts` file in your fork (the `railway` npm package, Railway CLI 5.42.1+): declare
the app service, its GitHub source and the `/data` volume, keep Postgres in the dashboard, and
run `railway config plan` before `railway config apply`. Two rules from experience: every
variable set on the service must be listed in the file as `preserve()` or the plan refuses to
run, and anything you leave out of a declared service plans as removed, not untouched.

**Keep your fork's deploy private if your instance is private.** Railway posts each deploy's
status, including the site address, on the commit it built. On a public fork that address is
public. Deploy from a private repository, or from a workflow that does not let Railway watch
the public one.

### Option B: any Docker host

```bash
docker network create heirloom

docker run -d --name heirloom-db --network heirloom \
  -e POSTGRES_USER=heirloom -e POSTGRES_PASSWORD=change-me -e POSTGRES_DB=heirloom \
  -v heirloom-pg:/var/lib/postgresql/data \
  postgres:16-alpine

docker build -t heirloom .

docker run -d --name heirloom --network heirloom -p 3000:3000 \
  -e DATABASE_URL=postgresql://heirloom:change-me@heirloom-db:5432/heirloom \
  -e AUTH_SECRET="$(openssl rand -base64 32)" \
  -e AUTH_GOOGLE_ID=your-client-id \
  -e AUTH_GOOGLE_SECRET=your-client-secret \
  -e NEXTAUTH_URL=https://heirloom.example.com \
  -e AUTH_TRUST_HOST=true \
  -e AUTH_BOOTSTRAP_EMAIL=you@example.com \
  -v heirloom-media:/data \
  heirloom
```

Put a reverse proxy with HTTPS (Caddy, nginx, Traefik) in front of port 3000. Generate
`AUTH_SECRET` once and keep it; changing it signs everyone out.

The container starts as root only to fix ownership of `/data`, then runs the app as an
unprivileged user.

### Backups and upgrades

- Back up **both** the database (`pg_dump`) and the media volume (`/data`). One without the
  other is incomplete.
- **Tools → Import/export** exports the tree as GEDCOM with its media, which any genealogy
  program can read. It is a good second copy, not a replacement for a database backup.
- To upgrade, pull the new version and redeploy. Take a backup first: schema upgrades run on
  start and are not reversed by rolling back the code.

## Static site

The static build runs entirely in the browser, with PostgreSQL compiled to WebAssembly and
data in the browser's storage. There is no server, no sign-in and no sharing: each browser
holds its own tree.

```bash
npm ci
npm run build:static   # writes ./out
```

Serve `./out` from any static host with a single-page-app fallback to `index.html`. For
Cloudflare, see [docs/cloudflare-pages-setup.md](docs/cloudflare-pages-setup.md). To serve
from a subpath, set `NEXT_PUBLIC_BASE_PATH` before building.

Browser storage can be cleared, so back up regularly from the backup button in the top bar
(or **Options**). Optional Google Drive
backup needs only a public OAuth client ID: see
[docs/drive-backup-setup.md](docs/drive-backup-setup.md).

## Desktop app

The desktop app wraps the static build in a native window with [Tauri](https://tauri.app/).
Build steps, platform prerequisites and release notes are in
[docs/desktop-tauri.md](docs/desktop-tauri.md).

## Source code link

Heirloom is licensed under the GNU AGPL-3.0-or-later. If you run a modified copy for other people, the
licence asks you to offer them its source. The About page (from the foot of the account menu, the
phone menu, and the sign-in page) shows a "Source code" link taken from `SOURCE_URL` at build
time. Point it at your fork, for example `SOURCE_URL=https://example.org/you/heirloom`, in your
host's build variables (the Docker build reads it as a build argument; static and desktop builds
read it from the environment). When it is unset the link points at the upstream repository,
https://github.com/Goombario/Heirloom, which is right only while you run the code unchanged.

## Privacy

Heirloom holds private family data. Apart from Google sign-in, the only outside services the app
calls are map tiles (OpenFreeMap by default; set `NEXT_PUBLIC_MAP_STYLE_URL` to self-host) and
place search (the Photon geocoder at photon.komoot.io), and those only send map positions and
place names you search for. Never commit a `.env` file, a database dump or a family GEDCOM to a fork.
