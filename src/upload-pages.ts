/**
 * Stage Times — the upload flow: one static page at `/upload/`, six screens.
 *
 *   link        the front door (ticket 20): where the set times are — the
 *               festival's schedule page — and an email, one pill, and a
 *               text button to the screenshots for anyone who has those
 *               instead. Nothing else is typed. The read is the same drawn
 *               wait as an upload's, and a page that cannot be read comes
 *               back here in the publisher's sentence, the screenshots one
 *               tap away.
 *   details     festival name, first and last day, an email — one form; the
 *               screenshot flow's own first screen, unchanged
 *   upload      one image per day (ticket 18). A one-day festival is one file
 *               action that posts as soon as an image is chosen — exactly as
 *               before. More days is a row per day, offered one at a time as
 *               the one before it fills, each swappable until the read starts,
 *               and one pill that reads whatever is chosen; a day with no
 *               times yet can be left out. A rejection about one image lands
 *               under that day's row.
 *   review      each day's own image above the sets read off it, in day
 *               order, with the flagged sets — the lines the model said it
 *               was unsure of — shown and the rest folded behind one text
 *               button per day; artist/start/end edits inline, a "Looks good"
 *               that folds a row away, a guessed end shown with its length
 *               and said to be a guess, and the time zone changeable: the
 *               festival's own when it is on record, else a guess and said
 *               so. Every row's day is the night it belongs to, so it matches
 *               the image above it. After a link, the name and the days as
 *               read sit above the sets as fields, the days grouped by weekend
 *               when there is more than one, with the address the page will
 *               live at under them, so a misread name is caught before it is
 *               permanent; a changed name changes the address as it is typed,
 *               and the year is the first day's.
 *   publishing  the honest wait: the times are saved, the page is building,
 *               and the update link is handed over now rather than after
 *   success     the share link and the update link, explained in one line
 *
 * The update link opens the same flow for one edition (ticket 09), rendered
 * once per fan edition at `/update/<edition path>/`: the header names the
 * festival and the details screen says what a new screenshot will replace
 * before anything is uploaded; the secret rides in the fragment and goes out
 * with upload and confirm, and a correction replaces the times in place. Two
 * more screens hang off it:
 *
 *   remove      take it down — one destructive button, one way back
 *   removed     what happens next, in one line
 *
 * Rendered by `renderSitePages` in src/pages.ts, sharing its shell (tokens,
 * fonts, analytics snippet, footer voice). Everything the flow *decides* lives
 * in src/publisher.ts and reaches the page as JSON through the two adapters in
 * api/; the script here reads fields, checks the image before it costs
 * anything, shows one screen at a time, and repeats the publisher's own words
 * for every rejection. Nothing on the review blocks confirm: a flagged row is
 * fixed in place or folded away with "Looks good".
 *
 * Deterministic and self-contained like every other page: no clock at render
 * time, no randomness, nothing fetched from anywhere but this origin. The
 * browser reads its own clock only to give up waiting for a build.
 *
 * Visual system: .claude/skills/stage-times-design/ (SKILL.md, copy.md,
 * screens.md — the third page type).
 */

import { ACCEPTED_IMAGE_TYPES, EMAIL_RE, GATE_COPY, MAX_IMAGE_EDGE, MAX_UPLOAD_IMAGES, MIN_IMAGE_EDGE, fill, type Gate } from './publisher.js';
import { slugify } from './transcribe.js';
import { artGround, esc, ICON_BACK, ICON_CHECK, ICON_LINK, page, PROD_ORIGIN } from './pages.js';

export type Screen = 'link' | 'details' | 'upload' | 'review' | 'publishing' | 'success' | 'remove' | 'removed';

/**
 * Where each gate's rejection lands. A typo in the form goes back to the form;
 * anything about the image — or the caps, which the reader can only wait out —
 * goes back to the one file action; a review that will not build stays on
 * review. The script carries this same map verbatim.
 */
export const GATE_SCREENS: Record<Gate, Screen> = {
  details: 'details',
  images: 'upload',
  type: 'upload',
  size: 'upload',
  dimensions: 'upload',
  'address-cap': 'upload',
  'daily-cap': 'upload',
  schedule: 'upload',
  expired: 'upload',
  review: 'review',
  schema: 'review',
  link: 'details',
  year: 'upload',
  stages: 'upload',
  removed: 'details',
  'update-link': 'remove',
  // A link's own answers (ticket 20) land where the link was typed. So does
  // every other answer to a link — a bad email, the caps, a reading that will
  // not build — since the link screen is the only one that came before it; the
  // script sends every link answer there, whatever this map says of the gate.
  address: 'link',
  unreachable: 'link',
  login: 'link',
  'no-schedule': 'link',
};

/**
 * The zones the review offers, in the words a festival-goer uses. The source
 * image cannot carry a zone, so the review shows the publisher's assumption
 * and this list to change it. A zone outside the list (an owner edition in
 * some other city) is added to the select at run time under its own id.
 */
export const REVIEW_ZONES: { id: string; label: string }[] = [
  { id: 'America/Los_Angeles', label: 'Pacific' },
  { id: 'America/Denver', label: 'Mountain' },
  { id: 'America/Phoenix', label: 'Arizona' },
  { id: 'America/Chicago', label: 'Central' },
  { id: 'America/New_York', label: 'Eastern' },
  { id: 'America/Anchorage', label: 'Alaska' },
  { id: 'Pacific/Honolulu', label: 'Hawaii' },
  { id: 'America/Mexico_City', label: 'Mexico City' },
  { id: 'Europe/London', label: 'UK' },
  { id: 'Europe/Berlin', label: 'Central Europe' },
  { id: 'Australia/Sydney', label: 'Eastern Australia' },
];

