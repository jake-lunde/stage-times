# Copy review of the live site — 6 September 2026

Ticket 01 of [spec — self-serve editions]. Every visible string on the two live pages, plus
the strings attendees see inside their calendar app, read by three festival-goers. Output is
a list of lines with rewrites, not a grade.

**Nothing on the site is changed by this review.** Applying the rewrites is ticket 15.
The rules distilled from it live in `.claude/skills/stage-times-design/references/copy.md`
and bind every screen the upload flow adds.

Strings were taken from a fresh `npm run build` of `capitol-hill-block-party-2026`
(`dist/index.html`, `dist/capitol-hill-block-party-2026/index.html`, `main.ics`, `all.ics`),
so what is reviewed is what is served, not what the source looks like.

## The three readers

**Gate** — iPhone, 12% battery, standing at the entrance while the first set starts. Reads
nothing. Wants the tap. Any sentence between them and the button is a cost, and any word that
makes them hesitate over what they are agreeing to is a lost subscriber.

**Stuck** — Android, tapped the button on the stage card, nothing happened. Arrives at the
copy already half-convinced the site is broken. Needs to learn in one line that it is not
their fault, and what to do instead. Hostile to anything written as if iPhone were the
default and they were the footnote.

**Planner** — laptop, the week before, deciding whether to trust these times enough to plan
around them. Will read everything. Rewards honesty about where the times came from and how
stale they might be; punishes vagueness, jargon, and anything that sounds like it was
generated rather than written.

---

## 1. Verdicts — every visible string

`K` = keep, `R` = rewrite. Rewrites are numbered and specified in section 2.

### Landing — `/`

| # | String | Gate | Stuck | Planner |
|---|---|---|---|---|
| L1 | `<title>` "Stage Times — set times, by stage" | K | K | K |
| L2 | meta description "One iCalendar subscription feed per festival stage." | K | K | **R1** |
| L3 | Hero wordmark "Stage Times" | K | K | K |
| L4 | Hero line "Set times, by stage." | K | K | K |
| L5 | Card eyebrow "Fri 7 Aug – Sun 9 Aug 2026" | K | K | K |
| L6 | Card heading "Capitol Hill Block Party" | K | K | K |
| L7 | Card meta "79 sets · 4 stages" | K | K | K |
| L8 | Card pill "See stages" | K | K | K |
| L9 | Eyebrow "What this is" | K | K | K |
| L10 | "Subscribe to one calendar per stage. The sets appear in the calendar app you already use, and you can colour or hide each stage independently." | **R2** | **R2** | **R2** |
| L11 | "iCalendar has no field for 'which calendar does this event belong to' — that's decided when you subscribe, one calendar per feed URL. So per-stage calendars can only exist as separate feeds. That's the whole product." | **R3** | **R3** | **R3** |
| L12 | Footer "Unofficial. Not affiliated with any festival." | K | K | K |
| L13 | Footer "Found an error? Open an issue." | **R4** | **R4** | **R4** |
| — | *(missing)* last-updated stamp and source attribution | K | K | **G1** |

### Subscribe — `/capitol-hill-block-party-2026/`

