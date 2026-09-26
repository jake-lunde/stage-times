# Domain Docs

How the engineering skills consume this repo's domain documentation.
Layout: **single-context** — one `CONTEXT.md` at the repo root, ADRs in
`docs/adr/`.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the Stage Times glossary.
- **`docs/adr/`** — decision records touching the area you're in.

If a file doesn't exist yet, proceed silently; `/domain-modeling` creates
entries lazily when a term or decision actually crystallises.

## The lanes — one home per fact

Deciding *where a decision goes* is the load-bearing part:

- **`docs/adr/`** — hard-to-reverse **technical** decisions and their
  why: why this seam, this data shape, this URL. The record that stops a
  future session re-litigating. The permanence contract in `README.md`
  is the oldest of these and stays where it is.
- **Vault rulings** (the effort page and task notes in the jaique vault)
  — Jake's **taste, product, and process** calls: how he wants the work
  done, what a thing should feel like. Never duplicate these as ADRs; an
  ADR may *cite* a ruling by date.
- **`CLAUDE.md`** — binding law and standing facts only, and it stays
  short by pointing at `README.md` and the design skill rather than
  repeating them.
- **The design skill** (`.claude/skills/stage-times-design/`) — every
  visual and copy rule. Load it before touching HTML, CSS, or copy.
- **Claude memory files** — machine mechanics and tool gotchas, never
  decisions.
- **`CONTEXT.md`** — vocabulary only: what a term means, never why a
  decision was made.

## Use the glossary's vocabulary

When output names a domain concept (ticket title, spec, refactor
proposal, test name), use the `CONTEXT.md` term. A concept you need that
isn't in the glossary is a signal: either you're inventing language the
project doesn't use, or there's a real gap — note it for
`/domain-modeling`.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly:

> _Contradicts ADR-0001 (fan namespace prefix), but worth reopening because…_
