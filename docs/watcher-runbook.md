# Watcher runbook: the watch list and the review pull request

The **watcher** polls the official schedule pages of the festivals you name and, when set times
drop or change, hands you a review pull request to verify from your phone (CONTEXT: watcher,
drop). Vocabulary is `CONTEXT.md`; the product decisions are in the vault spec (self-serve
editions, 2026-09-06, "The watcher and the signal"). This page is the procedure.

## Adding a festival

One entry in `config/watch.yaml`:

```yaml
- festival: Camp Flog Gnaw
  year: 2026
  source: https://www.campfloggnaw.com/lineup
  timezone: America/Los_Angeles
  dates: { first: 2026-11-14, last: 2026-11-15 }
  window: { from: 2026-10-31 }
```

- `source` is the page where the set-times images will appear — usually the schedule page, or
  the lineup page before a schedule page exists. The watcher reads every image on it and asks
  the cheap check which ones are schedules, so a lineup poster costs one check, once, and is
  then ignored forever.
- `timezone` is the zone the times are printed in. The page cannot carry this.
- `dates` are the festival's days. Polling stops after the last.
- `window` is the drop window: **hourly polls from `from` through `to`** (default: the last
  day), **daily before it** — the 15:00 UTC run. C3 festivals post six to eleven weeks out;
  Insomniac ones two to five days; when in doubt open the window early, an hourly poll of a
  quiet page costs nothing.
- `slug` (optional) fixes the URL slug when the name would derive the wrong one. Permanent.
- `match` (optional) is a regular expression on the image URL; only matching images are read.
  ACL's page carries both weekends and one edition is one weekend, so its entry matches `Wk2`.

Commit and push. `npm run watch -- --due` says what the next run would poll.

## What arrives

**A drop** — a pull request titled `Set times dropped: <Festival> <Year>` from branch
`watch/<festival>-<year>/<hash>`. Its body is the whole schedule: every set by stage and day,
*end is a guess* where the end was not printed, *look here* where the model's own notes single a
set out, the notes themselves, each source image inline, and a link to the transcription log in
the branch. Its diff is the edition exactly as your own confirm would commit it: the YAML with
`namespace: owner` and `verified: true`, the log, the images, and `state/published.json` with
the edition recorded `listed: true`.

**Check every set against the image, then merge from the GitHub app.** Merging is the
verification; the next deploy publishes and lists the edition at
`stagetimes.app/<festival>-<year>/`. To decline, close it — nothing was published, and the same
images will not be offered again. A wrong set: edit the YAML on the branch first, or close it and
upload the images through your bookmark with the corrections made on review.

**A change** — the page's images changed after a drop. If the edition is live, the pull request
is titled with what moved (`<Festival> <Year>: <artist> moved, <artist> added`) and its body is
the per-set diff against what is live; merging replaces the times in place, every UID stands,
and only the events that moved advance for subscribers. If the first review was never merged,
the new one replaces it — the whole schedule again, with what moved since the earlier reading —
and the earlier pull request is left for you to close.

**An issue** labeled `watch-failed` when something stopped a review: the images read
as another year than the entry watches; the reply would not read into a schedule (the problem is
named); the new images would drop a stage the live edition already has; or the pull request
could not be opened (the issue carries what it would have said). The image links are in the
issue. Upload them through your bookmark, or fix the entry.

Nothing else lands. An unchanged page, an unreachable page, and a page with no schedule on it yet
are silent.

**Offering it again.** The watcher records the images it has offered, so the same ones are never
offered twice — including after a pull request it could not open, or one you closed by mistake,
or one that will not merge because `state/published.json` moved under it (two reviews opened in
the same run, or a fan edition published in between: git refuses loudly rather than merging
wrong). To have an edition offered again, delete its entry from `state/watch.json` on `main`
and push, or run the workflow by hand after; the replies are stored by image hash, so the second
offer costs no model call.

## The Reddit signal

For a festival whose set times land in an app or a social post, add its subreddit to the entry:

```yaml
  subreddit: <name>      # as in reddit.com/r/<name>; the r/ is optional
```

Check the name on reddit.com first — `r/ACL` is a knee-injury subreddit, not the festival. Inside
the drop window, each hourly run reads the subreddit's newest posts. A post about set times (set
times, stage times, timetable, schedule in its title), posted inside the window, naming no other
year, with at least 10 votes, arrives as an issue labeled `signal`, titled `Set times on Reddit:
<Festival> <Year>`, whose body is the link. That is all it carries. Open it, get the screenshot,
upload it through your bookmark, close the issue. The same post never arrives twice
(`state/signal.json`); a second post about the same drop does.

Nothing arrives when the subreddit is unreachable. Reddit refuses its public JSON to some networks
without credentials; the run log says `unreachable` beside the entry when that happens.

## The monthly look-ahead

On the 1st of each month an issue labeled `look-ahead` lists every edition in
`config/festivals.yaml` starting in the next ninety days: dates, when the drop is expected going
by last year's lead, where the times appear, and whether it is watched. Under *Not watched*, each
edition has a checkbox and its watch entry. Tick the ones worth watching, append their entries to
`config/watch.yaml` (check the source page and the slug first — the slug is permanent once
published), commit, push, close the issue.

Keep the almanac true: add a festival's next days when they are announced, and add `dropped:
YYYY-MM-DD` to an edition the day its set times appear — that is the lead next year's row goes
by. `npm run look-ahead -- --dry-run` prints this month's issue without sending it;
**Actions → Look-ahead → Run workflow** sends it now.

## Running it by hand

- **Actions → Watch → Run workflow** runs it now; tick *force* to poll every entry whose
  festival is not over, whatever the cadence says.
- Locally, with `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` in the environment:
  `npm run watch`, `npm run watch -- --force`, or `npm run watch -- --due` (no secrets needed;
  polls nothing). A local run writes to the real repository exactly as the scheduled one does.

## Secrets

The workflow needs `ANTHROPIC_API_KEY` as a repository secret — `scripts/provision-secrets.sh`
sets it beside the Vercel one, or `gh secret set ANTHROPIC_API_KEY`. `GITHUB_TOKEN` is the
workflow's own, with the contents, pull-requests and issues write permissions declared in
`.github/workflows/watch.yml`. Nothing about the owner secret is involved: the watcher publishes
nothing, and the pull request is the owner path.

## What it never does

- Publish. A poll commits the model's reply and the watcher's own state to `main`, nothing
  else; every edition file waits on a merge.
- Ask a model about an image twice. Every image is screened once and transcribed once, by
  content hash, in the same store an upload uses.
- Read Instagram, an app, or anything behind a login. Those festivals rely on uploads and the
  Reddit signal, below.
- Touch a blocked edition, or a fan edition. It reads and writes the owner namespace only.
