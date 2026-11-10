---
name: audit-issues
description: Verify open GitHub issues against live code to find drift — issues fixed but not closed, superseded, or whose described mechanism no longer matches. Use periodically, before a release, or when the backlog is suspected stale.
---

Verify the open issue backlog against the **current** code and report drift.

This exists because the repo previously tracked work in a long markdown document that silently
went stale — items shipped without being marked, issues were superseded without being closed,
and cited measurements drifted by 2x. Issues now hold state instead (see
`docs/decisions/README.md` for why), and this skill is how that state gets re-verified.

## The rule that makes this useful

**Never trust the issue text. Grep the code.**

An issue is a claim about the codebase, written at a point in time. Your job is to re-test the
claim, not to summarize it. The single most common finding is an issue whose *bug* was fixed
but whose *description* still reads as current — you only catch that by opening the file.

Never mark something verified because a commit message or PR title says so. Commit messages
describe intent; only the code describes behavior.

## Steps

### 1. Pull the backlog

```bash
gh issue list --state open --limit 200 --json number,title,labels,updatedAt \
  | jq -r '.[] | "#\(.number) [\([.labels[].name] | join(","))] \(.title)"'
```

Scope with `--label` when auditing one area (e.g. `--label area:gedcom`). A full pass over
~50 issues is expensive; a labelled pass is the normal mode.

### 2. Classify each issue before touching it

| Class | How to verify |
|---|---|
| **Concrete defect** (names a file, function, or behavior) | Grep the cited site. Does the mechanism still exist? |
| **Enhancement / feature** | Does the feature now exist? Search for its likely entry point. |
| **Epic / tracking issue** | Check whether all children closed. |
| **Decision item** (`needs:decision`) | Not verifiable by code — check only whether the decision was recorded in `docs/decisions/`. |