| # | String | Gate | Stuck | Planner |
|---|---|---|---|---|
| S1 | `<title>` "Capitol Hill Block Party 2026 — set times by stage" | K | K | K |
| S2 | meta description "Subscribe to … set times, one calendar per stage." | K | K | **R5** |
| S3 | Back button `aria-label` "Stage Times home" | K | K | K |
| S4 | Lockup "Stage Times" | K | K | K |
| S5 | Title "Capitol Hill Block Party 2026" | K | K | K |
| S6 | "Fri 7 Aug – Sun 9 Aug 2026 · 79 sets · 4 stages" | K | K | K |
| S7 | Eyebrow "Pick your stages" | K | K | K |
| S8 | Headliner preview "MUNA / DISCO LINES / WET LEG" (poster caps) | K | K | **R6** |
| S9 | Stage headings "Main Stage", "Daydream Stage", "Neumos Stage", "Barboza Stage" | K | K | K |
| S10 | Stage meta "20 sets · Fri 7 Aug – Sun 9 Aug" | K | K | K |
| S11 | Stage descriptions ("Indoor basement at Barboza. Short sets, quick turnarounds." and the other three) | K | K | K |
| S12 | Stage button "Subscribe" ×4 | **R7** | **R7** | **R7** |
| S13 | Copy button `aria-label` "Copy calendar link" → "Link copied" | K | **R8** | K |
| S14 | Pressed-state label "Opening Calendar…" | K | **R9** | K |
| S15 | All-stages heading "All Stages" | K | K | K |
| S16 | All-stages meta "79 sets · every stage in one calendar" | K | K | K |
| S17 | All-stages button "Subscribe" | **R7** | **R7** | **R7** |
| S18 | "Two or three stages reads well in a day view. All 4 compresses into narrow unreadable columns — use the official grid for the full lineup." | **R10** | **R10** | K |
| S19 | Text button "See the full lineup ↗" | K | K | K |
| S20 | Eyebrow "Not on iPhone?" | K | **R11** | K |
| S21 | Disclosure "Google Calendar" + body | K | **R12** | K |
| S22 | Disclosure "Outlook" + body | K | K | K |
| S23 | Disclosure "iPhone, iPad, Mac" + body | **R13** | K | **R13** |
| S24 | Footer "Updated 8 August 2026. Times are America/Los Angeles local." | K | K | **R14** |
| S25 | Footer "Unofficial. Not affiliated with Capitol Hill Block Party." | K | K | K |
| S26 | Footer "Source: the official schedule." | K | K | K |
| S27 | Footer "Found an error? Open an issue." | **R4** | **R4** | **R4** |
| S28 | Unverified banner "Preview — set times not yet verified … See `source/TRANSCRIPTION.md` for the open questions." *(not rendered today; `verified: true`)* | **R15** | **R15** | **R15** |
| — | *(missing)* takedown contact for rights holders | K | K | **G2** |

### Inside the attendee's calendar app

These are read more often than the website, in a UI we do not control, usually months after
the tap. All three readers looked at them on a phone.

| # | String | Gate | Stuck | Planner |
|---|---|---|---|---|
| C1 | Calendar name "Main Stage — Capitol Hill Block Party 26" | K | K | **R16** |
| C2 | Calendar name "All Stages — Capitol Hill Block Party 26" | K | K | **R16** |
| C3 | Calendar description "Capitol Hill Block Party 2026 set times for Main Stage. stagetimes.app" | K | K | K |
| C4 | Event title "AVERY COCHRANE" (poster caps) | **R6** | K | **R6** |
| C5 | Event location "Main Stage" | K | K | K |
| C6 | Event body line 1–2: stage name, "Fri 7 Aug 2026, 3:15 PM – 3:45 PM" | K | K | K |
| C7 | Inferred-end caveat "End time not printed on the official schedule; assumed to be one hour after the start. Treat it as approximate." | **R17** | K | K |
| C8 | Event body last line "Official schedule: https://www.capitolhillblockparty.com/" | K | K | K |

---

## 2. The rewrites

Each is a concrete replacement line with the reason in one sentence.

**R1 — landing meta description.**
Now: `One iCalendar subscription feed per festival stage.`
→ `Set times for each festival stage, as a calendar you can add to your phone.`
*Planner: this is the line under the result in Google, and "iCalendar subscription feed" is
the format's name, not a reason to click.*

**R2 — landing, "What this is", first paragraph.**
Now: `Subscribe to one calendar per stage. The sets appear in the calendar app you already use, and you can colour or hide each stage independently.`
→ `Add one calendar per stage. The sets show up in the calendar app you already use, and you can color or hide each stage on its own.`
*All three: "Subscribe" is the wrong verb (see the ruling below), and British "colour" against
"AM/PM" and a Seattle festival is the kind of inconsistency that reads as assembled rather
than written.*

**R3 — landing, "What this is", second paragraph.**
Now: `iCalendar has no field for "which calendar does this event belong to" — that's decided when you subscribe, one calendar per feed URL. So per-stage calendars can only exist as separate feeds. That's the whole product.`
→ *Cut it.* Replace with: `Two or three stages is usually all you want. Add those, skip the rest.`
*All three: this is the engineer explaining why the product is shaped this way; Gate and Stuck
never read it, and Planner reads a spec paragraph where they were looking for a reason to
trust the times.*

**R4 — the error-report line, both footers.**
Now: `Found an error? Open an issue.`
→ `Wrong time? Tell me ↗`
*All three: "open an issue" is GitHub's vocabulary for GitHub's users, and a festival-goer who
spots a wrong set time does not recognize it as an invitation.*
The link target does not change (the public issue tracker stays the correction channel per the
spec); the arrow warns that the tap leaves the site, which the current line does not.