// ---------------------------------------------------------------------------
// The time edits — plain functions, tested in node, embedded in the page by
// source (`Function.prototype.toString`), so the browser runs exactly what the
// tests ran. Nothing here may close over module scope or use TS-only syntax.
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` plus `n` days. */
export function addDay(iso: string, n: number): string {
  var p = iso.split('-').map(Number);
  return new Date(Date.UTC(p[0]!, p[1]! - 1, p[2]! + n)).toISOString().slice(0, 10);
}

/**
 * A corrected start, as the wall time the review carries. A night runs until
 * 6 AM (CONTEXT: headliner), so a start moved across midnight moves its date:
 * 11:45 PM read as 12:15 AM is the next morning, and the reverse is the
 * evening before.
 */
export function editedStart(originalStart: string, hhmm: string): string {
  var date = originalStart.slice(0, 10);
  var was = originalStart.slice(11, 16);
  if (hhmm < '06:00' && was >= '06:00') date = addDay(date, 1);
  else if (hhmm >= '06:00' && was < '06:00') date = addDay(date, -1);
  return date + 'T' + hhmm + ':00';
}

/** An end at or before the start's clock time is the next morning. */
export function editedEnd(start: string, hhmm: string): string {
  var date = start.slice(0, 10);
  if (hhmm <= start.slice(11, 16)) date = addDay(date, 1);
  return date + 'T' + hhmm + ':00';
}

/**
 * The days an upload can carry an image for: every day from the first to the
 * last, inclusive, and no more than the publisher takes in one upload.
 */
export function festivalDays(first: string, last: string, max: number): string[] {
  var days = [];
  for (var d = first; d <= last && days.length < max; d = addDay(d, 1)) days.push(d);
  return days;
}

/**
 * The night a set belongs to. A night runs until 6 AM (CONTEXT: headliner), so
 * a 1:00 AM set is the evening before's — the day printed over it on the
 * poster, and the image it was read from.
 */
export function nightOf(start: string): string {
  var date = start.slice(0, 10);
  return start.slice(11, 16) < '06:00' ? addDay(date, -1) : date;
}

/** `FRI`, or with the date `FRI 9 OCT` — the day as the site's captions print it. */
export function dayLabel(iso: string, withDate?: boolean): string {
  var p = iso.slice(0, 10).split('-').map(Number);
  var d = new Date(Date.UTC(p[0]!, p[1]! - 1, p[2]!));
  var wd = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getUTCDay()]!;
  if (!withDate) return wd;
  var mo = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getUTCMonth()]!;
  return wd + ' ' + d.getUTCDate() + ' ' + mo;
}

/** `FRI 9 OCT`, or `FRI 9 – SAT 10 OCT` when an image's sets span more than one night. */
export function daysLabel(first: string, last: string): string {
  var a = dayLabel(first, true), b = dayLabel(last, true);
  if (first === last) return a;
  return (a.slice(-3) === b.slice(-3) ? a.slice(0, -4) : a) + ' – ' + b;
}

/** `FRIDAY` — the weekday a date falls on, the way a poster prints it; '' for anything that is not a date. */
export function weekdayName(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  var p = iso.split('-').map(Number);
  var d = new Date(Date.UTC(p[0]!, p[1]! - 1, p[2]!));
  if (d.getUTCDate() !== p[2]) return '';
  return ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][d.getUTCDay()]!;
}

/**
 * The weekends the days make, as the transcription decides them (`weekendsOf`
 * in src/transcribe.ts, pinned equal by test): runs of days no more than three
 * apart, in date order, once each. One run is the ordinary festival.
 */
export function weekendRuns(days: string[]): string[][] {
  var sorted = days.slice().sort().filter(function (d, i, all) { return all.indexOf(d) === i; });
  var runs: string[][] = [];
  for (var i = 0; i < sorted.length; i++) {
    var run = runs[runs.length - 1];
    var apart = run ? (Date.parse(sorted[i]! + 'T00:00:00Z') - Date.parse(run[run.length - 1]! + 'T00:00:00Z')) / 86400000 : 0;
    if (run && apart <= 3) run.push(sorted[i]!);
    else runs.push([sorted[i]!]);
  }
  return runs;
}

/**
 * Where the page will live, as the review's header has it (ticket 20): the
 * path the publisher claimed while the name and the year are as read — suffix
 * and all — and, once either is changed, the path that name and year derive,
 * the way confirm will derive it. A suffix confirm may add for a changed name
 * cannot be known here; the success screen shows what was claimed.
 */
export function readAddress(rv: { festival: string; year: number; namespace: string; editionPath: string }, name: string, year: string): string {
  if (name.trim() === rv.festival && year === String(rv.year)) return rv.editionPath;
  return (rv.namespace === 'fan' ? 'fan/' : '') + slugify(name) + '-' + year;
}

/** The status line while a link is read, from the link's own reports — before the images report as an upload's do. */
export function linkStatus(p: { step: string; images?: number }): string {
  if (p.step === 'found') {
    var n = p.images || 0;
    return 'Found ' + n + ' image' + (n === 1 ? '' : 's') + ' that could be the schedule. Reading ' + (n === 1 ? 'it' : 'them') + ' now.';
  }
  return 'Opening that page.';
}

/**
 * The wait, drawn: the beads of a stage card (SKILL.md, Card art) with no
 * sets yet — a ring per festival day, the beads filling in around each ring
 * and dissolving again while the model reads, the rings drifting at their
 * own speeds. Same geometry as `beadsArt()` in src/pages.ts: dial from 2 PM
 * to 2 AM, rings from 86 to 176 on a 400×240 slice, cream marks on the
 * light ground. Nothing here is random, so the same wait draws the same
 * picture; under reduced motion it is the finished ring.
 */
export function loadingArt(days: number, ground: string): string {
  var W = 400, H = 240, CX = 200, CY = 120, INNER = 86, OUTER = 176, SPINS = [300, 220, 380];
  var cream = '#FCF9F4';
  var nd = Math.max(1, Math.min(7, days));
  var beads = 14, cycle = 12;
  var rings = '';
  for (var d = 0; d < nd; d++) {
    var r = Math.round(nd === 1 ? OUTER : INNER + (d * (OUTER - INNER)) / (nd - 1));
    var spin = SPINS[d % 3]! * (d >= 3 ? 1.3 : 1);
    var parts = '<circle cx="' + CX + '" cy="' + CY + '" r="' + r + '" fill="none" stroke="' + cream + '" stroke-opacity=".12" stroke-width="1"/>';
    for (var k = 0; k < beads; k++) {
      var a = -Math.PI / 2 + (k / beads) * 2 * Math.PI;
      var x = Math.round(CX + Math.cos(a) * r), y = Math.round(CY + Math.sin(a) * r);
      var rad = 4 + ((k * 7 + d * 3) % 5);
      var delay = ((k / beads) * cycle + d * 0.7).toFixed(2);
      parts += '<circle class="bead" cx="' + x + '" cy="' + y + '" r="' + rad + '" fill="' + cream + '" fill-opacity=".95" style="animation-delay:' + delay + 's"/>';
    }
    rings += '<g class="rot" style="--spin:' + spin + 's">' + parts + '</g>';
  }
  return '<svg class="art-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style="background:' + ground + '">' + rings + '</svg>';
}

// ---------------------------------------------------------------------------
// The read, as it happens (ticket 21) — the adapters stream the publisher's
// progress one JSON line at a time ahead of the answer. Embedded by source
// like the time edits: the browser runs exactly what the tests ran.
// ---------------------------------------------------------------------------

/** One stage's closer on one night, as the progress lines carry it. */
export interface PosterHeadliner {
  artist: string;
  stage: string;
  night: string;
  start: string;
}

/**
 * The lines in what has arrived so far. `pending` is the unfinished line the
 * last call left over, `chunk` is what just arrived, and `ended` says the
 * response is over, so a last line without its newline still counts. A
 * progress line lands in `progress`; any other line is the answer. A line that
 * is not JSON is skipped: nothing is shown that was not said.
 */
export function takeLines(pending: string, chunk: string, ended: boolean): { progress: unknown[]; answer: unknown; rest: string } {
  var parts = (pending + chunk).split('\n');
  var rest = ended ? '' : parts.pop()!;
  var progress = [], answer = null;
  for (var i = 0; i < parts.length; i++) {
    var line = parts[i]!.trim();
    if (!line) continue;
    var value;
    try { value = JSON.parse(line); } catch (e) { continue; }
    if (value && typeof value === 'object' && 'progress' in value) progress.push(value.progress);
    else answer = value;
  }
  return { progress: progress, answer: answer, rest: rest };
}

/** Images done over images sent, as a whole percentage. Never more than 100, never a guess. */
export function percentDone(done: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(100, Math.floor((done * 100) / total)));
}

/** The status line while the times are read, from one progress report. */
export function readingStatus(p: { step: string; image: number; total: number; done: number; sets: number }): string {
  var pct = percentDone(p.done, p.total) + '% · ';
  var sets = p.sets + ' set' + (p.sets === 1 ? '' : 's');
  if (p.step === 'checked') {
    return pct + (p.total === 1 ? 'Your image has set times on it.' : 'Image ' + (p.image + 1) + ' of ' + p.total + ' has set times on it.');
  }
  if (p.done >= p.total) return pct + 'All ' + sets + ' read.';
  return pct + sets + ' read so far.';
}

/** The status line while confirm works, from the step it reported. */
export function confirmStatus(step: string): string {
  if (step === 'saving') return 'Saving them.';
  if (step === 'done') return 'Saved.';
  return 'Checking the times hold together.';
}

/**
 * One headliner in the center of the wait, the way a stage card cycles its
 * closers (`beadsArt()` in src/pages.ts): the night and the start in mono caps
 * above the name in expanded display type, ink on the light ground, sized so
 * a long name still fits across.
 */
export function posterBlock(h: PosterHeadliner): string {
  var CX = 200, CY = 120, ink = '#12181F';
  var p = h.night.split('-').map(Number);
  var weekday = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][new Date(Date.UTC(p[0]!, p[1]! - 1, p[2]!)).getUTCDay()];
  var hh = Number(h.start.slice(11, 13)), mm = Number(h.start.slice(14, 16));
  var clock = ((hh + 11) % 12) + 1 + (mm ? ':' + String(mm).padStart(2, '0') : '') + ' ' + (hh >= 12 ? 'PM' : 'AM');
  var fs = Math.max(22, Math.min(48, Math.floor(340 / (Math.max(1, h.artist.length) * 0.78))));
  return '<g class="lbl">' +
    '<text class="eb" x="' + CX + '" y="' + (CY - Math.round(fs * 0.5) - 10) + '" text-anchor="middle" fill="' + ink + '" fill-opacity=".85">' + weekday + ' · ' + clock + '</text>' +
    '<text class="disp" x="' + CX + '" y="' + (CY + Math.round(fs * 0.42)) + '" font-size="' + fs + '" text-anchor="middle" fill="' + ink + '">' + String(h.artist).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</text>' +
    '</g>';
}

/**
 * The update link: the edition's path under `/update/`, the secret in the
 * fragment so it never reaches a server log. Ticket 09 builds what it opens;
 * this is the one place its shape is decided.
 */
export function updateLink(editionPath: string, secret: string): string {
  return `${PROD_ORIGIN}/update/${editionPath}/#${secret}`;
}

/** Where the update-link page for an edition is written under dist/: `update/<edition path>`. */
export function updatePagePath(editionPath: string): string {
  return `update/${editionPath}`;
}

/**
 * The owner's bookmark: this same page, the owner secret in the fragment so it
 * never reaches a server log. The script reads it, clears it from the address
 * bar, and sends it as `owner` with both posts; the publisher decides what it
 * means. The screens are the same screens — only the review's address and the
 * confirm's namespace differ. Runbook: docs/owner-runbook.md.
 */
export function ownerLink(secret: string): string {
  return `${PROD_ORIGIN}/upload/#owner=${encodeURIComponent(secret)}`;
}