Skip nothing silently. An issue you cannot verify is a finding ("could not verify — no cited
site"), not an omission.

### 3. Verify against live code

For each concrete defect:

1. **Read the cited lines.** Line numbers drift — search for the surrounding code, not the
   number. If the issue cites `foo.ts:229`, grep for the function, then check whether the
   described logic is still there.
2. **Check for a fix that missed the close.**
   ```bash
   git log --oneline --all --grep="#<number>"
   git log --oneline -5 -- <the file the issue names>
   ```
3. **Re-measure any number the issue quotes.** Counts of files, occurrences, violations, and
   timings all drift. This has already caught a 1,287 → 577 drift once.
4. **Check for supersession.** A later decision may have removed the feature entirely rather
   than fixing it — that closes the issue just as validly as a fix. `docs/decisions/` is the
   place such reversals are recorded.

### 4. Report before acting

Produce a table, then **stop and get confirmation before closing anything**:

| # | Title | Verdict | Evidence |
|---|-------|---------|----------|
| #NNN | ... | **still reproduces** / **fixed** / **superseded** / **narrowed** / **unverifiable** | file:line, or commit sha |

Closing an issue is destructive to the backlog's memory. Never batch-close without the
maintainer seeing the list first.

### 5. Apply, with evidence in every comment

When closing, the comment must let a future reader re-verify without redoing the work:

- **Fixed** — name the commit sha or PR, and the file:line where the fix lives.
- **Superseded** — name the decision or PR that removed the need, and say what replaced it.
- **Narrowed** — do **not** close. Comment with what already shipped and what remains, and
  retitle the issue so its title matches the residue. (Example: #69 was a migration task whose
  migration already shipped; it is now a table-retirement task.)

Retitle whenever the title no longer describes the remaining work — a stale title is the thing
that makes a backlog unreadable.

## Verdict definitions

- **still reproduces** — mechanism present in current code. Leave open. Refresh the body if
  line numbers moved.
- **fixed** — mechanism gone. Close with the commit.
- **superseded** — the surrounding feature was removed or redesigned so the issue is moot.
  Close, citing the decision.
- **narrowed** — partially shipped. Stay open, comment, retitle.
- **unverifiable** — no cited site and no obvious entry point. Comment asking for a repro;
  leave open.

## What to also check on a full pass

- **Labels.** Every open issue should carry one `area:*`, one `kind:*`, and one `pri:*`.
  Report unlabelled issues.
- **`needs:decision` items.** These block on the maintainer, not on effort. Surface them
  together — they are the cheapest thing to unblock and the easiest to forget.
- **Stale `needs:decision` after an ADR.** The label means "waiting on a maintainer call".
  Once a record in `docs/decisions/` makes that call, leaving it on is an active lie about
  state — #490 and #400 carried it for a day after ADR 0012 decided both. Cross-check every
  `needs:decision` issue against the ADR index and strip the ones already answered.
  ```bash
  gh issue list --label needs:decision --state open --json number,title
  grep -rone '#[0-9]\{2,3\}' docs/decisions/*.md | sort -u
  ```
- **ADR-decided issues with no comment.** An ADR holds *rationale*; the issue must hold
  *state*. Any issue number referenced by a landed ADR should have a comment saying what
  that ADR decided for it. A silent decision is indistinguishable from no decision to
  anyone reading the backlog.
- **Deferred work that looks active.** `status:deferred` = decided not-now by an ADR,
  explicitly not rejected; its comment must name what would unblock it. Flag ADR-deferred
  issues still sitting unlabelled in the active backlog. ⚠️ Only label an issue deferred
  when its **own titled subject** is the deferred part — if a sub-item in the comments is
  deferred while the titled work proceeds, labelling the issue hides live work.
- **Shipped but never auto-closed.** Two silent failures leave fixed work sitting open, and
  both hit the v0.14.2 release at once (17 issues):
  1. **A comma-list closes only its first reference.** GitHub needs the keyword before *every*
     issue. Commit `7371c5a2`'s `Closes #481, #438, #431, #208` closed **only #481**; commit
     `428be06c`, which wrote `Closes #457` and `Closes #458` on separate lines, closed both.
     Nothing warns — the extra numbers just render as plain links.
  2. **Only default-branch merges auto-close.** `main` is the default branch, so a PR into
     `main` closes its issues on merge. A PR into any other branch (a stacked PR) closes
     nothing, and GitHub never re-evaluates a PR after it merges.

  Two passes — the first covers `main`'s history, the second merged PR bodies, including any
  that targeted a non-default branch:
  ```bash
  open=$(gh issue list --state open --limit 300 --json number -q '.[].number' | sort -u)
  claimed() { grep -iE '^[[:space:]]*(clos|fix|resolv)[a-z]*[[:space:]]+#'     | sed -E 's/[[:space:]](refs?|see|part of)[[:space:]].*$//I'     | grep -oE '#[0-9]+' | tr -d '#' | sort -u; }
  comm -12 <(git log origin/main --format='%B' | claimed) <(echo "$open")
  comm -12 <(gh pr list --state merged --limit 100 --json body -q '.[].body' | claimed) <(echo "$open")
  ```
  Output is **candidates to eyeball, not a close list** — a PR can claim an issue it did not
  actually fix. #478 shows up here and is correctly open: PR #612 listed it, but the PR body
  says it could not be reproduced and the change only eliminated a hypothesis. Verify each
  against the code per the rule above, then close through step 4.

  **Prevention:** put the closing keywords in the **PR body** that targets `main`,
  **one `Closes #N` per line**, and confirm with `gh issue list` after the merge. A release
  closes nothing; its `v<version>` tag records what shipped.

- **Closed-but-referenced.** Grep `docs/` for issue numbers that are now closed; stale
  references in docs are exactly the drift this process exists to kill.
  ```bash
  grep -rone '#[0-9]\{2,3\}' docs/*.md | sort -u
  ```

## Cost control

Verification is grep-heavy. Batch independent greps into single tool calls, and read only the
cited region of a file rather than the whole thing. A labelled pass over one area should be a
handful of batched calls, not one call per issue.

Do **not** spawn subagents for this unless explicitly asked — the verification needs the whole
backlog in one head to spot supersession across issues.
