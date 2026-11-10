# Claude guide

## Scope and sources of truth

- This is a private, self-hosted genealogy app. Never commit credentials, real family data, or database exports.
- GitHub Issues and the Ship v1.0 board track work; use `Closes #N` in PR bodies. Decisions and deliberate invariants live in `docs/decisions/`; do not edit landed ADRs.
- Use existing focused skills in `.claude/skills/` for API routes, test generation, release/deploy, and issue audits. Do not recreate their instructions here.

## Read only when relevant

- Structural, database, auth, API, and deployment work: `architecture.md`.
- Tree changes: `tree-system.md`; update it with tree-file/type/layout changes.
- UI work under `app/`: `app/CLAUDE.md` and `design-system.md`.
- GEDCOM parsing or generation: the local, gitignored `GEDCOM Specs/extracted/` texts when available.

## Tool usage

- Use the built-in Read/Edit/Write/Glob/Grep tools for file and search operations. Only fall back to Bash (`cat`, `sed`, `grep`, `ls`, etc.) when those tools genuinely can't do the job. Don't prepend `cd` to Bash commands unless actually changing directories is required — the working directory already persists between calls.
- When the `LSP` tool is available, use find-references before changing an exported type, prop or client interface, including test mocks of that module. Confirm an LSP diagnostic with `npx tsc --noEmit` before acting on it.

## Non-negotiable implementation rules

- Routes validate HTTP; services hold business logic; reusable SQL belongs in `lib/db/queries/`. Routes never run SQL. Direct service SQL is only permitted inside a `getClient()` transaction.
- Resolve data access through `resolveTreeScope`; filter by `scope.treeId`, write both legacy owner and `TreeId`, and enforce its permission ladder. Dynamic Next 16 route params are awaited.
- SQL identifiers are double-quoted PascalCase and values use positional parameters.
- User-visible UI strings are translated in `messages/en.json`, `fr.json`, and `ru.json`; do not ship literals.

## Commands and verification

- Fast loop: `npm run test:fast`. Before a PR, run `npm run verify`: lint, the knip ratchet (a new unused export fails it) and `tsc` in parallel, then, if they pass, the unit suite and both integration suites in parallel. The Postgres suite runs only when `.env.test.local` names a reachable test database; otherwise `verify` says it skipped it. For UI changes, also run `npm run test:a11y` when warranted.
- Name every unit suite that boots PGlite `*.pglite.test.ts`; `test:fast` excludes that suffix. Mock-only suites stay `*.test.ts`.
- Testing is per slice: run the cheapest targeted checks as the implementation evolves. A test or verification command does **not** trigger agent code review.

## Review is PR-level, not slice-level

- When the branch has a coherent draft PR diff against `main`, run one bounded adversarial diff review. Batch fixes; re-review only materially changed hunks.
- High-risk PRs (schema or destructive data/file work, auth/access, upload validation, export/backup integrity, or verification-gate changes) receive a focused security/invariant review at that same PR boundary.
- State the PR-boundary review in the PR body: what it covered, what it found and fixed, and whether a review agent ran. Do not use broad multi-agent review for routine diffs.
- The agent token ledger is closed to per-PR logging (2026-09-23). Append to it only for a deliberate agent-cost measurement, such as re-testing delegation when a cheaper worker model ships.

## Git

- Feature branches target `main`; there is no `dev` branch. Merging does not deploy: production follows release tags. A release is a PR that bumps `package.json`, then a `v<version>` tag on its merge commit (the `release-deploy` skill has the steps).
- A PR's `Closes #N` closes the issue when it merges into `main`. Closed means merged, not shipped; the release tag records what shipped. The keyword must precede *every* reference — `Closes #A, #B` closes just `#A` — so put one `Closes #N` per line. `/audit-issues` has the detection pass.
- Preserve unrelated or pre-existing worktree changes. Do not reset, clean, or overwrite them.

## Claude-specific

- Claude auto memory is optional recall, not project policy. Keep durable shared rules in this repository, not memory.
- The project session hook is for supported Claude remote sessions only; do not make normal local work depend on it.
