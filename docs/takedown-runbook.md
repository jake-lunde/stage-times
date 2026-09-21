# Takedown runbook: blocking an edition

A **takedown** is the request. **Blocked** is the state it puts an edition in. Vocabulary is
`CONTEXT.md`; the product decisions behind this page are in the vault spec (self-serve
editions, 2026-09-06, "Takedown"). This page is the procedure.

The posture: **block within a day of a plausible request, discuss after.** The rights holder's
request is honored first. A blocked edition is never deleted and never listed, and every feed
URL it ever served keeps answering — empty — so no subscriber ever sees a 404.

## Who can ask

| Requester | Channel | What happens to the stored source image |
|---|---|---|
| **Rights holder** — the festival or its representative | Email to the owner, at the address on every page | **Deleted** in the same commit as the block |
| **Uploader** — the person holding the edition's update link | "Take it down" on the update link's page: the publisher commits the block itself (`remove` in `src/publisher.ts`) | **Kept** — a self-removal is not a rights claim, and the image is the evidence behind the times |
| Anyone reporting a wrong time | The public issue link on the page | Not a takedown. Fix the YAML instead. |

Plausible means: the requester names the edition and plausibly speaks for the festival. Do not
demand proof before blocking; ask afterwards if it matters.

## The block: one line

Every edition has a record in `state/published.json`, keyed by its URL path — `<slug>-<year>`
for an owner edition, `fan/<slug>-<year>` for a fan edition. Flip its `blocked` flag:

```diff
   "fan/coachella-2027": {
     "slug": "coachella",
     "year": 2027,
     "namespace": "fan",
     "listed": true,
-    "blocked": false,
+    "blocked": true,
     "stages": ["main", "outdoor", "sahara"]
   }
```

Leave `listed` as it is. The build treats a blocked edition as unlisted whatever `listed`
says, so the block is one line and the listing survives the revert.

Do **not** delete or edit the edition's YAML, and do not touch `state/sequences.json`. The
YAML stays so every published stage keeps its name; the sequence ledger stays so an unblock
resumes exactly where it left off.

Then, in the same commit:

- **Rights-holder block:** delete the stored source image for the edition (the file named by
  content hash that the transcription log references; see ticket 07 for where it lives).
  Note the requester and date in the commit message.
- **Self-removal:** keep the image. Note "self-removal" in the commit message.

Commit on `main`, push, and the production deploy does the rest. `npm test && npm run build`
first if you want to see it locally: the build log says `BLOCKED — empty feeds` for that
edition.

## What the site does with a blocked edition

- Every feed URL the edition ever served — each stage `.ics` and `all.ics` — returns HTTP 200
  and a valid calendar with **zero events** and the **original calendar name**. A subscriber's
  calendar goes blank at their next refresh; the calendar itself stays in their sidebar until
  they remove it.
- The edition's page at its URL becomes the **removed page**: it says the page was taken down,
  points at the official schedule, and carries no stage cards or calendar buttons. Copy is in
  `.claude/skills/stage-times-design/references/copy.md` ("The removed page").
- The edition is delisted: `feeds.json` reports `listed: false, blocked: true`, so the homepage
  never shows it.
- The stage-slug permanence gate still applies. A blocked edition whose YAML loses a published
  stage still refuses to build.
- `npm run smoke -- https://stagetimes.app` checks, for every blocked edition, that each feed
  is a valid empty calendar and the page is the removed page.

## Unblocking is a revert

`git revert` the block commit. Nothing else. The YAML was never touched and the sequence
ledger was never touched, so the feeds come back byte-identical to the moment before the
block, with every UID and SEQUENCE intact — subscribers who kept the calendar see the sets
reappear at their next refresh.

If the block was a rights-holder block, the source image was deleted and the revert brings it
back from git history; delete it again if the festival's objection was to the image rather
than the times.

## What never happens

- The edition's slug, stage ids, or namespace never change. The permanence contract in
  `README.md` applies to blocked editions exactly as to live ones.
- The YAML is never deleted. Deleting it fails the build (`PUBLISHED EDITION DISAPPEARED`).
- No feed under a blocked edition ever 404s, redirects, or changes its calendar name.
- Nothing is emailed automatically. The requester hears back from a person.
