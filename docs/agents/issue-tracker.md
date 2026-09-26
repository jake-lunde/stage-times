# Issue tracker: the jaique vault

Issues, specs, and tickets for this repo live in the **jaique vault**
(`/Users/jake/jaique`, Obsidian, its own git repo — commit there
separately). There is no GitHub Issues or `.scratch/` tracker; the vault is
the single home for tasks. Cloud sessions cannot reach it, so
tracker-writing skills run locally only.

This mirrors `portfolio-2026/agents/issue-tracker.md`. The one thing that
differs is the effort.

## The effort

`Efforts/On/🎪 Stage Times (E).md`. Task notes live in
`Efforts/Notes/Stage Times/`. Public "found an error?" reports from the
site still arrive as GitHub issues on `jake-lunde/stage-times`; those are
inbound corrections, not tracked work, and never get turned into vault
tickets unless Jake asks.

## Where things live

- **Specs** (from `/to-spec`): one note per feature at
  `Efforts/Notes/Stage Times/spec — <feature>.md`, frontmatter
  `up: [[🎪 Stage Times (E)]]` only — no `status:`, so the Up Next board
  ignores it. Body = the spec template verbatim.
- **Tickets** (from `/to-tickets`): one note per ticket at
  `Efforts/Notes/Stage Times/<NN> <ticket title>.md`, numbered from `01`
  in dependency order. Frontmatter:

  ```yaml
  up:
    - "[[🎪 Stage Times (E)]]"
  related:
    - "[[spec — <feature>]]"
  created: YYYY-MM-DD
  status: scoped
  blocked-by:
    - "[[01 first ticket title]]"   # omit the key when unblocked
  ```

  Body = "What to build" + acceptance-criteria checkboxes, per the
  to-tickets template. No file paths or code snippets (prototype-derived
  decision snippets excepted).

## Status vocabulary (= triage roles)

Task statuses are `scoped` · `up-next` · `in-progress` ·
`waiting-on-jake` · `done` · `dropped`. When a skill speaks a triage
role: `ready-for-agent` → `scoped` (with every `blocked-by` entry
`done`), `ready-for-human` → `waiting-on-jake`, `wontfix` → `dropped`.
`needs-triage` and `needs-info` are unused — a solo project has no
inbound queue; don't apply them.

## The frontier

Work any ticket whose `status:` is `scoped` or `up-next` and whose
`blocked-by` notes are all `done`. The nightly Up Next board
(`AIOS/Scripts/up-next-board`) ranks unblocked over blocked and reads
`blocked-by:` as the machine-readable form of "Depends on". Set
`status:` as you claim (`in-progress`) and finish (`done`) a ticket.

## When a skill says…

- **"publish to the issue tracker"** → write the notes above into the
  vault, then commit the vault.
- **"fetch the relevant ticket"** → read the vault note; Jake will
  usually name the ticket.
- **"apply the triage label"** → set the mapped `status:`.
- **"close the ticket"** → `status: done`; record what shipped on the
  effort page's `## Shipped`.

Never mint tickets Jake didn't ask for: `/to-tickets` runs only on work
he's asked to structure.

## Lanes

A ticket may carry `lane:` in its frontmatter. `lane: jake` marks taste
work (new screens, copy, owner decisions): work it with Jake, never
alone. Omitted means a session may build it once Jake names it.
`/to-tickets` asks which tickets are Jake's when it publishes.

## Building a ticket

One ticket at a time, in the session Jake is in, on its own branch.
Before Jake looks, one reviewer on a different model (a subagent with no
edit tools) reruns the tests and checks the work against the acceptance
boxes. Then merge to `main` locally; pushing is Jake's call.

The unattended ticket runner (`/run-tickets`, source in the vault at
`AIOS/Scripts/ticket-runner/`) is parked since 2026-09-26. Don't start it.
