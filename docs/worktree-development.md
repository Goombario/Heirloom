# Worktree development setup

Use a Git worktree for isolated feature and issue branches. A worktree has its own
checked-out files, but it shares Git objects and repository metadata with the main
checkout. Treat its dependencies, environment files, build output, and running
services as workspace-local state.

## Prerequisites

Before creating or bootstrapping a worktree, verify the versions declared by the
repository rather than relying on an older global installation:

```powershell
node --version
npm.cmd --version
```

- Node.js must satisfy `.node-version` and `package.json`: Node 24 or newer.
- npm must satisfy `package.json`: npm 11.16.0 or newer.
- The npm cache and the worktree directory must be writable by the account running
  the install.
- PostgreSQL is optional for the fast and unit tiers, but integration tests need the
  disposable test database: `npm run db:test:up` starts one with Docker Compose, and
  `.env.test.local` names it (see [`CONTRIBUTING.md`](../CONTRIBUTING.md)).
- Browser/a11y gates need a running application and Playwright's browser binaries.

The repository sets `engine-strict=true`. An older npm is therefore a hard setup
failure, not a warning to work around. In particular, npm 11.6.2 is known to mishandle
the lockfile's nested WASM optional dependencies; use npm 11.16.0 or newer before
running `npm ci`.

On Windows, prefer `npm.cmd` in PowerShell when execution policy or shim permissions
prevent the `npm.ps1` command from running.

## Windows test-tooling checks

Run the read-only doctor first. Browser checks use an explicitly configured
`PLAYWRIGHT_CHROMIUM_PATH`, a present Playwright-managed executable, or an
installed system Chrome/Edge automatically. Only when none of those is available
should you install Playwright's private browser once (or after a Playwright
upgrade), then use the non-installing accessibility and synthetic benchmark
commands:

```powershell
npm.cmd run doctor:test-tooling
npm.cmd run browser:install   # one-time or after Playwright upgrades
npm.cmd run test:a11y         # build + scan; no install
npm.cmd run benchmark:media-thumbnails
```

Repository scripts do not require a global `npx`; use `npm.cmd` and repository-local
binaries. `userInfoOk: false` is a host warning when the remaining checks are usable.
Repairing Node, npm, or the Windows MSI installation requires explicit user action;
the doctor only reports the condition and never installs or repairs software.

## Create and trust an isolated worktree

Worktrees belong under the ignored `.claude/worktrees/` directory. Create a branch
from the intended base commit, not implicitly from whichever branch happens to be
checked out:

```powershell
git worktree add ".claude/worktrees/<worktree-name>" -b "<branch-name>" <base-commit>
```

Some Windows or sandbox setups create the worktree as a different OS identity. If Git
reports `detected dubious ownership`, inspect the path in the error and add only that
exact worktree to the safe-directory list:

```powershell
git config --global --add safe.directory "C:/absolute/path/to/.claude/worktrees/<worktree-name>"
```

Do not use `safe.directory=*`. The narrow entry preserves Git's ownership check for
every unrelated repository.

## Bootstrap dependencies

The reliable strategy is a complete install inside each worktree:

```powershell
npm.cmd ci
```

`npm ci` must start with compatible Node/npm versions and a writable npm cache. Check
the active cache with `npm.cmd config get cache`. If that location is read-only, select
a user-owned cache directory before retrying, for example:

```powershell
npm.cmd config set cache "C:\Users\<user>\AppData\Local\npm-cache" --location=user
```

An interrupted or failed install can leave a partial `node_modules/`. Do not treat that
directory as a successful bootstrap, and do not use its results for final verification.
After correcting the runtime or cache problem, rerun `npm.cmd ci`; remove partial
dependencies only after confirming the exact worktree path and that no process is using
them.

For a short, targeted diagnostic when bootstrap is temporarily unavailable, an
already-bootstrapped main checkout can supply the Vitest executable while the isolated
worktree remains the project root:

```powershell
C:\path\to\main-checkout\node_modules\.bin\vitest.cmd run `
  __tests__/unit/<focused-test>.test.ts `
  --root C:\path\to\isolated-worktree
```

This is a fallback for focused tests, not a substitute for installing the worktree or
running its final gates. Other tools may resolve packages, generated files, and
environment state differently.

For a full local gate when a failed install cannot yet be repaired, a temporary
`node_modules` junction to a healthy main checkout is an evidence-backed last resort.
Use it only when `package.json` and `package-lock.json` are byte-identical in both
checkouts; otherwise install the worktree's own dependencies. Stop processes using the
worktree dependency directory before moving it, and restore any partial directory when
the gate finishes:

