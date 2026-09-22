# A stage that plays both weekends is two stages

Austin City Limits and Coachella run twice: three days, a dark week, the same three days again,
with almost the same lineup and set times that move between the two. The UID of every event is
`sha1(slug + year + stageId + normalizedArtist)` and deliberately excludes the start time, so the
same act on the same stage both weekends collides — which is exactly what happened on 2026-09-22
when the link reader read ACL's schedule page, both weekends at once, and the schema refused 60
pairs. The day-in-the-name workaround from the day before (`SILENT DISCO (Friday)`) could not help:
both weekends have a Friday.

The owner ruled on 2026-09-22 that a two-weekend festival is one festival whose subscribe page goes
festival → weekend → stages, not two festivals. Under that ruling the weekend has to be in the UID
somewhere, and the only input with room for it is the stage id. So **a stage that plays both
weekends is two stages in the edition**: `t-mobile-weekend-1` and `t-mobile-weekend-2`, each a
feed of its own, each named with its weekend on the calendar (`T-Mobile (Weekend 1) — ACL 26`),
each with a display-only `weekend:` field that groups the cards on the page. The transcription
decides the weekends from the days — a gap of more than two dark days starts a new run — and
numbers them in date order. One run of days gets plain ids and no weekend, so every edition
published before this decision is untouched.

What was considered and not done:

- **Two editions, `acl-weekend-one-2026` and `acl-weekend-two-2026`.** Two cards for one
  festival, a slug scheme frozen forever, and the link reader and the watcher splitting one
  schedule page into two editions. Nobody thinks of ACL weekend two as a different festival.
- **A discriminator in the UID.** Changing UID derivation orphans every published event; the
  permanence contract rules it out after first publish, and CHBP is published.
- **A combined feed per stage over both weekends.** A third feed kind and a third button for a
  case that could not be sized: neither festival sells a two-weekend pass, and each weekend's
  schedule differs. Someone doing both weekends adds a stage under each. A union feed later is a
  new URL and breaks nothing.

The cost is that the weekend is in the URL forever: if a festival renumbers or renames its
weekends, `weekend:` and the stage `name` can change and the id cannot, exactly like every other
stage id. The stage-id rule that forbids years and dates still holds — `weekend-1` is neither.

Status: accepted, 2026-09-22 (owner ruling the same day, recorded on the effort page).