**R5 — subscribe meta description.**
Now: `Subscribe to Capitol Hill Block Party 2026 set times, one calendar per stage.`
→ `Capitol Hill Block Party 2026 set times, one calendar per stage. Add the stages you care about to your phone.`
*Planner: leading with the festival name matches what they searched, and the second sentence
says what they get.*

**R6 — artist names in caps (headliner previews and event titles).**
Now: `MUNA`, `AVERY COCHRANE`, `DJ_DAVE + MGNA CRRRTA`
→ Title case for display: `Muna`, `Avery Cochrane`, `dj_dave + Mgna Crrrta`
*Gate and Planner: the poster shouts because a poster is read across a street; a calendar row
at 8am reads as shouting, and a day view of twenty caps rows is genuinely harder to scan.*
Keep the poster casing in the YAML `raw` field, which is what the transcription log verifies
against. The UID derivation lowercases already, so no subscription breaks; changed titles bump
SEQUENCE and propagate as intended. Stylized names (`dj_dave`) follow the artist, not the rule.
This is a data-normalization change with its own blast radius — **flagged, not folded into
ticket 15.**

**R7 — the action label, every stage card and the all-stages card. The headline ruling.**
Now: `Subscribe`
→ `Add calendar`
Full reasoning in section 3.

**R8 — the copy-link button.**
Now: icon only, `aria-label="Copy calendar link"`.
*Stuck: this button is their entire path forward and it is a glyph with no visible label; the
aria-label reaches a screen reader, not someone squinting at a phone.*
The copy fix is to name it where they are looking for it — in the Google Calendar disclosure
(R12) — rather than to put a label in the button, which would break the icon-button rule.
The label itself is right: `Copy calendar link` / `Link copied` both stay.

**R9 — the pressed-state label.**
Now: `Opening Calendar…`, restored to `Subscribe` after 2.5s.
*Stuck: on Android the tap does nothing at all, so "Opening Calendar…" is the site telling
them something is happening that is not — it is the single most misleading string on the site.*
The label is right on iOS and should stay `Opening Calendar…`. What is missing is the
recovery: when the button restores itself, a line should appear under the card reading
`Didn't open? Android needs a computer — see below ↓`, linked to the Google Calendar
disclosure. New string, needs behaviour to go with it; carried into ticket 15 as a note.

**R10 — the all-stages caveat.**
Now: `Two or three stages reads well in a day view. All 4 compresses into narrow unreadable columns — use the official grid for the full lineup.`
→ `Pick two or three. All four at once turns a day view into a wall of overlapping blocks.`
*Gate and Stuck: 27 words of design reasoning sitting directly under a button, arguing against
the button above it; the shorter line makes the same honest point in words someone would say.*
Planner kept the original — the honesty is why they trust the site — so the rewrite preserves
the claim and cuts the explanation. "Use the official grid for the full lineup" is redundant
with the "See the full lineup ↗" button eight pixels away.

**R11 — the fallback section header.**
Now: `Not on iPhone?`
→ `Android, or on a computer?`
*Stuck: they arrive here after a failure, and a header framed as "not the default one" tells
them they are the exception before it tells them anything useful.*
Naming the two platforms means it can be found by scanning, before the tap as well as after.

**R12 — the Google Calendar disclosure body.**
Now: `Desktop web only.` … `Paste the stage's https:// link and click Add calendar` … `Google refreshes subscribed calendars on its own schedule — usually 12–24 hours, sometimes longer. We can't make it faster.`
→ Two changes.
1. Name the copy button, because Stuck does not know where the link is:
   `Tap the link icon on the stage card to copy its address. Then, on a computer:`
2. Drop the corporate first person:
   `Google refreshes subscribed calendars on its own schedule — usually 12–24 hours, sometimes longer. Nothing on my end can make it faster.`
*Stuck: the instructions are accurate but start one step too late, and "We can't" is a company
apologizing where a person would just say so.*
Everything else in this disclosure is exemplary and stays word for word.