```powershell
$mainCheckout = 'C:\path\to\main-checkout'
$worktreeModules = Join-Path $PWD 'node_modules'
$heldModules = Join-Path $PWD 'node_modules.partial-failed-install'

foreach ($manifest in @('package.json', 'package-lock.json')) {
  $worktreeHash = (Get-FileHash -LiteralPath (Join-Path $PWD $manifest)).Hash
  $mainHash = (Get-FileHash -LiteralPath (Join-Path $mainCheckout $manifest)).Hash
  if ($worktreeHash -ne $mainHash) {
    throw "$manifest differs; refusing to share dependencies across checkouts."
  }
}
if (-not (Test-Path -LiteralPath (Join-Path $mainCheckout 'node_modules'))) {
  throw 'The main checkout has no dependency tree to share.'
}
if (Test-Path -LiteralPath $heldModules) {
  throw 'The holding path already exists; resolve it before moving anything.'
}

$hadWorktreeModules = Test-Path -LiteralPath $worktreeModules
$createdJunction = $false
if ($hadWorktreeModules) {
  Move-Item -LiteralPath $worktreeModules -Destination $heldModules -ErrorAction Stop
}
try {
  New-Item -ItemType Junction -Path $worktreeModules `
    -Target (Join-Path $mainCheckout 'node_modules') -ErrorAction Stop | Out-Null
  $createdJunction = $true

  npm.cmd run test:integration
  if ($LASTEXITCODE -ne 0) {
    throw "Integration tests failed with exit code $LASTEXITCODE."
  }
} finally {
  if ($createdJunction) {
    $junction = Get-Item -LiteralPath $worktreeModules -Force
    if ($junction.LinkType -ne 'Junction') {
      throw 'Refusing to remove node_modules because it is not the expected junction.'
    }
    Remove-Item -LiteralPath $worktreeModules -Force
  }
  if ($hadWorktreeModules) {
    Move-Item -LiteralPath $heldModules -Destination $worktreeModules -ErrorAction Stop
  }
}
```

Record this fallback in verification notes. CI or a clean worktree install remains the
authoritative dependency-isolated result.

## Choose the right verification tier

Run commands from the worktree root. Do not use the combined `npm test` as a shortcut:
it can discover integration and server-dependent tests without provisioning their
services.

Before running integration tests locally, create a worktree-local `.env.test.local`
that points only at the disposable database from `docker-compose.yml`:

In a managed or sandboxed agent shell, `docker version` may report access denied for
`//./pipe/docker_engine` even while Docker and the test container are healthy. Retry the
read-only Docker check with approved host access before diagnosing the engine as down.
Do not weaken Docker ACLs or expose the daemon to work around sandbox policy.

```powershell
Set-Content -LiteralPath .env.test.local -ErrorAction Stop `
  -Value 'DATABASE_URL=postgresql://postgres:testpassword@localhost:5433/genealogy_test'

$existingTestDb = docker ps -a --filter 'name=^/heirloom-test-db$' --format '{{.Names}}'
$startedTestDb = $false
$operationFailure = $null
$teardownExitCode = 0
try {
  if (-not $existingTestDb) {
    # Record ownership before startup: Compose may create the container and then
    # return nonzero while waiting for health.
    $startedTestDb = $true
    npm.cmd run db:test:up
    if ($LASTEXITCODE -ne 0) { $operationFailure = 'Failed to start heirloom-test-db.' }
  } else {
    $testDbHealth = docker inspect --format '{{.State.Health.Status}}' heirloom-test-db
    if ($LASTEXITCODE -ne 0 -or $testDbHealth -ne 'healthy') {
      $operationFailure = 'heirloom-test-db already exists but is not healthy; coordinate with its owner.'
    }
  }

  if (-not $operationFailure) {
    npm.cmd run test:integration
    if ($LASTEXITCODE -ne 0) {
      $operationFailure = "Integration tests failed with exit code $LASTEXITCODE."
    }
  }
} finally {
  if ($startedTestDb) {
    npm.cmd run db:test:down
    $teardownExitCode = $LASTEXITCODE
  }
}
if ($operationFailure) { throw $operationFailure }
if ($teardownExitCode -ne 0) { throw "Test database teardown failed with exit code $teardownExitCode." }
```

Tests load `.env.local` first and `.env.test.local` second, so this override prevents
integration cleanup and mutations from reaching the development database. Never put a
development or real-family-data database URL in `.env.test.local`. If
`DATABASE_URL` is absent—or deliberately blank in `.env.test.local` to override a value
from `.env.local`—database setup and database-dependent suites are skipped. Treat that
message as an environment-gated result, not a passing integration run.

The Compose service name and host port are shared across worktrees. Reuse an existing
healthy `heirloom-test-db`; do not restart or remove a container another session owns.
Run `db:test:down` only when the current session started it.

| Gate | Purpose | External requirements |
| --- | --- | --- |
| `npm.cmd run test:fast` | Tight unit TDD loop; excludes PGlite-booting and heavier UI suites | No PostgreSQL or app server |
| `npm.cmd run test:unit` | Complete unit suite, including in-process PGlite suites | No external PostgreSQL or app server |
| `npm.cmd run test:integration` | API, service, and real PostgreSQL behavior | Worktree-local `.env.test.local` for the disposable test database |
| `npm.cmd run test:integration:local` | Starts the Docker test database, then runs integration tests | `.env.test.local`, Docker, and free host port 5433 |
| `npm.cmd run test:a11y` | Browser-level accessibility scan | Playwright browser binaries and the app state expected by the scan |

Also select the normal static gates for the slice: `npm.cmd run lint`,
`npm.cmd exec -- tsc --noEmit`, and `npm.cmd run audit:knip:ci`. Report a missing database,
server, browser binary, or network download as an environment-gated check; it is not a
passing result.

## Failure checklist

When a new worktree behaves differently from the main checkout, check these in order:

1. Confirm the worktree branch and base with `git status --short --branch` and
   `git log -1 --oneline`.
2. Resolve only an exact `safe.directory` ownership error.
3. Confirm Node 24+ and npm 11.16.0+.
4. Confirm the npm cache and worktree are writable.
5. Ensure `npm ci` completed and did not leave a partial dependency tree.
6. Choose the test tier whose database/server/browser prerequisites are actually
   running.
7. Preserve unrelated worktree changes; never reset or clean them as a setup fix.
