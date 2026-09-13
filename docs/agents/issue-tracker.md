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

A ticket may carry `lane:` in its frontmatter. Omitted means `agent`:
the ticket runner may claim it. `lane: jake` marks taste work (new
screens, copy, owner decisions) that only Jake does; the runner never
claims it and lists it as his instead. `/to-tickets` asks which tickets
are human-lane when it publishes.

## The ticket runner

`~/.claude/skills/run-tickets/run.mjs` (source of truth: the vault at
`AIOS/Scripts/ticket-runner/`) works the frontier unattended: claim,
worktree, implement on one model, review on another against the
acceptance boxes, merge to `main` locally, never push. It reads its
tracker from the block below. Dry run first:

```
node ~/.claude/skills/run-tickets/run.mjs --dry-run
```

```json ticket-runner
{
  "tracker": "jaique",
  "vault": "/Users/jake/jaique",
  "effort": "Stage Times",
  "ticketsDir": "Efforts/Notes/Stage Times",
  "effortPage": "Efforts/On/🎪 Stage Times (E).md",
  "main": "main",
  "readFirst": ["CLAUDE.md", "README.md", "HANDOFF.md", "CONTEXT.md"],
  "rules": [
    "Never change normalizeArtist, UID derivation, UID_DOMAIN, a stage id, or an edition's namespace after first publish (README.md, the permanence contract).",
    "Never let the build read the wall clock. No database. Never auto-list. Never delete a published slug.",
    "Load .claude/skills/stage-times-design (and its references/copy.md) before writing any HTML, CSS, or page copy.",
    "Don't put a feed URL, a repo path, or the word \"we\" on a page."
  ]
}
```
