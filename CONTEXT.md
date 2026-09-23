# Stage Times

One iCalendar subscription feed per festival stage, so an attendee adds only the two or three
stages they care about. This glossary is the vocabulary for the whole product: the site, the
ingest pipeline, and the conversation about them. It contains no implementation detail.

## Language

### The schedule

**Festival**:
A recurring event with a name and a permanent slug (`capitol-hill-block-party`). The slug is the
festival's identity across years.
_Avoid_: event, fest, show

**Edition**:
One year of one festival (`capitol-hill-block-party-2026`). Every URL, feed, and upload belongs
to an edition, never to a festival in the abstract.
_Avoid_: festival (when a year is meant), instance, season

**Stage**:
A physical performance area within an edition, with a permanent id (`main`) and a display name
("Main Stage") that may change freely.
_Avoid_: venue, area, tent (unless it is the stage's actual name)

**Weekend**:
One run of consecutive days within an edition, when the edition has more than one — ACL and
Coachella run two, a week apart. A stage that plays both weekends is two stages, one per
weekend, each with its own permanent id and its own feed. An edition with one run of days has
no weekends.
_Avoid_: week, leg, part, session, half

**Set**:
One artist playing one stage from a start time to an end time. A set whose end time was not
printed on the source is an **inferred-end set**.
_Avoid_: performance, slot, show, gig, event (an event is what a set becomes inside a calendar)

**Headliner**:
The act a stage bills as its closer each night — usually the last set, but an afters DJ set
does not count. Named per stage in the data; failing that, the last set of the night. A night
runs until 6 AM, so a 1:45 AM set belongs to the night before. A display convenience, not a
schedule fact.
_Avoid_: closer (when the billed act is meant), afters

**Source**:
The official published schedule for an edition, in whatever form the festival released it:
usually a per-day poster image, sometimes an app screen or a web grid.
_Avoid_: poster (too narrow), lineup (a lineup has no times)

**Drop**:
The moment a festival releases set times for an edition. Lead times run from two days to eleven
weeks before the first day.

### Publishing

**Feed**:
One `.ics` subscription URL for one stage of one edition (or the all-stages feed). Feed URLs
are permanent: once published they are never renamed, moved, or deleted.
_Avoid_: calendar (that is what the feed becomes on the attendee's device), link

**Transcription**:
The machine reading of a source into sets, before any human has checked it.
_Avoid_: OCR, extraction, parse

**Verified**:
A human has checked a transcription against its source, set by set. Only verified schedules can
be published to production.
_Avoid_: approved, reviewed, confirmed (confirmed is the owner's act; verified is its result)

**Listing**:
The owner's act of putting an edition on the homepage. His confirm of an edition is its listing,
in the same commit; so is merging the watcher's review. A listed edition shows once its
**festival art** is committed. There is no draft tier: a feed URL that exists is always one a
human checked. Unconfirmed transcriptions are pending review, not published.

**Festival art**:
The festival's own artwork for an edition, committed to the repo: the image on its homepage
card. Never drawn by the build.
_Avoid_: cover image, hero, thumbnail, poster (a poster is a source)

**Festival colors**:
An edition's own colors, sampled off its festival art and its sources: one per stage, on its
card and its calendar. Absent, the edition takes the house colors.
_Avoid_: palette, theme, brand colors
_Avoid_: featuring, promoting, indexing, approved

**Namespace**:
Which of two URL families an edition lives in. **Owner** editions sit at the root
(`/coachella-2027/`); every edition is one now. **Fan** editions sat under `/fan/` while anyone
could publish; the one ever made still serves there, blocked and moved, and nothing makes
another. An edition never moves between namespaces.

**Correction**:
A change to a published edition's sets that keeps every UID: the watcher's review of a change on
the schedule page, merged, or a hand edit to the YAML. Subscribers receive the new times at
their next refresh.
_Avoid_: update, edit (an edit is one changed set on the review screen), overwrite

**Blocked**:
An edition taken down — at a rights holder's request, or because it **moved** to another
edition. Its feed URLs keep serving, but empty, and its page says it was taken down, or points
where it moved. A blocked edition is never deleted and never listed.
_Avoid_: deleted, taken down (the request is a takedown; the state is blocked), removed

**Moved**:
A blocked edition whose set times now live in another edition, which its page points to. The
calendars added from it go empty; a calendar cannot be moved.
_Avoid_: redirected, migrated, replaced

**Watcher**:
The automation that notices a drop, or a change after a drop, on a festival's official schedule
page and produces a transcription for the owner to verify.
_Avoid_: scraper, crawler, bot

**Signal**:
A notice that set times appear to have dropped somewhere the watcher cannot read (an app, a
social post), sent to the owner with a link. A signal carries no image and creates nothing.
_Avoid_: alert (an alert is how a signal is delivered), notification

**Sponsor**:
One hand-sold image-and-link card on a listed edition's subscribe page.
_Avoid_: ad, advertiser, partner

### People

**Owner**:
Jake. The only person who publishes, and the only person who lists. Recognized by the secret in
his bookmarked link, never by an account.
_Avoid_: admin, maintainer, moderator, uploader

**Rights holder**:
A festival or its representative asking for an edition to be blocked. Their request is honored
first and discussed after.
_Avoid_: complainant, claimant

**Attendee**:
A person who opens a subscribe page and adds a feed to their calendar. Visits once, taps two or
three times, and does not return.
_Avoid_: user, subscriber, customer, festival-goer (fine in prose, not as the term)