**R13 — the iPhone disclosure body.**
Now: `Tap Subscribe above — it opens Calendar and asks you to confirm. That's the whole flow. Apple honours our 12-hour refresh hint, so changes reach you within half a day.`
→ `Tap Add calendar above. iOS opens Calendar and asks you to confirm — its sheet says "Subscribe", which is the same thing. That's the whole flow. iOS checks for changes about twice a day, so a corrected time reaches you within half a day.`
*Gate and Planner: the button name must match the instruction after R7, "honours" is the second
British spelling on a US-festival site, and "our 12-hour refresh hint" is our implementation
described in our words rather than what the reader will see.*
The clause naming iOS's own sheet is the bridge that makes "Add calendar" safe — **verify the
exact sheet wording on a device before ticket 15 ships this line.**

**R14 — the updated stamp.**
Now: `Updated 8 August 2026. Times are America/Los Angeles local.`
→ `Updated 8 August 2026. All times are local to the festival — Pacific.`
*Planner: `America/Los_Angeles` is a database key with the underscore hand-massaged out, and
the thing they actually want to know is whether the times will shift on their own phone.*
Needs a human timezone label per edition (`timezone_label: "Pacific"` in the edition YAML,
falling back to the IANA zone). Small data change; noted for whoever picks up ticket 15.

**R15 — the unverified banner.**
Now: `Preview — set times not yet verified` / `This schedule was transcribed from the official poster images and has not been checked by a human. Do not subscribe from this preview. See source/TRANSCRIPTION.md for the open questions.`
→ `Not checked yet` / `These times were read off the official posters by machine and nobody has checked them against the source. Don't plan your day around them yet.`
*All three: a repo file path is meaningless to everyone who can see this page, and "transcribed"
is our internal word for the machine read.*
Under the new spec there is no draft tier, so this banner should not survive as-is — the string
that replaces it is the fan-made notice (user story 9). Recorded here because the string exists
in `pages.ts` today and would render for any edition with `verified: false`.

**R16 — calendar names.**
Now: `Main Stage — Capitol Hill Block Party 26`
→ `Main Stage — Capitol Hill Block Party '26`
*Planner: with the year truncated for iOS and no apostrophe, "Party 26" reads for a moment as a
count of something rather than a year.*
Stage-first is confirmed by all three and stays — it is what makes three subscribed stages
distinguishable in a truncated sidebar. Changing this renames the calendar in the sidebar of
everyone already subscribed at their next refresh, which is harmless but is the owner's call.

**R17 — the inferred-end caveat.**
Now: `End time not printed on the official schedule; assumed to be one hour after the start. Treat it as approximate.`
→ `End time wasn't printed — this one is a guess: start plus an hour.`
*Gate: read on a phone at the gate, the current line spends 22 words and a third sentence
saying what the second already said.*
The claim is unchanged and the number is still explicit, which is what made Planner trust it.

---

## 3. The ruling: "Add calendar", not "Subscribe"

The spec's ruling is **confirmed**, unanimously, and for three different reasons.

**Gate.** "Subscribe" is the word every app uses for the thing they are trying not to do —
sign up, hand over an email, start a trial. At 12% battery with a set starting, half a second
of "wait, subscribe to what?" is the whole conversion. "Add calendar" names the outcome, and
the outcome is harmless.

**Stuck.** Their recovery path is Google Calendar's own menu: **Add calendar → From URL**. When
the button says Subscribe and the instructions say Add calendar, they have to work out that
these are the same act; when both say the same words, the instructions read as a continuation
of the button. This is the strongest argument of the three, because it is the reader the label
change most helps.

**Planner.** Scanning four cards, "Add calendar" tells them the shape of what they are about to
own — four calendars, colorable and hideable, exactly as the landing page promised. "Subscribe"
tells them about a relationship with a website.

**The one cost, and the fix.** iOS's own confirmation sheet is titled "Subscribe to Calendar",
so a button labelled Add calendar hands off to a sheet that says Subscribe. Gate meets this
mismatch mid-tap, on the one platform where the flow currently works perfectly. This is not
enough to overturn the ruling — the sheet is Apple's surface, appears after the decision, and
is self-evidently the same act — but it must be named rather than ignored, which is what the
R13 clause does: *its sheet says "Subscribe", which is the same thing.*

**Verify the sheet's exact wording on a device before shipping R13.** If iOS words it
differently, the clause changes; the ruling does not.

