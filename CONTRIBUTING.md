# Contributing to Heirloom

Thanks for helping. Bug reports, fixes, translations and documentation improvements are all
welcome. For anything larger than a small fix, please open an issue first so we can agree on
the approach before you spend time on it.

## Reporting bugs

Open an issue with the flavour (hosted server, static site or desktop app), the version from
the About page, what you did, what you expected and what happened.

**Never attach real family data.** If a bug needs a GEDCOM file to reproduce, cut it down
and replace the names, dates and places with invented ones. For security problems, follow
[SECURITY.md](SECURITY.md) instead of opening an issue.

## Setting up

Follow [Getting started](README.md#getting-started) in the README. `npm run dev:static` needs
no database or Google setup and is the quickest way to try a change.
[docs/worktree-development.md](docs/worktree-development.md) covers the test prerequisites.

## Before you write code

Read [`architecture.md`](architecture.md). The rules that reviews check most often:

- **Three layers.** Routes validate HTTP, services hold the business logic, and reusable SQL
  lives in `lib/db/queries/`. Routes never run SQL.
- **Tree scope.** All data access goes through `resolveTreeScope`, filters by the tree, and
  respects its view, contribute and edit permissions.
- **SQL.** Identifiers are double-quoted PascalCase (`"People"."FirstName"`) and values use
  positional parameters (`$1`), never string building.
- **Translations.** Every string a user sees goes in `messages/en.json`, `fr.json` and
  `ru.json`. If you can't translate, add the English text to all three and say so in the pull
  request.
- **UI.** Follow [`design-system.md`](design-system.md) and [`app/CLAUDE.md`](app/CLAUDE.md).
- **Tree code.** Follow [`tree-system.md`](tree-system.md), and update it when you change the
  tree's files, types or layout.
- **Both data modes.** Most features run against PostgreSQL on the hosted server and against
  PGlite in the static site and desktop app. Check that a change works in both.

Deliberate design decisions are recorded in [`docs/decisions/`](docs/decisions/). If your
change goes against one, say so in the issue first. Landed decisions are not edited; a new
decision supersedes an old one.

## Tests

- `npm run test:fast` is the quick loop while you work.
- `npm run verify` must pass before a pull request: lint, the dead-code ratchet (a new unused
  export fails it), type checks, then the unit and integration suites. The PostgreSQL suite
  runs only when `.env.test.local` names a test database (`npm run db:test:up`).
- Add or update tests for what you change. A unit test that boots PGlite is named
  `*.pglite.test.ts`.
- For UI changes, run `npm run test:a11y` where it is relevant.

## Pull requests

- Branch from `main` and open the pull request against `main`. Merging does not deploy
  anything: the maintainer releases by tagging a version.
- Keep each pull request to one change. Say what it does, why, and how you tested it, and
  link the issue it fixes (`Closes #123`).
- Don't commit credentials, `.env` files, database exports or real family data.

Issue and pull request numbers (`#123`) in code comments and docs written before the public
launch refer to the project's earlier, private tracker, not to this repository's issues.

## AI coding agents

`CLAUDE.md`, `AGENTS.md` and the skills under `.claude/skills/` and `.agents/skills/` are
instructions for AI coding agents. They hold the same rules as this guide. You're welcome to
use an agent, but you are responsible for the pull request: review the diff yourself and
make sure the tests pass.

## Licence of contributions

Heirloom is licensed under [AGPL-3.0-or-later](LICENSE). By contributing, you agree that your
contribution is licensed under the same terms. There is no contributor licence agreement.
