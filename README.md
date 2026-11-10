# Heirloom

Heirloom is a self-hosted family history app. Record people, families, events and places,
cite your sources, attach photos and documents, and see it all as an interactive tree.
GEDCOM 5.5.1 import and export means you can move data to and from other genealogy software.

It runs three ways from the same code:

| Flavour | Where data lives | Sign-in | Good for |
| --- | --- | --- | --- |
| **Hosted server** (Docker, for example on Railway) | PostgreSQL and a media folder on your server | Google accounts you invite | Several people sharing trees from any device |
| **Static site** (any static host) | Each visitor's own browser (PostgreSQL compiled to WebAssembly) | None | One person, no server to run |
| **Desktop app** (Windows and Linux) | The computer it is installed on | None | One person, offline |

[SELF_HOSTING.md](SELF_HOSTING.md) covers setting up each one.

## Features

- **People and families**: people with names and name variants, life events, notes and
  living status; families with partners and children, where each child's link to each
  parent can be birth, adoption, foster, step or guardian.
- **Family tree**: descendants, ancestors and focus views, with zoom, pan, search and JPEG
  export. A relationship calculator explains how two people are related.
- **Library**: sources, repositories and citations with evidence quality; photos and
  documents; stories and oral history; and a review queue that links face tags already in
  your photos' metadata to people.
- **Places**: every place your records mention, on a map (MapLibre with OpenFreeMap tiles)
  and as a list, with optional place lookup through the Photon geocoder.
- **Research cases**: track an open question with a research journal, citations and
  attached photos.
- **Data checks**: dates that contradict each other or look unlikely, such as a child born
  long after a parent's death, someone who is their own ancestor, or a person marked living
  who was born too long ago.
- **Import and export**: GEDCOM 5.5.1 (`.ged`, or `.zip` with media), merge or overwrite
  on import, an import report, and a spreadsheet template for entering people in bulk.
  Tested against public sample exports from Ancestry, FamilySearch, Gramps, MyHeritage,
  RootsMagic, Family Tree Maker, Legacy and others
  ([report](docs/testing/2026-10-02-gedcom-interop.md)).
- **Sharing and audit** (hosted server): several trees per site, each shared with view,
  contribute or edit access; a Members page that controls who can sign in; and an audit
  log of every change, with revert.
- **Backups**: the static site and desktop app back up to a file or, when the build is set
  up for it ([how](docs/drive-backup-setup.md)), to your Google Drive. On the hosted server
  you back up the database and media folder ([how](SELF_HOSTING.md#backups-and-upgrades)),
  and GEDCOM export with media makes a portable second copy.
- **Everywhere**: English, French and Russian; light and dark themes; designed for phones
  as well as desktops; installable as a web app.

## Tech stack

- [Next.js](https://nextjs.org/) 16 (App Router), React 19 and TypeScript
- [PostgreSQL](https://www.postgresql.org/) on the hosted server; [PGlite](https://pglite.dev/)
  (PostgreSQL in WebAssembly) in the static site and desktop app
- [Auth.js](https://authjs.dev/) v5 with Google sign-in (hosted server only)
- [Tailwind CSS](https://tailwindcss.com/) 4
- [React Flow](https://reactflow.dev/) and [d3-hierarchy](https://d3js.org/d3-hierarchy) for
  the tree, [MapLibre GL JS](https://maplibre.org/) for maps
- [next-intl](https://next-intl.dev/) for translations
- [Tauri](https://tauri.app/) 2 for the desktop app
- [Vitest](https://vitest.dev/), with Playwright and axe-core for accessibility and layout
  scans

[`architecture.md`](architecture.md) describes how the code is organised: the route, service
and query layers, tree-scoped data access, the database schema and the API.

## Getting started

You need Node.js 24 or later and npm 11.16 or later.

### Try it without any setup

The static flavour needs no database and no sign-in:

```bash
git clone https://github.com/Goombario/Heirloom.git heirloom
cd heirloom
npm install
npm run dev:static
```

Open [http://localhost:3010](http://localhost:3010). Your data stays in that browser.

### Run the hosted server locally

1. Start PostgreSQL 14 or later. With Docker:

   ```bash
   docker run -d --name genealogy-pg \
     -e POSTGRES_PASSWORD=password \
     -e POSTGRES_DB=genealogy_dev \
     -p 5432:5432 postgres:16-alpine
   ```

2. Copy the example environment and fill in `AUTH_SECRET`, the Google OAuth client
   (`AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`) and `DATABASE_URL`. The comments in the file, and
   [SELF_HOSTING.md](SELF_HOSTING.md#google-oauth-client), explain each one.

   ```bash
   cp .env.example .env.local
   ```

3. Install dependencies. This also creates the database schema when `DATABASE_URL` is set;
   otherwise run `npm run db:init` afterwards.

   ```bash
   npm install
   ```

4. Start the development server and open [http://localhost:3000](http://localhost:3000).

   ```bash
   npm run dev
   ```

For working in several branches at once, Windows notes and the test prerequisites, see
[docs/worktree-development.md](docs/worktree-development.md).

## Development

| Command | What it does |
| --- | --- |
| `npm run dev` | Hosted server in development mode (port 3000) |
| `npm run dev:static` | Static flavour in development mode (port 3010) |
| `npm run desktop:dev` | Desktop app in development mode (needs Rust; see [docs/desktop-tauri.md](docs/desktop-tauri.md)) |
| `npm run build` / `npm start` | Production build and start of the hosted server |
| `npm run build:static` | Static site, written to `./out` |
| `npm run test:fast` | The quick unit-test loop |
| `npm run verify` | Everything a pull request must pass: lint, the dead-code ratchet, type checks, then the unit and integration suites |
| `npm run test:a11y` | Accessibility, layout, focus and mobile scans of the static build |

The PostgreSQL integration suite runs only when `.env.test.local` names a test database
(`npm run db:test:up` starts one in Docker); otherwise `verify` skips it and says so.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security problem, see
[SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

Heirloom is licensed under the GNU Affero General Public License, version 3 or (at your option)
any later version (`AGPL-3.0-or-later`). See [LICENSE](LICENSE) for the full text.

If you run a modified copy for other people, the AGPL asks you to offer them its source. Set
`SOURCE_URL` to your copy's source and the app links to it from the About page and the sign-in
page; see [Source code link](SELF_HOSTING.md#source-code-link).

The licences of the open-source packages Heirloom uses are listed in the app under About, and
generated at build time by `scripts/third-party-licenses.mjs`.
