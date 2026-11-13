# Agent guide

## Scope and sources of truth

- This is a private, self-hosted genealogy app. Never commit credentials, real family data, or database exports.
- GitHub Issues and the Ship v1.0 board track work; use `Closes #N` in PR bodies. Decisions and deliberate invariants live in `docs/decisions/`; do not edit landed ADRs.
- Use existing focused skills in `.agents/skills/` for API routes, test generation, release/deploy, and issue audits. Do not recreate their instructions here.

## Read only when relevant

- Structural, database, auth, API, and deployment work: `architecture.md`.
- Tree changes: `tree-system.md`; update it with tree-file/type/layout changes.
- UI work under `app/`: `app/AGENTS.md` and `design-system.md`.
- GEDCOM parsing or generation: the local, gitignored `GEDCOM Specs/extracted/` texts when available.

## Non-negotiable implementation rules

- Routes validate HTTP; services hold business logic; reusable SQL belongs in `lib/db/queries/`. Routes never run SQL. Direct service SQL is only permitted inside a `getClient()` transaction.
- Resolve data access through `resolveTreeScope`; filter by `scope.treeId`, write both legacy owner and `TreeId`, and enforce its permission ladder. Dynamic Next 16 route params are awaited.
- SQL identifiers are double-quoted PascalCase and values use positional parameters.
- User-visible UI strings are translated in `messages/en.json`, `fr.json`, and `ru.json`; do not ship literals.

## Commands and verification

- Use the repo working directory directly: do not combine `cd` with commands. Avoid `node -e` inspection one-liners.
- Fast loop: `npm run test:fast`. Before a PR, select the relevant gates: `npm run lint`, `npx tsc --noEmit`, `npm run test:unit`, and `npm run test:integration` plus `npm run test:integration:pglite` (the same suite on PGlite; needs no Postgres) when database/API behavior changed. For UI changes, run `npm run test:a11y` when warranted.
- In Codex's managed sandbox, `npm run build:static` or `npm run test:a11y` can fail with `Could not parse output from TypeScript's --showConfig` because a nested Node process returns empty captured stdout. On that exact error, rerun the same command with elevated/out-of-sandbox execution before treating it as a project or test-framework failure. If the elevated run also fails, stop and diagnose the build normally.
- Name every unit suite that boots PGlite `*.pglite.test.ts`; `test:fast` excludes that suffix. Mock-only suites stay `*.test.ts`.
- Testing is per slice: run the cheapest targeted checks as the implementation evolves. A test or verification command does **not** trigger agent code review.

## Local smoke-test lifecycle

- Only one Next.js dev server can run in this worktree at a time because they share `.next/`. Stop the static server before starting the hosted server, and vice versa.
- Static smoke test: run `npm run build:static`, start `npm run dev:static` on port `3010`, verify the app at `http://localhost:3010`, then stop the server.
- For Codex browser checks, prefer the configured `chrome-devtools` MCP server in isolated headless mode; use it to inspect the rendered accessibility tree, console, and network rather than relying on source inspection alone.
- Hosted smoke test: start a disposable PostgreSQL instance, create a temporary `.env.local`, and seed a unique synthetic tree with `npm run db:seed:synthetic -- --email <test-account> --tree-name '<unique-tree-name>'`. Start `npm run dev` on port `3000`, verify `http://localhost:3000`, then stop the Next server and database and remove the temporary environment/data.
- Use only `test-fixtures/synthetic.hlbak` or the synthetic seed command. Never use real-family data or production volumes.
- Do not leave a test server, database, temporary `.env.local`, credentials, or hosted export running or in the worktree.
- `next dev` may append its generated agent-rules block to this file. Remove that startup artifact from the worktree after testing, or configure Next's agent-rule generation if the project chooses to retain it.

## Review is PR-level, not slice-level