/** The owner secret in a location fragment, or '' — the page's reading of `ownerLink()`. */
export function ownerFromFragment(hash: string): string {
  var m = /(?:^#|&)owner=([^&]*)/.exec(hash);
  if (!m) return '';
  try { return decodeURIComponent(m[1] || ''); } catch (e) { return ''; }
}

/**
 * What the browser checks before it posts, and how it shrinks a photo so the
 * request fits under the platform's body cap (well below the publisher's own
 * 10 MB). One post carries every day's image, so the byte budget is shared
 * out over the days: a lone screenshot never needs shrinking; three days of
 * them, or a 12-megapixel photo of a poster, do. The same bytes go to upload
 * and to confirm, so the hashes match.
 */
const LIMITS = {
  minEdge: MIN_IMAGE_EDGE,
  maxEdge: MAX_IMAGE_EDGE,
  types: ACCEPTED_IMAGE_TYPES,
  /** One image per day, and no more than the publisher takes in one upload. */
  maxImages: MAX_UPLOAD_IMAGES,
  /** Bytes to post at most, all images together; base64 adds a third, and the platform caps the body around 4.5 MB. */
  postBytes: 2_800_000,
  /** Long edge to shrink to when a photo is over the byte budget or the publisher's edge cap. */
  postEdge: 3000,
};

// ---------------------------------------------------------------------------
// CSS — this page's own rules, on top of the shared tokens
// ---------------------------------------------------------------------------

const CSS = `
/* ── upload flow ─────────────────────────────────────────────────────────── */
.screen{margin-top:var(--gap-4)}
.screen h3{margin-bottom:var(--gap-2)}
.lead{margin:0; max-width:44ch}
.field{display:block; margin-top:var(--gap-3)}
.field>span:first-child{display:block; font-size:var(--t-small); font-weight:600; margin-bottom:6px}
/* Fields are the one non-capsule control: 52pt tall, 8pt radius, sunk fill, no shadow. */
.field input,.field select{
  display:block; width:100%; height:52px; border-radius:8px;
  border:1px solid var(--paper-line); background:var(--paper-sunk); color:var(--ink);
  font:inherit; font-size:var(--t-body); padding:0 14px; margin:0;
}
.field input{-webkit-appearance:none; appearance:none}
/* A hidden field stays hidden: the display rule above would otherwise beat the attribute. */
.field[hidden]{display:none}
.field input:focus,.field select:focus,.times input:focus{outline:2px solid var(--red-deep); outline-offset:2px}
.field-pair{display:grid; grid-template-columns:1fr 1fr; gap:var(--gap-1)}
.hint{display:block; margin-top:6px; font-family:var(--font-mono); font-size:var(--t-mono); color:var(--ink-soft); line-height:1.5}
.problem{
  background:var(--yellow); color:#12181F; border-radius:var(--r-card);
  padding:var(--gap-3); margin:var(--gap-3) 0 0; font-size:var(--t-small); font-weight:500;
}
.problem ul{margin:8px 0 0; padding-left:1.2em}
.status{font-family:var(--font-mono); font-size:var(--t-mono); color:var(--ink-soft); margin:var(--gap-2) 0 0}
.screen>.btn--primary,.screen>form>.btn--primary{margin-top:var(--gap-4)}
.screen .text-btn{margin-top:var(--gap-2)}
/* A text button that is a <button>: strip the UA fill so it is the bare label the skill asks for. */
button.text-btn{background:none; border:0; padding:0; font-family:inherit}
.file-btn{position:relative; overflow:hidden}
.file-btn input{position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:pointer; font-size:0}

/* the read, as fields (ticket 20): the name, then the days — a weekend at a time */
.read{margin-top:var(--gap-3)}
.read .weekend{margin-top:var(--gap-3)}
.read .weekend>.eyebrow{margin:0 0 var(--gap-1)}
.read .weekend>.eyebrow[hidden]{display:none}
.read .field-pair>.field{margin-top:0}
.read+.status{margin-top:var(--gap-2)}

/* one row per day: the row list — a 56pt tile at the margin, the day and the
   action beside it, 80pt pitch, no dividers. The whole row is the file action. */
.days{list-style:none; margin:var(--gap-2) 0 0; padding:0}
.day-row{
  display:flex; align-items:center; gap:var(--gap-3); min-height:80px;
  border-radius:var(--r-card); cursor:pointer; -webkit-tap-highlight-color:transparent;
  transition:transform var(--t-press) ease;
}
.day-row:active{transform:var(--press)}
.day-row:focus-within{outline:2px solid var(--red-deep); outline-offset:2px}
.thumb{
  flex:none; width:56px; height:56px; border-radius:var(--r-card); overflow:hidden;
  background:var(--paper-sunk); color:var(--ink-soft);
  display:flex; align-items:center; justify-content:center;
  font-family:var(--font-mono); font-size:var(--t-body);
}
.thumb img{display:block; width:100%; height:100%; object-fit:cover}
.thumb img[hidden]{display:none}
.day-text{display:flex; flex-direction:column; gap:4px; min-width:0}
.day-action{font-size:var(--t-body); font-weight:600; color:var(--ink)}
.day.is-chosen .day-action{font-weight:500; color:var(--ink-soft)}
.day>.problem{margin:0 0 var(--gap-2)}
.fewer{margin:var(--gap-2) 0 0}

/* the wait, drawn: the beads with no sets yet, in the art slot of a card;
   each headliner fades up in the center as its image is read */
.loading{position:relative; margin:var(--gap-4) 0 0; aspect-ratio:400/240; border-radius:var(--r-card); overflow:hidden}
.loading .bead{opacity:0; animation:bead-in 12s ease-in-out infinite}
@keyframes bead-in{0%{opacity:0}6%{opacity:1}70%{opacity:1}82%{opacity:0}100%{opacity:0}}
.loading .lbl{animation:name-in .5s ease-out}
@keyframes name-in{from{opacity:0}to{opacity:1}}
.screen>.loading+.status{margin-top:var(--gap-2)}

/* the uploader's own image, in a card, tall enough to read a poster off */
.source{margin:var(--gap-4) 0 0; background:var(--paper-sunk); border-radius:var(--r-card); overflow:hidden}
.source img{display:block; width:100%; height:auto; max-height:70vh; object-fit:contain}
.source figcaption{padding:0 var(--pad-card) 6px}
/* a day of the review: its image, then its sets — the next day well below */
.day-review{margin-top:var(--gap-6)}
.day-review:first-child{margin-top:0}
.day-review>.eyebrow{margin:var(--gap-4) 0 0}
.day-review:not(:first-child)>.eyebrow{margin-top:0}
.day-review>.eyebrow+.source{margin-top:var(--gap-1)}
.day-review>.small{margin:var(--gap-2) 0 0}
/* the unflagged sets wait behind one text button per day */
.day-review>.text-btn{margin-top:var(--gap-3)}
.set[hidden],.stage-group[hidden]{display:none}

/* the review rows: one set at a time, no dividers */
.stage-group{margin-top:var(--gap-5)}
.stage-group .eyebrow{margin-bottom:var(--gap-1)}
.sets{list-style:none; margin:0; padding:0}
.set{padding:var(--gap-3) 0 var(--gap-4)}
.set .field{margin-top:0}
.set .field input{font-weight:600}
.times{display:flex; align-items:center; gap:var(--gap-1); margin-top:var(--gap-1)}
.times input{
  height:44px; border-radius:8px; border:1px solid var(--paper-line);
  background:var(--paper-sunk); color:var(--ink); font:inherit; font-size:var(--t-body);
  padding:0 8px; margin:0; min-width:0; flex:1; -webkit-appearance:none; appearance:none;
}
.printed{margin:6px 0 0}
.chips{display:flex; flex-wrap:wrap; gap:var(--gap-1); margin-top:var(--gap-2)}
.chip{
  display:inline-flex; align-items:center; height:32px; padding:0 14px; border-radius:16px;
  background:var(--yellow); color:#12181F; font-size:var(--t-small); font-weight:600;
}
.set .btn--sm{width:auto; padding:0 var(--gap-4); margin-top:var(--gap-2)}

/* links on the way out */
.link-row{display:flex; align-items:center; gap:var(--gap-1); margin-top:var(--gap-1)}
.link-row code.url{flex:1; margin-top:0}
.btn--danger{color:var(--red-deep)}
.vh{position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap}
@media (prefers-reduced-motion: reduce){
  .day-row:active{transform:none}
  .loading .bead{opacity:1}
  .loading .lbl{animation:none}
}
@media (max-width:359px){
  .field-pair{grid-template-columns:1fr}
}
`;

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/** What the update-link page needs of an edition's manifest. */
export interface UpdateTarget {
  festival: { name: string; year: number; basePath: string };
  blocked: boolean;
  all: { dayspan: { first: string; last: string } };
}

/**
 * The upload flow. With no edition it is `/upload/`, adding a new festival.
 * With one it is that edition's update-link page: the same screens, but it
 * names the festival up front, says what a new screenshot replaces before
 * anything is uploaded, and offers taking it down. A taken-down edition's page
 * says so and offers nothing.
 */
export function renderUploadPage(edition?: UpdateTarget): string {
  if (edition?.blocked) return renderRemovedUpdatePage(edition);
  const zones = REVIEW_ZONES.map((z) => `<option value="${esc(z.id)}">${esc(z.label)}</option>`).join('');
  const f = edition?.festival;
  const pageAddress = f ? `${PROD_ORIGIN.replace(/^https:\/\//, '')}${f.basePath}/` : '';
  const value = (v: string | undefined) => (v ? ` value="${esc(v)}"` : '');

  const header = f
    ? `<header>
    <p class="lockup">Stage&nbsp;Times</p>
    <h2>${esc(f.name)} <span style="color:var(--ink-soft)">${f.year}</span></h2>
    <p class="title-meta mono-cap">Fix a time or take it down</p>
  </header>`
    : `<header>
    <p class="lockup">Stage&nbsp;Times</p>
    <h2>Add a festival</h2>
    <p class="title-meta mono-cap">From the festival’s schedule page, or your screenshots</p>
  </header>`;

  const changing = f
    ? `
    <p class="lead" data-changing>A new screenshot replaces every time on <a href="${esc(f.basePath)}/">${esc(pageAddress)}</a>. Anyone who added a stage gets the new times the next time their calendar app checks.</p>`
    : '';

  const removeAction = f
    ? `
    <button class="text-btn" type="button" data-back="remove">Take it down</button>`
    : `
    <button class="text-btn" type="button" data-back="link">Use a link</button>`;

  // The front door (ticket 20): where the set times are, and an email. The
  // update link's page keeps its own first screen — it names its festival.
  const linkScreen = f
    ? ''
    : `
  <section class="screen" data-screen="link">
    <form id="link" novalidate>
      <label class="field"><span>Schedule page</span><input name="url" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://" required>
        <span class="hint">The festival’s page with the set times on it, not the lineup.</span></label>
      <label class="field"><span>Email</span><input name="email" type="email" inputmode="email" autocomplete="email" required>
        <span class="hint">Only so I can reach you about a wrong time. No account, and nothing gets sent to it.</span></label>
      <p class="problem" role="alert" hidden></p>
      <figure class="loading" data-loading hidden></figure>
      <p class="status" aria-live="polite" hidden></p>
      <button class="btn btn--primary" type="submit">Read the times</button>
    </form>
    <button class="text-btn" type="button" data-back="details">Use screenshots</button>
  </section>`;

  const removeScreens = f
    ? `

  <section class="screen" data-screen="remove" hidden>
    <h3>Take it down</h3>
    <p class="lead">Its calendars go empty and the page says it was taken down. Anyone who added a stage sees it come up blank the next time their calendar app checks.</p>
    <p class="problem" role="alert" hidden></p>
    <button class="btn btn--tonal btn--danger" type="button" data-remove>Take it down</button>
    <button class="text-btn" type="button" data-back="details">Keep it</button>
  </section>

  <section class="screen" data-screen="removed" hidden>
    <h3>Taken down</h3>
    <p class="lead">The page and its calendars empty out in a couple of minutes.</p>
  </section>`
    : '';

  const publishingLead = f
    ? 'Your new times are saved. The page takes a couple of minutes to rebuild, and this waits for it.'
    : 'Your times are saved. The page and its calendars take a couple of minutes to build, and this waits for them.';

  const publishingLink = f
    ? ''
    : `
    <p class="eyebrow" style="margin-top:var(--gap-5)">Your update link</p>
    <div class="link-row"><code class="url" data-update></code><button class="icon-btn" data-copy aria-label="Copy update link">${ICON_LINK}${ICON_CHECK}</button></div>
    <p class="small">Keep this one now, while it builds. It's the only way to fix a time or take the page down later, and it's shown once.</p>`;

  const successLive = f
    ? `<h3>It's live</h3>
      <p class="lead">The new times are on your page. Calendars pick them up the next time they check.</p>`
    : `<h3>It's live</h3>
      <p class="lead">Add a stage from your page like anyone would, and send the link around.</p>`;

  const successLinks = f
    ? ''
    : `
    <p class="eyebrow" style="margin-top:var(--gap-4)">Your update link</p>
    <div class="link-row"><code class="url" data-update></code><button class="icon-btn" data-copy aria-label="Copy update link">${ICON_LINK}${ICON_CHECK}</button></div>
    <p class="small">Keep this one. It's the only way to fix a time or take the page down later, and it's shown once.</p>
    <p class="small">Not on the homepage yet. I list festivals by hand.</p>`;

  const body = `<main class="wrap">
  <nav class="topbar">
    <a class="icon-btn" href="/" aria-label="Stage Times home">${ICON_BACK}</a>
  </nav>

  ${header}
${linkScreen}
  <section class="screen" data-screen="details"${f ? '' : ' hidden'}>${changing}
    <form id="details" novalidate>
      <label class="field"><span>Festival</span><input name="festival" type="text" autocomplete="off" autocapitalize="words" required${value(f?.name)}></label>
      <div class="field-pair">
        <label class="field"><span>First day</span><input name="first" type="date" required${value(edition?.all.dayspan.first)}></label>
        <label class="field"><span>Last day</span><input name="last" type="date" required${value(edition?.all.dayspan.last)}></label>
      </div>
      <label class="field"><span>Email</span><input name="email" type="email" inputmode="email" autocomplete="email" required>
        <span class="hint">Only so I can reach you about a wrong time. No account, and nothing gets sent to it.</span></label>
      <label class="field" data-link hidden><span>Schedule link</span><input name="link" type="url" inputmode="url" autocomplete="off" placeholder="https://">
        <span class="hint">Where the festival posted the times, since the image doesn't say.</span></label>
      <p class="problem" role="alert" hidden></p>
      <button class="btn btn--primary" type="submit">Next</button>
    </form>${removeAction}
  </section>

  <section class="screen" data-screen="upload" hidden>
    <h3 data-title>Your screenshot</h3>
    <p class="lead">The schedule with the times on it, not the lineup. A screenshot from the app or a photo of the poster both work.</p>
    <p class="problem" role="alert" hidden></p>
    <figure class="loading" data-loading hidden></figure>
    <p class="status" aria-live="polite" hidden></p>
    <div data-one>
      <label class="btn btn--primary file-btn"><span>Choose image</span><input type="file" accept="image/*" name="image"></label>
    </div>
    <div data-many hidden>
      <ol class="days" data-days></ol>
      <template id="day-slot">
        <li class="day" data-slot="">
          <label class="day-row">
            <span class="thumb" aria-hidden="true"><img alt="" hidden><span data-n></span></span>
            <span class="day-text"><span class="mono-cap" data-day></span><span class="day-action" data-action>Choose image</span></span>
            <input class="vh" type="file" accept="image/*" data-slot-input>
          </label>
          <p class="problem" role="alert" hidden></p>
        </li>
      </template>
      <button class="btn btn--primary" type="button" data-read disabled>Read the times</button>
      <p class="small fewer">A day with no times yet can be left out.</p>
    </div>
  </section>

  <section class="screen" data-screen="review" hidden>
    <h3>Does this look right?</h3>
    <p class="lead" data-review-lead>Against your image. Check the flagged sets and fix what's off.</p>
    <div class="read" data-as-read hidden>
      <label class="field"><span>Festival</span><input name="name" type="text" autocomplete="off" autocapitalize="words" data-read-name></label>
      <div data-read-days></div>
      <template id="read-weekend">
        <div class="weekend"><p class="eyebrow" data-weekend hidden></p><div class="field-pair" data-weekend-days></div></div>
      </template>
      <template id="read-day">
        <label class="field"><span data-weekday></span><input type="date" data-read-day></label>
      </template>
    </div>
    <p class="status" data-address></p>
    <p class="problem" role="alert" hidden></p>
    <p class="problem" data-year hidden></p>
    <label class="field"><span>Time zone</span><select name="timezone">${zones}</select>
      <span class="hint" data-zone-hint>A guess, since the image can't say. Change it if the festival is somewhere else.</span></label>
    <div id="sets"></div>
    <template id="day-figure">
      <figure class="source"><img alt="Your image"><figcaption><a class="text-btn" target="_blank" rel="noopener">See it bigger ↗</a></figcaption></figure>
    </template>
    <template id="set-row">
      <li class="set" data-index="">
        <label class="field"><span class="vh">Artist</span><input type="text" data-field="artist" autocomplete="off"></label>
        <div class="times">
          <input type="time" aria-label="Start" data-field="start">
          <span aria-hidden="true">–</span>
          <input type="time" aria-label="End" data-field="end">
        </div>
        <p class="small printed"><span class="mono-cap" data-day></span> · Printed <span data-printed></span><span data-guess hidden></span></p>
        <div class="chips"><span class="chip" data-flag="low">Look closer</span></div>
        <p class="small" data-unsure hidden></p>
        <button class="btn btn--sm btn--tonal" type="button" data-looks-good>Looks good</button>
      </li>
    </template>
    <details class="notes" hidden>
      <summary>Notes from the read</summary>
      <div class="body"><ul data-observations></ul></div>
    </details>
    <button class="btn btn--primary" type="button" data-confirm>Confirm</button>
    <figure class="loading" data-loading hidden></figure>
    <p class="status" aria-live="polite" data-save-status hidden></p>
    <button class="text-btn" type="button" data-back="upload" data-swap>Different image</button>
  </section>

  <section class="screen" data-screen="publishing" hidden>
    <h3>Building your page</h3>
    <p class="lead">${publishingLead}</p>
    <p class="status" aria-live="polite" data-publish-status>Checking again every ten seconds.</p>${publishingLink}
  </section>

  <section class="screen" data-screen="success" hidden>
    <div data-live>
      ${successLive}
    </div>
    <div data-late hidden>
      <h3>Nearly there</h3>
      <p class="lead">Still building after five minutes, which is longer than usual. The links don't change, and they'll work once it's done.</p>
    </div>
    <p class="eyebrow" style="margin-top:var(--gap-5)">Your page</p>
    <div class="link-row"><code class="url" data-share></code><button class="icon-btn" data-copy aria-label="Copy page link">${ICON_LINK}${ICON_CHECK}</button></div>${successLinks}
    <a class="btn btn--primary" data-open>Open your page</a>
  </section>${removeScreens}

  <footer>
    <p>Anything put on here is checked by the person who put it there, against their own image, before it goes live.</p>
    <p>Unofficial. Not affiliated with any festival.</p>
    <p>Wrong time? <a href="https://github.com/jake-lunde/stage-times/issues">Tell me ↗</a></p>
  </footer>
</main>

<script>
(function () {
  'use strict';
  var GATES = ${JSON.stringify(GATE_SCREENS)};
  var LIMITS = ${JSON.stringify(LIMITS)};
  var COPY = ${JSON.stringify(GATE_COPY)};
  var EMAIL_RE = ${EMAIL_RE.toString()};
  ${fill.toString()}
  var ORIGIN = '${PROD_ORIGIN}';
  var UPDATE_LINK = ${JSON.stringify(updateLink('{path}', '{secret}'))};
  // The edition this page changes, or null on /upload/. The secret is the link's
  // fragment: it never reaches a server log, and it goes out only in a body.
  var UPDATE = ${JSON.stringify(f ? { editionPath: f.basePath.replace(/^\//, '') } : null)};
  function updateClaim() { return UPDATE ? { editionPath: UPDATE.editionPath, secret: location.hash.slice(1) } : undefined; }
  var BUILD_WAIT_MS = 5 * 60 * 1000;
  var POLL_MS = 10 * 1000;
  var ART_GROUND = '${artGround('#EC300C')}';
  ${loadingArt.toString()}

  ${takeLines.toString()}
  ${percentDone.toString()}
  ${readingStatus.toString()}
  ${confirmStatus.toString()}
  ${posterBlock.toString()}
  var CALM = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var HOLD_MS = 4500;

  // The wait, said and drawn. The status line says what has happened, and
  // only that: the publisher's own reports as they arrive, a percentage of
  // images done over images sent, never a guess from the clock. As each image
  // is read, its headliners join the center of the art, one at a time, the
  // way a stage card cycles its closers.
  function startWork(screen, first, days) {
    var status = $('[data-loading] + .status', screens[screen]), art = $('[data-loading]', screens[screen]);
    art.innerHTML = loadingArt(days, ART_GROUND);
    art.hidden = false;
    status.textContent = first;
    status.hidden = false;
    var svg = $('svg', art), names = [], at = -1, timer = null;
    function showName(i) {
      at = i;
      var old = $('.lbl', svg);
      if (old) old.remove();
      svg.insertAdjacentHTML('beforeend', posterBlock(names[i]));
    }
    return {
      say: function (text) { status.textContent = text; },
      // A link learns how many images there are only once the page is open: the rings follow.
      redraw: function (n) { var old = $('.lbl', svg); art.innerHTML = loadingArt(n, ART_GROUND); svg = $('svg', art); if (old) svg.appendChild(old); },
      headliners: function (list) {
        if (!list || !list.length) return;
        var first = names.length;
        names = names.concat(list);
        showName(first);
        if (!timer && !CALM) timer = setInterval(function () { if (names.length > 1) showName((at + 1) % names.length); }, HOLD_MS);
      },
      stop: function () {
        if (timer) clearInterval(timer);
        art.hidden = true;
        art.innerHTML = '';
        status.hidden = true;
      },
    };
  }

  ${ownerFromFragment.toString()}
  // The owner's bookmark. Read once, then cleared from the address bar so a
  // shared screen or a copied link never carries it.
  var OWNER = ownerFromFragment(location.hash);
  if (OWNER && history.replaceState) history.replaceState(null, '', location.pathname + location.search);
  function withOwner(body) { if (OWNER) body.owner = OWNER; return body; }

  // state.days is every day an image can be chosen for; state.images is what
  // has been, by day, in day order and without gaps — the rows are offered one at a time.
  // state.via says which first screen the review came from: 'link' or 'upload'.
  var state = { via: 'upload', details: null, days: [], images: [], review: null, timezoneAssumed: true, timezoneOnRecord: false, published: null, live: false };
  function chosen() { return state.images.filter(function (im) { return !!im; }); }
  function multiDay() { return state.days.length > 1; }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var screens = {};
  $$('[data-screen]').forEach(function (s) { screens[s.getAttribute('data-screen')] = s; });
  function show(name) {
    Object.keys(screens).forEach(function (k) { screens[k].hidden = k !== name; });
    window.scrollTo(0, 0);
  }

  // One yellow line per screen. Empty text hides it.
  function problem(name, text, list) {
    var p = $('.problem', screens[name]);
    p.textContent = text || '';
    if (list && list.length) {
      var ul = document.createElement('ul');
      list.forEach(function (item) { var li = document.createElement('li'); li.textContent = item; ul.appendChild(li); });
      p.appendChild(ul);
    }
    p.hidden = !text;
  }
  function fail(name, body) {
    var reason = body && body.reason ? body.reason : 'Something went wrong on my end. Try again in a minute.';
    var rest = body && body.problems && body.problems.length > 1 ? body.problems.slice(1) : null;
    problem(name, reason, rest);
  }
  function screenFor(gate, fallback) { return GATES[gate] || fallback; }
  // A rejection lands on the screen that can fix it — and one about a single
  // image of several lands under that day's row, in the publisher's own words.
  function land(body, fallback) {
    var to = screenFor(body.gate, fallback);
    if (!screens[to]) to = fallback;
    // A review that will not build stays on review — but only if there is one.
    if (to === 'review' && !state.review) to = 'upload';
    // A source with no web address on it: the form grows the one field for it.
    if (body.gate === 'link') $('[data-link]').hidden = false;
    if (to === 'upload' && multiDay() && typeof body.image === 'number' && slotOf(body.image)) {
      problem('upload', '');
      slotProblem(body.image, body.reason);
    } else {
      fail(to, body);
    }
    show(to);
  }

  // With a listener and a browser that can read a response as it arrives,
  // the post asks for the progress lines ahead of the answer; the answer is
  // the last line, the same body a plain post gets. Without either, it is a
  // plain post and the answer comes all at once, as it always did.
  var CAN_STREAM = typeof ReadableStream !== 'undefined' && typeof TextDecoder !== 'undefined';
  function post(path, body, onProgress) {
    var stream = !!onProgress && CAN_STREAM;
    var headers = { 'Content-Type': 'application/json' };
    if (stream) headers.Accept = 'application/x-ndjson';
    return fetch(path, { method: 'POST', headers: headers, body: JSON.stringify(body) })
      .then(function (res) {
        var lines = stream && res.body && res.body.getReader && (res.headers.get('content-type') || '').indexOf('application/x-ndjson') === 0;
        var answer = lines ? readLines(res.body.getReader(), onProgress) : res.json().catch(function () { return null; });
        return answer.then(function (parsed) {
          if (!parsed) {
            parsed = { ok: false, reason: res.status === 413
              ? 'That image is too big to send. A screenshot is usually fine; a photo of a poster may need to be smaller.'
              : 'Something went wrong on my end. Try again in a minute.' };
          }
          return { ok: res.ok && parsed.ok === true, status: res.status, body: parsed };
        });
      }).catch(function () {
        return { ok: false, status: 0, body: { reason: 'It didn\\'t go through. Check your signal and try again.' } };
      });
  }
  // Each progress line to the listener as it lands; the answer when it ends.
  function readLines(reader, onProgress) {
    var decoder = new TextDecoder(), pending = '', answer = null;
    function next() {
      return reader.read().then(function (r) {
        var got = takeLines(pending, r.done ? decoder.decode() : decoder.decode(r.value, { stream: true }), r.done);
        pending = got.rest;
        got.progress.forEach(function (p) { onProgress(p); });
        if (got.answer) answer = got.answer;
        return r.done ? answer : next();
      });
    }
    return next();
  }

  // ── details ──────────────────────────────────────────────────────────────
  $('#details').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var d = { festival: f.festival.value.trim(), first: f.first.value, last: f.last.value, email: f.email.value.trim(), link: f.link.value.trim() };
    if (!d.festival) return problem('details', COPY.festival);
    if (!d.first || !d.last || d.last < d.first) return problem('details', COPY.dates);
    if (!EMAIL_RE.test(d.email)) return problem('details', COPY.email);
    if (d.link && !/^https?:\\/\\/\\S+$/.test(d.link)) return problem('details', 'That link doesn\\'t look right. It starts with https://');
    problem('details', '');
    state.details = d;
    state.via = 'upload';
    var days = festivalDays(d.first, d.last, LIMITS.maxImages);
    if (days.join() !== state.days.join()) {
      state.images.forEach(function (im) { if (im) URL.revokeObjectURL(im.url); });
      state.images = [];
      state.days = days;
    }
    renderSlots();
    show('upload');
    // Back here from a rejection with the one image already chosen: read it again.
    if (!multiDay() && state.images[0]) sendUpload();
  });
  // What the form typed, as both adapters read it. The link only when there is one.
  function typed(body) {
    var d = state.details;
    body.festival = d.festival;
    body.email = d.email;
    if (d.link) body.officialUrl = d.link;
    return body;
  }

  // ── link ─────────────────────────────────────────────────────────────────
  ${slugify.toString()}
  ${weekdayName.toString()}
  ${weekendRuns.toString()}
  ${readAddress.toString()}
  ${linkStatus.toString()}
  var linkForm = $('#link');
  // Bytes from the answer's base64, so the page holds each fetched image as it
  // holds a chosen one: shown on review, sent back on confirm untouched.
  function bytesOf(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Every answer to a link lands here — the one screen that came before it —
  // in the publisher's sentence, with the screenshots one tap away.
  function landLink(body) { fail('link', body); show('link'); }
  if (linkForm) linkForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var url = f.url.value.trim(), email = f.email.value.trim();
    if (!url) return problem('link', 'Paste the link to the festival\\'s schedule page first.');
    if (!EMAIL_RE.test(email)) return problem('link', COPY.email);
    problem('link', '');
    var btn = $('button[type="submit"]', f), was = btn.textContent;
    btn.classList.add('is-loading');
    btn.textContent = 'Reading\\u2026';
    var work = startWork('link', CAN_STREAM ? linkStatus({ step: 'page' }) : 'Reading the set times off that page. This could take a few minutes.', 1);
    post('/api/link', withOwner({ url: url, email: email }), function (p) {
      if (p.kind === 'link') { work.say(linkStatus(p)); if (p.step === 'found') work.redraw(p.images); }
      if (p.kind === 'read') { work.say(readingStatus(p)); work.headliners(p.headliners); }
    }).then(function (r) {
      work.stop();
      btn.classList.remove('is-loading');
      btn.textContent = was;
      if (!r.ok) return landLink(r.body);
      var rv = r.body.review, days = r.body.days;
      state.images.forEach(function (im) { if (im) URL.revokeObjectURL(im.url); });
      state.images = r.body.images.map(function (im) {
        var blob = new Blob([bytesOf(im.data)], { type: im.contentType });
        return { blob: blob, url: URL.createObjectURL(blob), filename: im.filename, contentType: im.contentType, width: im.width, height: im.height, data: im.data };
      });
      state.days = days;
      // What an upload's form would have typed, as read off the page: the link is the official schedule.
      state.details = { festival: rv.festival, first: days[0], last: days[days.length - 1], email: email, link: r.body.officialUrl };
      state.via = 'link';
      state.review = rv;
      state.timezoneAssumed = rv.timezoneAssumed;
      state.timezoneOnRecord = rv.timezoneOnRecord;
      renderReview();
      show('review');
    });
  });

  // ── upload ───────────────────────────────────────────────────────────────
  ${festivalDays.toString()}
  ${nightOf.toString()}
  ${dayLabel.toString()}
  ${daysLabel.toString()}

  // One day is the one file pill, posting on choose. More is a row per day:
  // the rows are offered one at a time, each one tappable again to swap its
  // image, and one pill reads whatever has been chosen.
  var fileInput = $('input[name="image"]');
  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (file) takeImage(file, 0);
  });
  var dayList = $('[data-days]'), slotTpl = $('#day-slot'), readBtn = $('[data-read]');
  function slotOf(i) { return $('[data-slot="' + i + '"]', dayList); }
  function slotProblem(i, text) {
    var p = $('.problem', slotOf(i));
    p.textContent = text || '';
    p.hidden = !text;
  }
  function renderSlots() {
    var multi = multiDay();
    $('[data-title]', screens.upload).textContent = multi ? 'Your screenshots' : 'Your screenshot';
    $('[data-one]', screens.upload).hidden = multi;
    $('[data-many]', screens.upload).hidden = !multi;
    if (!multi) return;
    // Every day at once, so the shape of the upload is clear before the first image.
    var offered = state.days.length;
    var problems = {};
    $$('[data-slot]', dayList).forEach(function (li) { var p = $('.problem', li); if (!p.hidden) problems[li.getAttribute('data-slot')] = p.textContent; });
    dayList.textContent = '';
    state.days.slice(0, offered).forEach(function (day, i) {
      var li = slotTpl.content.firstElementChild.cloneNode(true);
      var im = state.images[i];
      li.setAttribute('data-slot', String(i));
      $('[data-day]', li).textContent = dayLabel(day, true);
      $('[data-n]', li).textContent = String(Number(day.slice(8, 10)));
      var img = $('img', li);
      if (im) {
        li.classList.add('is-chosen');
        img.src = im.url;
        img.hidden = false;
        $('[data-n]', li).hidden = true;
        $('[data-action]', li).textContent = 'Swap image';
      }
      dayList.appendChild(li);
      if (problems[String(i)]) slotProblem(i, problems[String(i)]);
    });
    readBtn.disabled = chosen().length === 0;
  }
  dayList.addEventListener('change', function (e) {
    var input = e.target.closest('[data-slot-input]');
    if (!input) return;
    var slot = Number(input.closest('[data-slot]').getAttribute('data-slot'));
    var file = input.files && input.files[0];
    input.value = '';
    if (file) takeImage(file, slot);
  });
  readBtn.addEventListener('click', function () { if (chosen().length) sendUpload(); });

  function loadImage(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }
  function toBlob(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('encode')); }, 'image/jpeg', quality);
    });
  }
  // One post carries every day, so each image gets its share of the budget.
  function budget() { return Math.floor(LIMITS.postBytes / Math.max(1, state.days.length)); }
  // Shrink an image until it fits its share: a lone screenshot never gets here.
  function shrink(img, bytes) {
    var steps = [[LIMITS.postEdge, 0.85], [Math.round(LIMITS.postEdge * 0.75), 0.75], [Math.round(LIMITS.postEdge * 0.55), 0.7]];
    var long = Math.max(img.naturalWidth, img.naturalHeight);
    var i = 0;
    function attempt() {
      var edge = steps[i][0], quality = steps[i][1];
      var scale = Math.min(1, edge / long);
      var w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      return toBlob(c, quality).then(function (blob) {
        i += 1;
        if (blob.size <= bytes || i >= steps.length) return { blob: blob, width: w, height: h };
        return attempt();
      });
    }
    return attempt();
  }
  function base64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1]); };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }
  function mb(bytes) { return (bytes / (1024 * 1024)).toFixed(1).replace(/\\.0$/, ''); }

  // What the browser can tell about an image before it costs anything goes
  // under that day's row when there are several, on the screen's own line
  // when there is one.
  function problemAt(slot, text) {
    if (multiDay() && slotOf(slot)) slotProblem(slot, text); else problem('upload', text);
  }

  function takeImage(file, slot) {
    problemAt(slot, '');
    if (LIMITS.types.indexOf(file.type) === -1) {
      return problemAt(slot, COPY.notImage);
    }
    var bytes = budget();
    loadImage(file).then(function (loaded) {
      var img = loaded.img;
      var w = img.naturalWidth, h = img.naturalHeight;
      var short = Math.min(w, h), long = Math.max(w, h);
      if (short < LIMITS.minEdge) {
        URL.revokeObjectURL(loaded.url);
        return problemAt(slot, fill(COPY.tooSmall, { short: short, min: LIMITS.minEdge }));
      }
      var ready = (file.size > bytes || long > LIMITS.postEdge)
        ? shrink(img, bytes)
        : Promise.resolve({ blob: file, width: w, height: h });
      return ready.then(function (fit) {
        URL.revokeObjectURL(loaded.url);
        if (fit.blob.size > bytes) {
          return problemAt(slot, 'That image is still ' + mb(fit.blob.size) + ' MB after shrinking. ' + (multiDay()
            ? 'With ' + state.days.length + ' days, each one has to be under ' + mb(bytes) + ' MB.'
            : 'A screenshot is usually well under that.'));
        }
        return base64(fit.blob).then(function (data) {
          var was = state.images[slot];
          if (was) URL.revokeObjectURL(was.url);
          state.images[slot] = { blob: fit.blob, url: URL.createObjectURL(fit.blob), filename: file.name || 'image', contentType: fit.blob.type || file.type, width: fit.width, height: fit.height, data: data };
          if (!multiDay()) return sendUpload();
          renderSlots();
        });
      });
    }, function () {
      problemAt(slot, 'I couldn\\'t open that image. Try a screenshot instead.');
    });
  }

  function imageBody(im) {
    return { filename: im.filename, contentType: im.contentType, width: im.width, height: im.height, data: im.data };
  }
  // The images as the adapters read them: one is image, as it always was;
  // more is images, in day order.
  function withImages(body) {
    var list = chosen().map(imageBody);
    if (list.length === 1) body.image = list[0]; else body.images = list;
    return body;
  }

  function sendUpload() {
    var multi = multiDay();
    var btn = multi ? readBtn : $('.file-btn'), label = multi ? readBtn : $('span', btn);
    var d = state.details, n = chosen().length;
    var total = chosen().reduce(function (sum, im) { return sum + im.blob.size; }, 0);
    if (total > LIMITS.postBytes) {
      return problem('upload', 'Those images add up to ' + mb(total) + ' MB, more than I can send in one go. Screenshots are usually well under that.');
    }
    problem('upload', '');
    btn.classList.add('is-loading');
    label.textContent = 'Reading\\u2026';
    var work = startWork('upload',
      (CAN_STREAM ? percentDone(0, n) + '% · ' : '') + (n === 1
        ? 'Reading the times off your image. This could take about a minute.'
        : 'Reading the times off your ' + n + ' images. This could take about a minute per image.'),
      state.days.length);
    return post('/api/upload', withOwner(withImages(typed({ dates: { first: d.first, last: d.last }, update: updateClaim() }))), function (p) {
      if (p.kind !== 'read') return;
      work.say(readingStatus(p));
      work.headliners(p.headliners);
    }).then(function (r) {
      work.stop();
      btn.classList.remove('is-loading');
      label.textContent = multi ? 'Read the times' : 'Choose image';
      if (!r.ok) return land(r.body, 'upload');
      state.review = r.body.review;
      state.timezoneAssumed = state.review.timezoneAssumed;
      state.timezoneOnRecord = state.review.timezoneOnRecord;
      renderReview();
      show('review');
    });
  }

  // ── review ───────────────────────────────────────────────────────────────
  var zone = $('select[name="timezone"]');
  ${addDay.toString()}
  ${editedStart.toString()}
  ${editedEnd.toString()}
  function zoneHint() {
    $('[data-zone-hint]').textContent = state.timezoneAssumed
      ? 'A guess, since the image can\\'t say. Change it if the festival is somewhere else.'
      : state.timezoneOnRecord
      ? 'Where this festival is held. Change it if that\\'s wrong.'
      : 'Every time above is read in this zone.';
  }
  zone.addEventListener('change', function () { state.timezoneAssumed = false; state.timezoneOnRecord = false; zoneHint(); });

  // The read, as fields (ticket 20): the name, and each day the images were
  // read as, labeled with the weekday that date falls on — so a wrong year
  // shows up as the wrong weekday against the poster — a weekend at a time
  // when the days make more than one. The year is the first day's; the
  // address under them follows the name and that year as they are typed.
  var readBlock = $('[data-as-read]'), nameField = $('[data-read-name]'), dayGrid = $('[data-read-days]'), weekendTpl = $('#read-weekend'), dayTpl = $('#read-day');
  function renderRead(rv, viaLink) {
    readBlock.hidden = !viaLink;
    if (!viaLink) return;
    nameField.value = rv.festival;
    dayGrid.textContent = '';
    var runs = weekendRuns(state.days);
    runs.forEach(function (run, w) {
      var block = weekendTpl.content.firstElementChild.cloneNode(true);
      var head = $('[data-weekend]', block);
      head.textContent = 'Weekend ' + (w + 1);
      head.hidden = runs.length < 2;
      run.forEach(function (day) {
        var label = dayTpl.content.firstElementChild.cloneNode(true);
        $('[data-read-day]', label).value = day;
        $('[data-weekday]', label).textContent = weekdayName(day);
        $('[data-weekend-days]', block).appendChild(label);
      });
      dayGrid.appendChild(block);
    });
  }
  function readDays() { return $$('[data-read-day]', dayGrid).map(function (input) { return input.value; }); }
  function readYear() { var first = $('[data-read-day]', dayGrid); return first && first.value ? first.value.slice(0, 4) : ''; }
  function labelDay(input) { $('[data-weekday]', input.parentNode).textContent = weekdayName(input.value) || 'DAY'; }
  function readPath() {
    var rv = state.review;
    return state.via === 'link' ? readAddress(rv, nameField.value, readYear()) : rv.editionPath;
  }
  function updateAddress() {
    var rv = state.review;
    var address = ORIGIN.replace(/^https:\\/\\//, '') + '/' + readPath() + '/';
    $('[data-address]').textContent = !UPDATE ? 'Your page will be ' + address
      : rv.correcting ? 'This replaces the times on ' + address
      : 'That update link didn\\'t match, so this will be a new page: ' + address;
  }
  nameField.addEventListener('input', updateAddress);
  // The first day's year is the festival's: moving it moves every other day into that year.
  dayGrid.addEventListener('input', function (e) {
    var input = e.target.closest('[data-read-day]');
    if (!input) return;
    labelDay(input);
    var inputs = $$('[data-read-day]', dayGrid);
    if (input === inputs[0] && /^\\d{4}-/.test(input.value)) {
      var y = input.value.slice(0, 4);
      inputs.slice(1).forEach(function (other) { if (other.value && other.value.slice(0, 4) !== y) { other.value = y + other.value.slice(4); labelDay(other); } });
    }
    updateAddress();
  });

  function renderReview() {
    var rv = state.review;
    var multi = rv.images.length > 1;
    var viaLink = state.via === 'link';
    $('[data-review-lead]').textContent = viaLink
      ? 'As read off the page. Check the flagged sets and fix what\\'s off.'
      : multi
      ? 'Each day against its own image. Check the flagged sets and fix what\\'s off.'
      : 'Against your image. Check the flagged sets and fix what\\'s off.';
    var swap = $('[data-swap]');
    swap.textContent = viaLink ? 'Different link' : multi ? 'Swap an image' : 'Different image';
    swap.setAttribute('data-back', viaLink ? 'link' : 'upload');
    if (!$$('option', zone).some(function (o) { return o.value === rv.timezone; })) {
      var extra = document.createElement('option');
      extra.value = rv.timezone;
      extra.textContent = rv.timezone.split('/').pop().replace(/_/g, ' ');
      zone.appendChild(extra);
    }
    zone.value = rv.timezone;
    zoneHint();
    problem('review', '');
    renderRead(rv, viaLink);
    updateAddress();
    var year = $('[data-year]');
    year.textContent = rv.yearMismatch ? 'The image reads as ' + rv.year + ', not the year you typed. Check your dates against it.' : '';
    year.hidden = !rv.yearMismatch;

    // One day at a time: the image the sets were read from, then those sets
    // by stage. The review's images are in day order — the order they were
    // chosen in, or the order a link's were read as. A row's day is the night
    // it belongs to, so it reads the same as the image above it. The flagged
    // sets — the lines the model was unsure of — show; the rest of a day's
    // wait behind one text button.
    var host = $('#sets'), tpl = $('#set-row'), figTpl = $('#day-figure'), images = chosen();
    var runs = weekendRuns(state.days);
    function weekendOf(night) { for (var w = 0; w < runs.length; w++) if (runs[w].indexOf(night) >= 0) return w + 1; return 0; }
    function flagged(s) { return s.lowConfidence; }
    host.textContent = '';
    rv.images.forEach(function (hash, k) {
      var im = images[k];
      var daySets = rv.sets.filter(function (s) { return s.image === hash; });
      var day = document.createElement('section');
      day.className = 'day-review';
      var nights = daySets.map(function (s) { return nightOf(s.start); }).sort();
      var label = nights.length ? daysLabel(nights[0], nights[nights.length - 1]) : dayLabel(state.days[k] || state.days[0], true);
      var w = runs.length > 1 && nights.length ? weekendOf(nights[0]) : 0;
      if (multi) {
        var head = document.createElement('p');
        head.className = 'eyebrow';
        head.textContent = (w ? 'Weekend ' + w + ' · ' : '') + label;
        day.appendChild(head);
      }
      var fig = figTpl.content.firstElementChild.cloneNode(true);
      if (multi) $('img', fig).alt = 'Your ' + label + ' image';
      if (im) { $('img', fig).src = im.url; $('a', fig).href = im.url; }
      day.appendChild(fig);
      if (!daySets.length) {
        var none = document.createElement('p');
        none.className = 'small';
        none.textContent = 'No times were read off this one.';
        day.appendChild(none);
      } else {
        var toCheck = daySets.filter(flagged).length;
        var count = document.createElement('p');
        count.className = 'small';
        count.textContent = daySets.length + (daySets.length === 1 ? ' set read, ' : ' sets read, ') + (toCheck ? toCheck + ' flagged.' : 'nothing flagged.');
        day.appendChild(count);
      }
      var folded = 0;
      rv.stages.forEach(function (stage) {
        var sets = daySets.filter(function (s) { return s.stage === stage.id; });
        if (!sets.length) return;
        var group = document.createElement('div');
        group.className = 'stage-group';
        group.hidden = !sets.some(flagged);
        var stageHead = document.createElement('p');
        stageHead.className = 'eyebrow';
        stageHead.textContent = stage.name;
        group.appendChild(stageHead);
        var ol = document.createElement('ol');
        ol.className = 'sets';
        sets.forEach(function (s) {
          var li = tpl.content.firstElementChild.cloneNode(true);
          li.setAttribute('data-index', String(s.index));
          $('[data-field="artist"]', li).value = s.artist;
          $('[data-day]', li).textContent = dayLabel(nightOf(s.start));
          $('[data-field="start"]', li).value = s.start.slice(11, 16);
          $('[data-field="end"]', li).value = s.end.slice(11, 16);
          $('[data-printed]', li).textContent = s.printedTime;
          // A guessed end is shown as the calendar will have it, and said to be a guess.
          if (s.endInferred) {
            var guess = $('[data-guess]', li);
            guess.textContent = ' \\u00b7 No end printed \\u00b7 ' + Math.round((Date.parse(s.end + 'Z') - Date.parse(s.start + 'Z')) / 60000) + ' min guess';
            guess.hidden = false;
          }
          if (s.lowConfidence) {
            var why = $('[data-unsure]', li);
            why.textContent = s.unsure;
            why.hidden = !s.unsure;
          } else $('[data-flag="low"]', li).remove();
          if (!flagged(s)) { li.hidden = true; folded += 1; }
          ol.appendChild(li);
        });
        group.appendChild(ol);
        day.appendChild(group);
      });
      if (folded) {
        var more = document.createElement('button');
        more.type = 'button';
        more.className = 'text-btn';
        more.setAttribute('data-show-all', '');
        more.textContent = daySets.length === 1 ? 'Show the set' : 'Show all ' + daySets.length + ' sets';
        more.addEventListener('click', function () {
          $$('.set[hidden], .stage-group[hidden]', day).forEach(function (el) { el.hidden = false; });
          more.remove();
        });
        day.appendChild(more);
      }
      host.appendChild(day);
    });

    var notes = $('details.notes'), list = $('[data-observations]');
    list.textContent = '';
    rv.observations.forEach(function (o) { var li = document.createElement('li'); li.textContent = o; list.appendChild(li); });
    notes.hidden = rv.observations.length === 0;
    notes.open = false;
  }

  // "Looks good" folds the row away; a stage with nothing left showing folds
  // with it. Nothing blocks confirm: the fix for a wrong line is the fields.
  screens.review.addEventListener('click', function (e) {
    var ok = e.target.closest('[data-looks-good]');
    if (!ok) return;
    var li = ok.closest('.set'), group = li.closest('.stage-group');
    li.hidden = true;
    group.hidden = $$('.set', group).every(function (row) { return row.hidden; });
  });

  $('[data-confirm]').addEventListener('click', function () {
    var btn = this, rv = state.review;
    if (!rv) return show(state.via === 'link' ? 'link' : 'upload');
    // After a link, the header is checked first: a name, and a date for every day read.
    var viaLink = state.via === 'link', name = '', days = [];
    if (viaLink) {
      name = nameField.value.trim();
      days = readDays();
      if (!name) return problem('review', COPY.festival);
      if (days.some(function (d, i) { return !weekdayName(d) || days.indexOf(d) !== i; })) return problem('review', COPY.days);
    }
    var edits = [];
    $$('#sets [data-index]').forEach(function (li) {
      var i = Number(li.getAttribute('data-index'));
      var s = rv.sets.filter(function (x) { return x.index === i; })[0];
      var e = { index: i };
      var artist = $('[data-field="artist"]', li).value.trim();
      if (artist && artist !== s.artist) e.artist = artist;
      var st = $('[data-field="start"]', li).value, en = $('[data-field="end"]', li).value;
      var start = st && st !== s.start.slice(11, 16) ? editedStart(s.start, st) : s.start;
      if (start !== s.start) e.start = start;
      // The end follows the start: a moved start can put an unchanged end before it.
      // An unchanged guessed end is not sent: the publisher moves the guess with the start.
      var end = (start !== s.start || (en && en !== s.end.slice(11, 16))) ? editedEnd(start, en || s.end.slice(11, 16)) : s.end;
      if (end !== s.end) e.end = end;
      if (Object.keys(e).length > 1) edits.push(e);
    });
    problem('review', '');
    var was = btn.textContent;
    btn.classList.add('is-loading');
    btn.textContent = 'Saving\\u2026';
    var work = startWork('review', 'Checking the times hold together and saving them. Usually under a minute.', rv.images.length);
    // Every image goes back, and with more than one, the review's own list of
    // them — so what is published is exactly what was checked.
    var body = withOwner(withImages(typed({ timezone: zone.value, timezoneAssumed: state.timezoneAssumed, edits: edits, unverifiable: [], update: updateClaim() })));
    if (rv.images.length > 1) body.reviewed = rv.images;
    // After a link the name is the header's, and the days go too when one was moved.
    if (viaLink) { body.festival = name; if (days.join() !== state.days.join()) body.days = days; }
    // A correction's calendar already answers, so the wait is for it to change:
    // note what it answers with now, before the new times are sent.
    (rv.correcting ? currentTag(rv.editionPath) : Promise.resolve(null)).then(function (before) {
      return post('/api/confirm', body, function (p) {
        if (p.kind === 'confirm') work.say(confirmStatus(p.step));
      }).then(function (r) { return { r: r, before: before }; });
    }).catch(function () {
      return { r: { ok: false, body: { reason: 'Something went wrong on my end. Try again in a minute.' } }, before: null };
    }).then(function (x) {
      var r = x.r;
      work.stop();
      btn.classList.remove('is-loading');
      btn.textContent = was;
      if (!r.ok) return land(r.body, 'review');
      state.published = r.body;
      var update = UPDATE_LINK.replace('{path}', r.body.editionPath).replace('{secret}', r.body.updateSecret);
      $$('[data-update]').forEach(function (el) { el.textContent = update; $('[data-copy]', el.parentNode).setAttribute('data-copy', update); });
      show('publishing');
      waitForBuild(r.body.editionPath, r.body.corrected ? x.before : null).then(showSuccess);
    });
  });

  // ── remove ───────────────────────────────────────────────────────────────
  var removeBtn = $('[data-remove]');
  if (removeBtn) removeBtn.addEventListener('click', function () {
    var btn = this, was = btn.textContent;
    problem('remove', '');
    btn.classList.add('is-loading');
    btn.textContent = 'Taking it down\\u2026';
    post('/api/remove', { update: updateClaim() }).then(function (r) {
      btn.classList.remove('is-loading');
      btn.textContent = was;
      if (!r.ok) { fail('remove', r.body); return; }
      show('removed');
    });
  });

  // The email typed on one first screen is the same person on the other.
  function carryEmail(to) {
    var from = $(to === 'details' ? '#link [name="email"]' : '#details [name="email"]');
    var into = $(to === 'details' ? '#details [name="email"]' : '#link [name="email"]');
    if (from && into && !into.value && from.value) into.value = from.value;
  }
  $$('[data-back]').forEach(function (b) {
    b.addEventListener('click', function () {
      var to = b.getAttribute('data-back');
      if (to === 'details' || to === 'link') carryEmail(to);
      show(to);
    });
  });

  // ── publishing ───────────────────────────────────────────────────────────
  // The page is live when its all-stages calendar answers. Same origin only:
  // on the production site that is the real thing; anywhere else it times out
  // honestly.
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  // A correction is live when that calendar answers with something other than
  // what it answered before, the ETag taken just ahead of confirm.
  function currentTag(editionPath) {
    return fetch('/' + editionPath + '/all.ics', { method: 'HEAD', cache: 'no-store' }).then(function (res) {
      return res.ok ? res.headers.get('etag') : null;
    }, function () { return null; });
  }
  function waitForBuild(editionPath, before) {
    var status = $('[data-publish-status]');
    var url = '/' + editionPath + '/all.ics';
    var started = Date.now(), tries = 0;
    function check() {
      tries += 1;
      return fetch(url, { method: 'HEAD', cache: 'no-store' }).then(function (res) {
        return res.ok && (res.headers.get('content-type') || '').indexOf('text/calendar') === 0 &&
          (!before || res.headers.get('etag') !== before);
      }, function () { return false; }).then(function (live) {
        if (live) { state.live = true; return; }
        var elapsed = Date.now() - started;
        if (elapsed >= BUILD_WAIT_MS) { state.live = false; return; }
        status.textContent = tries < 3 ? 'Checking again every ten seconds.' : 'Still building. ' + Math.round(elapsed / 1000) + ' seconds so far.';
        return sleep(POLL_MS).then(check);
      });
    }
    return check();
  }

  // ── success ──────────────────────────────────────────────────────────────
  function showSuccess() {
    var share = ORIGIN + '/' + state.published.editionPath + '/';
    var el = $('[data-share]');
    el.textContent = share;
    $('[data-copy]', el.parentNode).setAttribute('data-copy', share);
    $('[data-open]').href = share;
    $('[data-live]').hidden = !state.live;
    $('[data-late]').hidden = state.live;
    show('success');
  }

  // Copy buttons, same as the subscribe page.
  document.addEventListener('click', function (e) {
    var copy = e.target.closest('[data-copy]');
    if (!copy) return;
    var value = copy.getAttribute('data-copy');
    if (!value || !navigator.clipboard) return;
    var was = copy.getAttribute('aria-label');
    navigator.clipboard.writeText(value).then(function () {
      copy.classList.add('copied');
      copy.setAttribute('aria-label', 'Link copied');
      setTimeout(function () {
        copy.classList.remove('copied');
        copy.setAttribute('aria-label', was);
      }, 1600);
    }, function () {});
  });
})();
</script>`;

  return f
    ? page(
        `${f.name} ${f.year} — fix a time`,
        `Fix a time on the ${f.name} ${f.year} set times, or take the page down.`,
        body,
        CSS,
      )
    : page(
        'Stage Times — add a festival',
        'Turn a festival’s schedule page, or a screenshot of its set times, into calendars, one per stage, from your phone.',
        body,
        CSS,
      );
}

/** The update link of an edition already taken down: it says so, and offers nothing to change. */
function renderRemovedUpdatePage(edition: UpdateTarget): string {
  const f = edition.festival;
  const body = `<main class="wrap">
  <nav class="topbar">
    <a class="icon-btn" href="/" aria-label="Stage Times home">${ICON_BACK}</a>
  </nav>

  <header>
    <p class="lockup">Stage&nbsp;Times</p>
    <h2>${esc(f.name)} <span style="color:var(--ink-soft)">${f.year}</span></h2>
  </header>

  <section class="screen" data-screen="removed">
    <h3>Taken down</h3>
    <p class="lead">This page was taken down, so there's nothing left to change here.</p>
  </section>

  <footer>
    <p>Unofficial. Not affiliated with ${esc(f.name)}.</p>
  </footer>
</main>`;
  return page(`${f.name} ${f.year} — taken down`, `The ${f.name} ${f.year} set times were taken down.`, body, CSS);
}
