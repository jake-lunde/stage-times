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
_Avoid_: approved, reviewed, confirmed (confirmed is the uploader's act; verified is its result)

**Trust tier**:
How far a published edition is trusted, in increasing order:

- **Uploader-verified** — the uploader confirmed the transcription against their own image. The
  feeds are live at their own URL and appear nowhere on the site.
- **Listed** — the owner has approved the edition for the homepage.

Publishing an edition is not the same as listing it. Listing is always a human act by the owner.
There is no draft tier: a feed URL that exists is always one a human checked. Unconfirmed
transcriptions are pending review, not published.
_Avoid_: draft, published (ambiguous between the two tiers), approved

**Listing**:
The owner's one-tap act of moving an edition from uploader-verified to listed.
_Avoid_: featuring, promoting, indexing

**Namespace**:
Which of two URL families an edition lives in. **Owner** editions sit at the root
(`/coachella-2027/`); **fan** editions sit under `/fan/` (`/fan/coachella-2027/`). An edition
never moves between namespaces, not even when it is listed.

**Correction**:
A re-upload by an edition's own uploader that replaces its sets. Subscribers receive the new
times at their next refresh. Only the original uploader can correct an edition.
_Avoid_: update, edit (an edit is one changed set on the review screen), overwrite

**Update link**:
The secret link shown once to an uploader on confirmation. Holding it is what makes someone an
edition's uploader; the email address is only a contact.
_Avoid_: edit link, admin link, token

**Blocked**:
An edition removed at a rights holder's request. Its feed URLs keep serving, but empty, and its
page says it was removed. A blocked edition is never deleted and never listed.
_Avoid_: deleted, taken down (the request is a takedown; the state is blocked), removed

**Watcher**:
The automation that notices a drop, or a change after a drop, on a festival's official schedule
page and produces a transcription for the owner to verify.
_Avoid_: scraper, crawler, bot

**Signal**:
A notice that set times appear to have dropped somewhere the watcher cannot read (an app, a
social post), sent to the owner with a link. A signal carries no image and creates nothing.
_Avoid_: alert (an alert is how a signal is delivered), notification

**Sponsor**:
One hand-sold image-and-link card on a listed edition's subscribe page. Fan editions never carry
one.
_Avoid_: ad, advertiser, partner

### People

**Owner**:
Jake. The only person who lists, and the only person whose uploads publish into the owner
namespace.
_Avoid_: admin, maintainer, moderator

**Uploader**:
Anyone, owner included, who submits a source image for an edition and confirms its
transcription. Identified by an email address, never by an account.
_Avoid_: user, submitter, contributor, member

**Rights holder**:
A festival or its representative asking for an edition to be blocked. Their request is honored
first and discussed after.
_Avoid_: complainant, claimant

**Attendee**:
A person who opens a subscribe page and adds a feed to their calendar. Visits once, taps two or
three times, and does not return.
_Avoid_: user, subscriber, customer, festival-goer (fine in prose, not as the term)