- When the branch has a coherent draft PR diff against `main`, run one bounded adversarial diff review. Batch fixes; re-review only materially changed hunks.
- High-risk PRs (schema or destructive data/file work, auth/access, upload validation, export/backup integrity, or verification-gate changes) receive a focused security/invariant review at that same PR boundary.
- State the PR-boundary review in the PR body: what it covered, what it found and fixed, and whether a review agent ran. Do not use broad multi-agent review for routine diffs.

## Git

- Feature branches target `main`; there is no `dev` branch. Merging does not deploy: production follows release tags. A release is a PR that bumps `package.json`, then a `v<version>` tag on its merge commit (the `release-deploy` skill has the steps).
- A PR's `Closes #N` closes the issue when it merges into `main`. Closed means merged, not shipped; the release tag records what shipped. The keyword must precede *every* reference — `Closes #A, #B` closes just `#A` — so put one `Closes #N` per line.
- Preserve unrelated or pre-existing worktree changes. Do not reset, clean, or overwrite them.

## Codex-specific

- Local memory is optional recall, not project policy. Keep durable shared rules in this repository, not memory.
- For Codex configuration, prefer the Codex-native project files under `.codex/`; do not assume Claude hooks or memory are active.

## Synthetic test data

- The privacy-safe synthetic fixture is generated by `scripts/synthetic-data-fixture.ts` and exposed through `npm run fixture:synthetic` (static `.hlbak`), `npm run fixture:synthetic:verify`, and `npm run db:seed:synthetic -- --email <test-account>` (hosted PostgreSQL).
- `test-fixtures/synthetic.hlbak` contains 120 invented people, every supported family/child relationship variant, sources and citations on every citable fact kind, generated PNG images, face tags, and face-review candidates. Use it for disposable local/static testing; do not use the private git-ignored `test-data/` corpus or real-family data.
- Hosted seeding must target a disposable database and creates only a new or explicitly empty tree owned by the selected test account. Never point it at production or a real-family-data volume.

## Disposable PostgreSQL with Podman

- The local integration-test database is disposable PostgreSQL 16 on `localhost:5433`, matching the service definition in `docker-compose.yml`. It uses database `genealogy_test`, user `postgres`, and the test-only password `testpassword`. Never point `DATABASE_URL` at the hosted application or a real-family-data volume.
- Docker is not guaranteed to be installed in the agent environment. When `docker compose` is unavailable, use Podman directly. Rootless Podman may require elevated permission in the agent sandbox because its runtime directory can be read-only.
- Start the database with a fresh, disposable container:

  ```sh
  podman rm -f heirloom-test-pg
  podman run -d --rm --name heirloom-test-pg -e POSTGRES_DB=genealogy_test -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=testpassword -p 5433:5432 postgres:16-alpine
  ```

  If the first `podman rm` reports that the container does not exist, continue with `podman run`.
- Verify readiness before running tests:

  ```sh
  podman exec heirloom-test-pg pg_isready -U postgres -d genealogy_test
  ```

- Create the ignored `.env.test.local` file for the test process with exactly:

  ```dotenv
  DATABASE_URL=postgresql://postgres:testpassword@localhost:5433/genealogy_test
  ```

- Run the database-backed tests with `npm run test:integration`, and on PGlite with `npm run test:integration:pglite`. Run `npm run test:integration:local` only when Docker Compose is available and points at this same disposable configuration.
- Clean up immediately after testing:

  ```sh
  podman stop heirloom-test-pg
  rm .env.test.local
  ```

  Confirm that no test container, temporary environment file, or database process remains. The `--rm` flag removes the container on stop; do not add a persistent volume for this test database.

### Questions answered during setup

- **Do agents have hosted-database access?** No. Hosted credentials and production volumes are out of scope; use only the disposable local database.
- **Is Docker available?** Not in every agent environment; `docker compose` failed when Docker was absent.
- **Is Podman available?** It may be available even when Docker is not, but rootless configuration can require elevated permission in the sandbox.
- **What database does integration testing use?** `localhost:5433/genealogy_test` with the test-only credentials above, initialized by Vitest global setup.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
