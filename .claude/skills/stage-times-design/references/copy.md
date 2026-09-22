# Copy rules

Distilled from the three-reader copy review of the live site, 6 September 2026
(`docs/copy-review-2026-09-06.md`). Those rewrites are the evidence; these are the rules.
Load this before writing any user-facing string — a page, a button, a disclosure, an error, a
calendar name, an event body.

## The voice

**One person who goes to shows, telling you what they know.** Not a product, not a team, not a
brand. The site is at its best describing the festival and at its worst describing itself; the
whole rule set follows from that.

First person singular when the writer has to appear at all: `Nothing on my end can make it
faster`, `Wrong time? Tell me`. **Never "we", never "our"** — a "we" implies a company behind
the site, and there isn't one. Most lines need no first person at all; reach for it only for
a limitation or an invitation.

## The tone test

Read the line aloud as if you were standing in a crowd telling a friend. If you would not say
it that way, it fails. Three checks, in order:

1. **Would a festival-goer say this word?** Not "would they understand it" — would they use it.
2. **Is the site explaining itself or the festival?** Explaining itself is almost always a cut.
3. **Does it promise something the platform might not do?** Then it is a lie on the platform
   that doesn't.

The benchmark lines, all of which survived three readers untouched:

> Set times, by stage.
> Indoor basement at Barboza. Short sets, quick turnarounds.
> Indoor at Neumos. Runs late — hosts the Saturday and Sunday afters.
> Desktop web only.

Concrete, spoken, short, and about the thing rather than about the machinery.

## Vocabulary to use

| Say | Not |
|---|---|
| add calendar | subscribe *(as an action label — see the ruling)* |
| calendar | feed, iCalendar feed, subscription feed, `.ics` |
| link | URL, address *(except "copy its address" where "link" is already in the sentence)* |
| stage, set, times, lineup | slot, performance, gig, event |
| the official schedule | the source, upstream, the poster *(too narrow)* |
| tap | click *(on anything a phone touches)* |
| a guess | inferred, assumed, approximate |
| read off the posters | transcribed, parsed, extracted, OCR'd |
| wrong time, something wrong | error, issue, bug |
| tell me, email me | open an issue, file a report, submit |
| not checked yet | unverified, draft, preview, pending |
| Pacific, Eastern | `America/Los_Angeles` |
| iOS, Android, Google Calendar, Outlook | mobile, desktop *(when a platform is meant)* |

US spelling throughout — color, honor, recognize. The site's festivals are American and its
times are printed AM/PM; a British "colour" three lines from a "3:15 PM" is the kind of seam
that reads as assembled rather than written.

Internal vocabulary from `CONTEXT.md` — edition, drop, source, transcription, trust tier,
listed, moved — is for the repo, the tickets, and the tests. **None of it appears
on a page.** The glossary's own split between *feed* (ours) and *calendar* (what it becomes on
the attendee's device) is the model: we own one word, the reader gets the other.

## Vocabulary to avoid

- **The machinery, in the machinery's words.** iCalendar fields, refresh hints, feed URLs, IANA
  zones, SEQUENCE, deploys, namespaces, slugs. If a sentence explains why the product is shaped
  this way, cut it — Gate and Stuck never read it and Planner wanted a reason to trust the
  times, not a spec.
- **Repo vocabulary.** File paths, `source/TRANSCRIPTION.md`, "open an issue", branch names,
  anything GitHub. A festival-goer does not have an account and does not recognize the words as
  an invitation.
- **The generated register.** seamless, effortless, simply, just, powerful, curated, magic,
  "we've got you covered", "in just a few taps". Also: any sentence that begins by restating
  the reader's situation back to them.
- **Corporate hedging.** "unfortunately", "please note", "kindly". If something can't be done,
  say what and why in one clause.
- **Enthusiasm the reader hasn't earned yet.** No exclamation marks anywhere on the site.
- **Words that imply an account**: sign up, subscribe, register, join, member, your account.
  Nothing here has an account, and copy that implies one costs taps.

## Rules that come from specific rewrites

1. **"Add calendar" is the action label, everywhere.** Confirmed against all three readers on
   6 Sep 2026 (see the ruling in the review). "Subscribe" survives only as the internal
   analytics event name and when quoting another platform's UI.
