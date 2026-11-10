---
name: work-tracking-issue
description: Work through a phased tracking issue (a GitHub issue whose body is a checklist of child issues grouped into phases) in a single session. It audits the phase's issues for drift, implements each child itself, makes one commit per child issue on a shared feature branch, ticks the checklist as work lands, and opens one PR per phase before stopping for review. Use when asked to continue or run a tracking issue such as "/work-tracking-issue 715".
---

Run the current phase of a tracking issue and stop at the phase boundary for maintainer review.

**Argument:** the tracking issue number (for example `715`). If none is given, ask for it.

The tracking issue is the only state. Its checkboxes say what's done, and its **Runner notes**
block says how to run it. This skill holds the process only. It never holds a specific
initiative's facts, so it can be reused for the next audit or epic.

## Execution model: one session, no sub-agents

Do the whole phase yourself: the audit, the implementation, the gates, Verify and the routine
review. **Don't spawn worker, search or review sub-agents**, with one exception: a high-risk
phase gets one fresh review agent at the PR boundary (section 4). There, a reviewer that didn't
write the code is worth its cost, about $1–2.

Why: #715 measured it (agent token ledger, 2026-09-22). With Opus 5.5 as the
session model, cache reads cost the same per token as on Sonnet 5 ($0.20/MTok). So handing reads
to a cheaper worker saves nothing. Each cold-started worker re-writes its own cache (the #719
workers wrote about three times the orchestrator's cache) and has to re-derive context, which
cancels the output-price saving. Phase 3 alone cost about $7. PR #719's orchestrator plus Sonnet
workers cost about $18.60 on Opus 5 pricing, and about $13.30 re-priced for Opus 5.5, against
about $12.90 estimated for one Opus 5.5 session. Briefing overhead, worker reverts and rework risk
also go away.

**Split long phases across sessions.** The tracking issue is the only state, so after any child
is committed, pushed and ticked, the phase can stop and resume in a fresh session. Do that when
the context passes about 250k tokens rather than letting it compress. Every call re-reads the
whole context, so a bloated session costs more on each call and loses detail when it compresses.

**Revisit this** when the price gap reopens, for example when a Sonnet 5.5 ships or the
session model changes. The rule of thumb: delegation only pays when the worker's per-token
cache-read price is well below the session model's, and the slice is large and read-heavy.

## 0. Read the tracking issue

`gh issue view <N>`. From the **Runner notes** block (template at the end of this file), read:

- **Branch:** the shared feature branch.
- **Base:** the integration branch phase PRs target. If absent, use `main`.
- **Skip:** sections or issues this runner must not touch.
- **Decisions:** documents whose decisions are final. Don't re-litigate them.
- **References:** reports and mockups to consult for each child issue.
- **Verify:** the visual or behavioural check to run at phase end.

If the block is missing, stop and ask for it. Don't invent a branch name or scope. If the issue doesn't
follow the **Tracking issue format** below, report exactly what's malformed and stop.

The **current phase** is the first numbered `##` phase section that has an unchecked, non-skipped
child. Work only on its unchecked, non-skipped children, in the listed order. If the previous
phase's PR is still open, stop: don't start a phase until the maintainer has merged the last one.

## 1. Branch and push safety

Everything reaches `<base>` **only** through a PR the maintainer merges. The runner never pushes to,
merges into, or merges its own PR into `<base>` or `main`.

- **First run:** `git fetch origin`, then `git switch --no-track -c <branch> origin/<base>`, then
  `git push -u origin <branch>`.
- **Later runs:** `git switch <branch>`, then **update the feature branch from `<base>`** with
  `git fetch origin && git merge origin/<base>`. This merges `<base>` *into the feature branch*;
  it changes nothing on `<base>`.
- **Before every push**, check `git rev-parse --abbrev-ref @{u}`. It must print
  `origin/<branch>`. If it prints anything else, stop. A feature branch whose upstream is
  the base branch would publish straight to it.
- Push with an explicit refspec: `git push origin <branch>`.
- If the working tree has changes you didn't make, stop and report. Never stash, reset or
  overwrite them (`CLAUDE.md`, Git).

## 2. Audit the phase before working it

Child issues were written against an older commit. Line numbers drift, earlier phases or other
PRs may have fixed part of an issue, and a later decision may have superseded one.

1. Apply **steps 2–3 of `.claude/skills/audit-issues/SKILL.md`** to the current phase's unchecked
   child issues only, **read-only**. Use targeted `grep`s and short `sed -n` ranges, not whole-file
   reads. Produce the step-4 verdict table (`still reproduces` / `fixed` / `superseded` /
   `narrowed` / `unverifiable`) with one line of evidence per issue. Don't comment on, close or
   retitle anything.
2. **All `still reproduces`:** carry on. Keep refreshed line numbers in your own plan; don't
   edit the issues.
3. **Any other verdict:** show the table and ask. `AskUserQuestion` with a recommended option is
   the quickest way. Per `audit-issues`, closing or retitling needs the maintainer's
   confirmation. Resume once they've decided.

## 3. Per child issue

1. Read the child issue and its linked reference section. Grep the report's headings first, then
   read only the sections the child cites.
2. Settle the design once (a primitive's API, a copy decision, a mapping), then apply it across
   call sites. When a change touches many files, script the mechanical part (a short Python
   replace that asserts each `old` string matches exactly once) instead of hand-editing each file.
3. Keep the context lean. Read hunks, not whole files; summarize long command output rather than
   pasting it; don't re-read a file you just edited.
4. Test per slice with the cheapest check: `npx tsc --noEmit`, eslint on changed files, targeted
   `vitest run` files, then `npm run test:fast` before committing. Update tests that pinned the
   old behaviour and add focused ones for the new behaviour.
5. Keep all three catalogs in step (`messages/en.json`, `fr.json`, `ru.json`). Drop keys your
   change orphans, after grepping `app`, `lib` and `__tests__` for them.
6. Make **one commit per child issue**, with a message ending in `(#<child>)`. Use two commits
   only if the issue has clearly separate slices. Push (section 1 rules).
7. Tick the child's checkbox in the tracking issue, changing only that line:
   `gh issue view <N> --json body -q .body > body.md` (in the scratchpad), edit that one
   `- [ ]` line to `- [x]`, then `gh issue edit <N> --body-file body.md`.
8. If a child issue needs a decision the maintainer hasn't made, or it has turned out larger than
   its description, **stop and ask**. Don't guess, and don't silently narrow the scope.

## 4. Phase end

When every non-skipped child in the current phase is ticked:

1. Update the feature branch from `<base>` again (section 1), and resolve conflicts yourself.
2. Run **every gate CI runs** for the change:
   - `npm run verify`. It runs lint, the knip dead-code ratchet and `tsc`, then the unit and
     integration suites in parallel. A new unused export (such as an exported props type nothing
     imports) fails knip. If database or API behaviour changed and `verify` skipped the Postgres
     suite, say so in the PR body.
   - `npm run test:a11y` for UI changes (it builds the static app first)
3. Run the **Verify** recipe from the runner notes yourself, as a Playwright script in the
   scratchpad that reports failures only. Save screenshots to the scratchpad and look at only a
   few representative ones. Pitfalls:
   - import Playwright and `scripts/lib/managed-static-preview.mjs` by absolute path, because
     ESM ignores `NODE_PATH`;
   - check empty-state behaviour **before** restoring the fixture;
   - restore once and keep that browser context, because IndexedDB doesn't reliably carry
     through `storageState`;
   - an `addInitScript` that sets the theme re-runs on every navigation, so switch themes
     through that script, not with a later `localStorage` write;
   - on mobile, rail content can sit behind a tab, so a missing element may not be a bug;
   - separate known out-of-scope errors (named in the Skip list) from new ones.
4. Open a PR **from the feature branch to `<base>`** (`gh pr create --base <base> --head <branch>`),
   titled `<tracking title> — phase <n>: <phase heading>`. The body gets:
   - a summary per child;
   - the verification evidence and any known gaps;
   - **one `Closes #<child>` line per child**. `main` is the default branch, so merging the
     phase PR closes them (`CLAUDE.md`, Git). If `<base>` is some other branch, the keywords
     are ignored and the children stay open until the maintainer closes them.
5. Run **one** bounded adversarial review of the PR diff (`git diff origin/<base>`), looking for
   correctness bugs, edge cases and invariant breaks:
   - **Routine phase:** review it yourself, inline.
   - **High-risk phase** (auth, access, data, uploads, export or backup, or a change to a
     verification gate): dispatch **one** fresh `security-reviewer` agent over the diff. It is
     read-only and returns findings only. The author's own review shares the author's blind
     spots, and these are the phases where that matters.

   Fix what the review finds, and re-review only materially changed hunks. State the review in
   the PR body: what it covered, what it found and fixed, and whether an agent ran.
6. After CI reports on the PR (`gh pr checks <pr>`), fix any failure before reporting.
7. **Stop and report:** the PR link, the children covered, the audit verdicts, and anything
   deferred or questionable. **Don't merge the PR yourself**, and don't start the next phase
   until the maintainer has merged it.

## Budget discipline

- Cache reads dominate cost: every call re-reads the whole context. Fewer, denser tool calls
  beat many small ones, so batch independent reads and checks into one call.
- Prefer `grep`, targeted `sed -n` ranges and `git diff --stat` over whole-file reads.
- Don't paste long command output into the conversation. Filter it (`grep -E "FAIL|×|Tests "`,
  `tail`) and summarize.
- Don't re-run a passing gate unless the code it covers has changed since.

## Tracking issue format

The runner depends on this structure. `.github/ISSUE_TEMPLATE/tracking-issue.md` starts a new
tracking issue in this shape.

- **Title:** `Tracking: <initiative>`. Phase PR titles reuse it.
- **Intro:** a few lines on the goal, with links to the source report or spec.
- **Phases:** each phase is a `## <n>. <heading>` section, in execution order. A phase may say what
  it depends on in its heading or first line, for example `(after #688, #687 and #689)`.
- **Children:** one line per child issue, exactly `- [ ] #<number> <short title>`. Ticked is
  `- [x]`. Nothing else in a phase section uses checkbox syntax, so the runner can count
  reliably. Put notes in plain bullets or paragraphs.
- **Optional non-phase sections** (for example "Related existing issues") use headings without a
  leading number. The runner ignores them.
- **Runner notes:** a `## Runner notes` section, last in the body, with these keys:

| Key | Required | Meaning |
|---|---|---|
| Branch | yes | Shared feature branch, created from `<base>` on first run |
| Base | no (default `main`) | Integration branch that phase PRs target |
| Skip | no | Phase sections or child issues the runner must not touch, with a reason |
| Decisions | yes | Documents whose decisions are final |
| References | no | Reports, specs or mockups to consult per child |
| Verify | yes | The behavioural or visual check to run at phase end |

A child in **Skip** stays unticked until the maintainer ticks it (for example after its own PR
merges). Skipped work never blocks a phase: the phase is complete when every non-skipped child is
ticked.

## Runner notes template

Add this block to the tracking issue's body (the maintainer edits it; this skill only reads it):

```markdown
## Runner notes

- **Branch:** `feat/<initiative>`
- **Base:** `main`
- **Skip:** section 6 (standalone PRs), #NNN (in progress elsewhere)
- **Decisions:** `docs/<report>.md` §13 (final)
- **References:** `docs/<report>.md`; <mockup link>
- **Verify:** `npm run build:static`, serve `out/`, restore `test-fixtures/synthetic.hlbak`
  via Options → Local Data; check the touched pages in light and dark at 1440px and 390px.
```