Consequences beyond the two buttons: the domain glossary already separates **feed** (ours) from
**calendar** (what it becomes on the attendee's device), so "Add calendar" is the user-facing
half of a distinction the vocabulary already makes. "Subscribe" survives in exactly two places
— the analytics event name `subscribe`, which is internal and must not be renamed without
breaking the metric's history, and quoting another platform's UI.

---

## 4. Strings that do not exist yet

**G1 — the landing page has no last-updated stamp and no source attribution.** The design
skill's checklist requires both on every page; the subscribe page carries them and the landing
page does not. Planner reaching the site from a search result lands here first. Needed line,
in the landing footer, in the same mono voice:
`Times come from each festival's official schedule. Each festival page says when it was last checked.`

**G2 — no takedown contact.** The spec requires a visible email for rights holders on every
page (user story 55), and there is nowhere on either page to send a takedown that is not the
public issue tracker. Needed line, footer, both pages:
`Rights holder? Email <address>.`
The address is Jake's to choose — it is the one string in this review that cannot be written
without him.

**G3 — the Android dead-tap recovery line** (from R9):
`Didn't open? Android needs a computer — see below ↓`

---

## 5. What survived, and why it matters

The four stage descriptions are the best writing on the site:

> Indoor basement at Barboza. Short sets, quick turnarounds.
> Indoor at Neumos. Runs late — hosts the Saturday and Sunday afters.

All three readers kept them without comment, which no other body copy managed. They are
concrete, they are things only someone who has been in that room would say, and they are
short. They are the benchmark the copy rules are written against, along with the hero line
"Set times, by stage." and the Google Calendar disclosure's flat "Desktop web only."

The pattern in what got rewritten is narrow enough to state in one line: **the site is at its
best describing the festival and at its worst describing itself.** Every rewrite above is a
sentence where the site turned to explain its own machinery — feeds, iCalendar fields, refresh
hints, transcription, GitHub issues, IANA zones — in the machinery's vocabulary rather than the
reader's.

The rules distilled from this are in
`.claude/skills/stage-times-design/references/copy.md`, and every screen the upload flow adds
is written under them.

---

## 6. Disposition — ticket 15, 6 September 2026

Every rewrite above, applied or declined with the reason. "Applied" means it is on the live
pages once this commit deploys; page tests in `tests/copy.test.ts` pin each line.

| # | Disposition | Note |
|---|---|---|
| R1 | Applied | |
| R2 | Applied | |
| R3 | Applied | |
| R4 | Applied, both footers | Link target unchanged. |
| R5 | Applied | |
| R6 | **Declined for this ticket** | Artist casing is a data-normalization change with its own blast radius (event titles change → SEQUENCE bumps on every set). Owner's call; not folded into a copy ticket. The skill's rule 5 says so. |
| R7 | Applied | "Add calendar" on every stage card and the all-stages card. The analytics event keeps its internal name `subscribe`. |
| R8 | Applied via R12 | The icon button keeps its label; the Google Calendar disclosure now names it. |
| R9 / G3 | Applied | "Opening Calendar…" stays. The recovery line `Didn't open? Android needs a computer — see below ↓` renders hidden under every button and appears when the button restores itself, linking to the fallback section. 17pt semibold so it clears the on-color contrast rule inside a stage card. |
| R10 | Applied | The stage count renders as a word ("All four"), digits past nine. |
| R11 | Applied | The section gained the anchor the recovery line points at. |
| R12 | Applied | |
| R13 | Applied | The iOS sheet clause is written from the reviewer's knowledge of the sheet (title "Subscribe to Calendar", button "Subscribe"), not a device check. **Still owed: one look at a real iPhone.** The clause is safe under both wordings. |
| R14 | Applied | The label is derived on the page from the IANA zone (`zoneLabel` in `pages.ts`: a short map of North American zones plus a city-name fallback), not a new YAML field — no data change, no schema change, nothing for the parallel edition-state work to merge against. |
| R15 | Applied | The banner string is rewritten in place; it still only renders for `verified: false`. It is superseded by the fan-made notice when that ships. |
| R16 | **Declined for this ticket** | Changes the calendar name in every existing subscriber's sidebar at their next refresh, and the golden feeds. Harmless, but the owner's call, and this ticket's contract is that the feeds do not change. |
| R17 | **Declined for this ticket** | Changes the DESCRIPTION of the nine inferred-end events, which bumps their SEQUENCE and changes the golden feeds. Same contract. Fold into the next feed-bytes change (R16, or a real time correction). |
| G1 | Applied | |
| G2 | **Blocked on the owner** | No takedown address exists yet. The footer line ships the moment there is one. |

Golden feeds: byte-identical to the previous commit, proven by gate 2.