2. **Name the platform's own words when you instruct.** The button and the fallback
   instructions use the same noun as the OS menu — Google Calendar's is literally
   *Add calendar → From URL*. Where our label and the platform's differ, say so in the
   disclosure rather than hoping it goes unnoticed (iOS's confirm sheet says "Subscribe").
3. **Never say something is happening that might not be.** `Opening Calendar…` is true on iOS
   and false on Android, where the tap does nothing; any state label that can be wrong needs
   the recovery line to go with it.
4. **State platform limits plainly, and say who can't fix them.** Google Calendar cannot add by
   URL from mobile — say exactly that, put it behind a disclosure, print the literal menu path.
   Never imply instant updates: Apple checks about twice a day, Google runs 12–24h or longer.
5. **Sentence case for sentences, not Title Case For Headings.** Artist names are still poster
   caps on the live site: the review's title-case rewrite (R6) is a data-normalization change
   with its own blast radius and is the owner's call, not a copy rule yet. Until it is ruled,
   render artist names as the data has them.
6. **A caveat states the claim and the number, then stops.** `End time wasn't printed — this one
   is a guess: start plus an hour.` Not three sentences saying it twice.
7. **Every page carries, in the footer**: unofficial / not affiliated, attribution to the
   official schedule, a last-updated stamp, a way to report a wrong time, and a rights-holder
   contact. The landing page is currently missing the last three.
8. **Nothing between the reader and the tap.** If a line sits above or beside a button and does
   not help them press it, it belongs in a disclosure or nowhere. A caveat under a button may
   qualify what happens; it may not argue against pressing it.

## The removed page

What a blocked edition's URL serves instead of the subscribe page (`renderBlockedPage` in
`src/pages.ts`; the state and the runbook are in `docs/takedown-runbook.md`). Its feeds keep
answering, empty, so a subscriber's calendar quietly goes blank; this page is where "why"
lives. One heading, two lines, one pill. No stage cards, no calendar buttons, no copy links,
and no feed URL anywhere on it.

The strings, verbatim:

| Where | String |
|---|---|
| `<title>` | `{Festival} {Year} — set times removed` |
| meta description | `The {Festival} {Year} set times were taken down. The official schedule still has them.` |
| Heading | `Taken down` |
| Body, line 1 | `This page was taken down and its calendars are empty now. If you added a stage from here, it will come up blank the next time your calendar app checks — remove it whenever you like.` |
| Body, line 2 | `The official schedule still has the times.` |
| Pill (primary, the one action) | `Official schedule` |
| Footer | `Updated {date}.` · `Unofficial. Not affiliated with {Festival}.` · `Source: the official schedule.` |

Why it reads the way it does:

- **It does not say who asked.** A rights-holder block and any other takedown are the
  same page. Gate does not care and Planner would only get half a story; the runbook has the
  whole one.
- **"Taken down", not "removed", "blocked", or "delisted".** Glossary words stay in the repo.
  "Taken down" is what a person says about a page.
- **"Calendars are empty now"** — the reader's word for what they added, not "feeds". The
  second sentence exists for Stuck's cousin: someone who added a stage weeks ago, opens their
  calendar, sees nothing, and comes here. It says what happened, when it takes effect ("the
  next time your calendar app checks" — never "immediately"), and what to do.
- **No wrong-time line.** There are no times to be wrong. The footer keeps the stamp, the
  unofficial line, and the source; the rights-holder address (G2) joins it when it exists.
- **The pill is the only action.** Bottom-anchored single action archetype. "Official
  schedule" is the destination in two plain words; no arrow, because a pill holds words only.

When the set times moved to another page (`movedTo` in state), the same page says so instead:

| Where | String |
|---|---|
| `<title>` | `{Festival} {Year} — set times moved` |
| meta description | `The {Festival} {Year} set times moved to a new page.` |
| Heading | `Moved` |
| Body | `These set times moved to a new page. If you added a stage from here, it will come up blank the next time your calendar app checks — add it again from the new page.` |
| Pill (primary, the one action) | `Set times` — to the new page |
| Footer | as above |

The line does the same three jobs as the taken-down line: what happened, when the reader
notices ("the next time your calendar app checks"), and what to do. The pill names what they
came for, not the mechanism ("New page", "Go there"). No official-schedule line: the new page
has the times and its own attribution.

## Writing for the three readers

Every new screen is checked against the same three people the live site was:

- **Gate** — iPhone, 12% battery, at the entrance. Reads nothing, wants the tap. Costs them:
  any sentence before the button, any word that raises "what am I agreeing to".
- **Stuck** — Android, tapped, nothing happened. Needs one line saying it isn't their fault and
  what to do. Costs them: iPhone-as-default framing, unlabeled icons, state that lied.
- **Planner** — laptop, the week before, deciding whether to trust the times. Reads everything.
  Costs them: vagueness about where times came from, jargon, anything that smells generated.

A line that only serves one of them is usually fine. A line that costs one of them without
serving either of the others is the one to cut.
