---
name: Tracking issue (phased epic)
about: A checklist of child issues grouped into phases, runnable with /work-tracking-issue
title: "Tracking: "
labels: []
---

<!--
Format contract: .claude/skills/work-tracking-issue/SKILL.md, section "Tracking issue format".
- Phases are "## <n>. <heading>" sections in execution order.
- Child lines are exactly "- [ ] #<number> <short title>". Use checkbox syntax nowhere else in a phase.
- Unnumbered "##" sections (such as "Related existing issues") are ignored by the runner.
- Keep "## Runner notes" as the last section.
-->

<One or two sentences on the goal.>

- Source: <report, spec or decision doc>

## 1. <Phase heading>

- [ ] #<number> <short title>
- [ ] #<number> <short title>

## 2. <Phase heading> (after #<number>)

- [ ] #<number> <short title>

## Related existing issues

<#numbers and one-line reasons, if any>

## Runner notes

- **Branch:** `feat/<initiative>`
- **Base:** `main`
- **Skip:** <phase sections or #numbers, with a reason; or "none">
- **Decisions:** <documents whose decisions are final>
- **References:** <reports, specs, mockups>
- **Verify:** <behavioural or visual check to run at phase end>
