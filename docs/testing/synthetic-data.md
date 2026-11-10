# Synthetic test data

This repository includes a privacy-safe fixture generator. It creates invented
people, relationships, places, events, notes, sources, a repository, citations,
generated PNG images, confirmed face tags, and face-review candidates. It never reads the private `test-data/`
directory or any user database.

## What the citations cover

Seven sources (one uncited) carry about a hundred citations across every fact kind
the person and family pages cite: whole person, name, birth, death, name variant,
events and families. The first 40 people have a registry birth citation, and the
deceased among them alternate a registry death citation. Person 1 is the dense
case: three citations on the birth, plus name, whole-person and event citations.
Family F001 has two citations of its own and a cited family event.

A person's birth and death live on the `People` row, as the app writes them, so the
fixture creates no person `BIRT` or `DEAT` Events rows.

## Static/local testing

Generate the browser-loadable fixture from the worktree root:

```powershell
npm.cmd run fixture:synthetic
npm.cmd run fixture:synthetic:verify
```

The commands create `test-fixtures/synthetic.hlbak` and its aggregate-only
manifest. In a static build, open Options → This device → Restore and select that
`.hlbak` file. Restore replaces the local PGlite database, so use it only in a
disposable browser profile or a profile whose data has already been backed up.

The fixture contains the local identity `local@web`, which is the identity used by
the static/PGlite build. Reload after restore so the app reinitializes its local
user and tree state.

## Hosted/PostgreSQL testing

Point `DATABASE_URL` at a disposable PostgreSQL database and provide the account
email used by the hosted test session:

```powershell
npm.cmd run db:seed:synthetic -- --email qa@example.test
```

Optional arguments are `--tree-name "Synthetic QA Fixture"` and `--tree-id 42`.
Without `--tree-id`, the command creates a new tree for the selected account. A
numeric target tree must belong to that account and be empty; non-empty trees are
rejected. The command never truncates or deletes a tree, and it prints only
aggregate counts plus the target tree ID.

Hosted image files are written below the configured `DATA_DIR/uploads/<ownerId>/media`
directory with a `synthetic-` filename prefix. Use a disposable test volume; do
not point this command at a production or real-family-data database.

## Regenerating

The source of truth is `scripts/synthetic-data-fixture.ts`. If the schema or fixture
contract changes, regenerate and verify the artifact, then run the focused fixture
tests. The checked-in manifest contains only schema/generator versions and counts;
it is not a database export.
