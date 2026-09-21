/**
 * Stage Times — the watcher.
 *
 * The automation that notices a drop, or a change after a drop, on a
 * festival's official schedule page and produces a transcription for the owner
 * to verify (CONTEXT: watcher). It is the publisher seam from the other side:
 * an intent — the watch list — plus the publisher's ports and one more, for
 * pages, go in, and the commit, the review pull requests and the notifications
 * it would make come out. Nothing in here reads a file, opens a socket, calls
 * a model or looks at a clock; `src/watch.ts` is the scheduled entrypoint and
 * `src/ports.ts` the outside world.
 *
 * What one poll of one entry does:
 *
 *   1. fetch the schedule page and list every image it shows
 *   2. hash each image; an image seen before is already decided
 *   3. a new image goes through the free gates (type, size, dimensions)
 *      and then, and only then, the cheap "is this a schedule" check —
 *      once, ever, per distinct image
 *   4. the schedule images, as a set, against the set recorded last time:
 *      the same set is nothing; a first set is a drop; a different set
 *      is a change
 *   5. a drop or a change is transcribed (each image once, ever — the
 *      publisher's store), diffed against what is live, and opened as a
 *      review pull request whose merge publishes and lists it through the
 *      owner path
 *
 * The cadence follows each entry's drop window: hourly inside it, daily
 * before it, and never after the festival's last day. The job itself runs
 * hourly; `isDue()` is what makes that a cadence.
 *
 * Three rules, inherited from the publisher and kept here:
 *
 *   1. **Nothing costs money before it has earned it.** A distinct image is
 *      screened at most once and transcribed at most once, and never
 *      screened at all when a free gate can refuse it.
 *   2. **Verification stays human.** Nothing here publishes. The pull
 *      request carries the edition exactly as the owner's own confirm would
 *      commit it; merging it is the check.
 *   3. **An unchanged page writes nothing.** Committed state moves only when
 *      an image is new, so an hourly poll of a quiet page is free and leaves
 *      no trace.
 */

import { parse as parseYaml } from 'yaml';
import { editionPath, type PublishedEdition, type PublishedFile } from './build.js';
import {
  changeLine,
  checkImage,
  committedJson,
  diffSets,
  icalStamp,
  ISO_DATE_RE,
  listed,
  modelOutputs,
  OWNER_DATA_DIR,
  PUBLISHED_PATH,
  readingProblem,
  sha256,
  sortKeys,
  SOURCE_DIR,
  SOURCE_IMAGE_DIR,
  storedImageName,
  TRANSCRIPTION_STORE_DIR,
  type Commit,
  type FileWrite,
  type Notification,
  type PublisherPorts,
  type PullRequest,
  type SavedTranscription,
  type SetChange,
  type SourceImage,
} from './publisher.js';
import { isValidTimeZone, loadFestivalFromString } from './schema.js';
import { PUBLISHER_REPO } from './secrets.js';
import { slugify } from './transcribe.js';
import { transcribe, type Transcription } from './transcription.js';

// ---------------------------------------------------------------------------
// The watch list
// ---------------------------------------------------------------------------

/** One watched edition, as committed configuration (`config/watch.yaml`). */
export interface WatchEntry {
  /** Display name. Becomes the edition's name. */
  festival: string;
  /** Permanent URL slug. Derived from the name when omitted. */
  slug: string;
  year: number;
  /** The official schedule page — where the images will appear. */
  source: string;
  /** IANA zone the times are printed in. The page cannot carry this. */
  timezone: string;
  /** The festival's days, ISO. Polling stops after the last. */
  dates: { first: string; last: string };
  /** The drop window: hourly polls from `from` through `to` (default: the last day). */
  window: { from: string; to: string };
  /** A regular expression on the image URL; only matching images are read. */
  match?: string;
  /** The festival's subreddit, without `r/`. Only the signal reads it (`src/signal.ts`). */
  subreddit?: string;
}

export type WatchList = WatchEntry[];

export type Cadence = 'hourly' | 'daily' | 'dormant';

/** The edition an entry watches: `<slug>-<year>`, its key in committed state and its path at the root. */
export function keyOf(entry: Pick<WatchEntry, 'slug' | 'year'>): string {
  return `${entry.slug}-${entry.year}`;
}

/** The one hourly run a day that also polls the daily entries: 15:00 UTC, morning in the US. */
export const DAILY_POLL_HOUR_UTC = 15;

/** The UTC calendar date `now` falls on. */
function dateOf(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * How often an entry is polled right now. Hourly inside its drop window,
 * daily before it (and between the window's end and the last day, if the
 * owner set the window short), dormant once the festival is over.
 */
export function cadenceOf(entry: WatchEntry, now: number): Cadence {
  const today = dateOf(now);
  if (today > entry.dates.last) return 'dormant';
  if (today >= entry.window.from && today <= entry.window.to) return 'hourly';
  return 'daily';
}

/** Is this entry polled on this run? The job runs hourly; this is the cadence. */
export function isDue(entry: WatchEntry, now: number): boolean {
  const cadence = cadenceOf(entry, now);
  if (cadence === 'hourly') return true;
  if (cadence === 'daily') return new Date(now).getUTCHours() === DAILY_POLL_HOUR_UTC;
  return false;
}

export class WatchListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WatchListError';
  }
}

/**
 * The watch list from its YAML text, validated. Everything the machine cannot
 * know about a festival is required — the zone, the year, the days, where the
 * schedule will appear — and a problem names the entry and the field.
 */
export function loadWatchList(text: string): WatchList {
  const raw: unknown = parseYaml(text);
  if (!Array.isArray(raw)) throw new WatchListError('the watch list must be a list of entries');
  const list: WatchList = [];
  const seen = new Set<string>();
  raw.forEach((item, i) => {
    const entry = watchEntry(item, i + 1);
    const key = keyOf(entry);
    if (seen.has(key)) throw new WatchListError(`entry ${i + 1} (${entry.festival}): ${key} is watched twice`);
    seen.add(key);
    list.push(entry);
  });
  return list;
}

function watchEntry(item: unknown, n: number): WatchEntry {
  const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
  const festival = typeof obj['festival'] === 'string' ? obj['festival'].trim() : '';
  const where = `entry ${n}${festival ? ` (${festival})` : ''}`;
  const fail = (what: string): never => {
    throw new WatchListError(`${where}: ${what}`);
  };
  if (!festival || slugify(festival) === '') fail('festival is required');

  const slug = obj['slug'] === undefined ? slugify(festival) : String(obj['slug']);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) fail(`slug must be lowercase words joined by hyphens, not ${JSON.stringify(slug)}`);

  const year = obj['year'];
  if (typeof year !== 'number' || !Number.isInteger(year) || year < 2000 || year > 2100) fail('year is required, as a four-digit number');

  const source = typeof obj['source'] === 'string' ? obj['source'].trim() : '';
  if (!/^https?:\/\/\S+$/.test(source)) fail('source is required: the schedule page, as an http(s) link');

  const timezone = typeof obj['timezone'] === 'string' ? obj['timezone'] : '';
  if (!timezone || !isValidTimeZone(timezone)) fail(`timezone is required, as an IANA zone${timezone ? ` (${timezone} is not one)` : ''}`);

  const dates = obj['dates'] as Record<string, unknown> | undefined;
  const first = isoDate(dates?.['first']);
  const last = isoDate(dates?.['last']);
  if (!dates || !first || !last || last < first) fail('dates is required: first and last day, YYYY-MM-DD, first no later than last');

  const window = obj['window'] as Record<string, unknown> | undefined;
  const from = isoDate(window?.['from']);
  const to = window?.['to'] === undefined ? last : isoDate(window['to']);
  if (!window || !from || !to || to < from) fail('window is required: from (YYYY-MM-DD), and to no earlier than from');

  const entry: WatchEntry = { festival, slug, year: year as number, source, timezone, dates: { first: first!, last: last! }, window: { from: from!, to: to! } };
  if (obj['match'] !== undefined) {
    const match = String(obj['match']);
    try {
      new RegExp(match);
    } catch {
      fail(`match must be a regular expression, and ${JSON.stringify(match)} is not one`);
    }
    entry.match = match;
  }
  if (obj['subreddit'] !== undefined) {
    const subreddit = String(obj['subreddit']).trim().replace(/^\/?r\//i, '');
    if (!SUBREDDIT_RE.test(subreddit)) fail(`subreddit must be a subreddit's name, as in r/<name>, not ${JSON.stringify(obj['subreddit'])}`);
    entry.subreddit = subreddit;
  }
  return entry;
}

/** What Reddit allows in a subreddit's name: 2 to 21 letters, digits and underscores, not starting with an underscore. */
const SUBREDDIT_RE = /^[A-Za-z0-9][A-Za-z0-9_]{1,20}$/;

function isoDate(value: unknown): string | null {
  const s = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '');
  return ISO_DATE_RE.test(s) ? s : null;
}

// ---------------------------------------------------------------------------
// Reading a schedule page
// ---------------------------------------------------------------------------

const IMAGE_HREF_RE = /\.(jpe?g|png|webp|gif)([?#]|$)/i;

/** One attribute's value off a tag's text, whichever way it was quoted. */
function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  if (!m) return undefined;
  return (m[1] ?? m[2] ?? m[3] ?? '').replace(/&amp;/g, '&').trim();
}

/** The candidate a `srcset` names largest — by width, or by density. */
function largestOf(srcset: string): string | undefined {
  let best: { url: string; size: number } | undefined;
  for (const candidate of srcset.split(',')) {
    const [url, descriptor] = candidate.trim().split(/\s+/);
    if (!url) continue;
    const size = descriptor ? parseFloat(descriptor) || 0 : 0;
    if (!best || size > best.size) best = { url, size };
  }
  return best?.url;
}

/**
 * Every image a page shows, as absolute URLs in page order, each once: the
 * share image, CSS backgrounds, `img` and `source` (the largest `srcset`
 * candidate first, then `src`, then a lazy `data-src`), and links straight to
 * an image file. Inline `data:` images are not images anyone posted.
 */
export function imageUrlsIn(html: string, base: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string | undefined) => {
    if (!candidate || candidate.startsWith('data:')) return;
    let url: URL;
    try {
      url = new URL(candidate, base);
    } catch {
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    url.hash = '';
    if (seen.has(url.href)) return;
    seen.add(url.href);
    out.push(url.href);
  };

  const token = /<meta\b[^>]*>|<img\b[^>]*>|<source\b[^>]*>|<a\b[^>]*>|url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s"')]+))\s*\)/gi;
  for (const m of html.matchAll(token)) {
    const tag = m[0];
    if (tag.startsWith('<meta')) {
      const property = attr(tag, 'property') ?? attr(tag, 'name');
      if (property?.toLowerCase() === 'og:image') add(attr(tag, 'content'));
    } else if (tag.startsWith('<img') || tag.startsWith('<source')) {
      const srcset = attr(tag, 'srcset') ?? attr(tag, 'data-srcset');
      if (srcset) add(largestOf(srcset));
      add(attr(tag, 'src'));
      add(attr(tag, 'data-src'));
    } else if (tag.startsWith('<a')) {
      const href = attr(tag, 'href');
      if (href && IMAGE_HREF_RE.test(href.split(/[?#]/)[0] ?? href)) add(href);
    } else {
      add((m[1] ?? m[2] ?? m[3] ?? '').replace(/&amp;/g, '&'));
    }
  }
  return out;
}

export interface ImageHeader {
  width: number;
  height: number;
  contentType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
}

/**
 * What the first bytes of an image say it is and how big it is — enough for
 * the publisher's free gates without decoding a pixel. Null for anything that
 * is not one of the four formats a browser would have uploaded.
 */
export function imageDimensions(bytes: Uint8Array): ImageHeader | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number, n: number) => String.fromCharCode(...bytes.subarray(at, at + n));

  if (bytes.length >= 24 && ascii(1, 3) === 'PNG' && bytes[0] === 0x89 && ascii(12, 4) === 'IHDR') {
    return { width: view.getUint32(16), height: view.getUint32(20), contentType: 'image/png' };
  }
  if (bytes.length >= 10 && ascii(0, 4) === 'GIF8') {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true), contentType: 'image/gif' };
  }
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8X') {
      const w = bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16);
      const h = bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16);
      return { width: w + 1, height: h + 1, contentType: 'image/webp' };
    }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const b = view.getUint32(21, true);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1, contentType: 'image/webp' };
    }
    if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff, contentType: 'image/webp' };
    }
    return null;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1]!;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        at += 2;
        continue;
      }
      const length = view.getUint16(at + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: view.getUint16(at + 5), width: view.getUint16(at + 7), contentType: 'image/jpeg' };
      if (marker === 0xda || marker === 0xd9) return null;
      at += 2 + length;
    }
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** A fetched image, as the page served it. */
export interface FetchedImage {
  bytes: Uint8Array;
  /** The `Content-Type` the server sent, if any. The bytes have the last word. */
  contentType?: string;
}

/** The outside world the watcher reads: pages and the images on them. */
export interface PagePort {
  /** The page's HTML, or null when it did not answer with a page. */
  page(url: string): Promise<string | null>;
  /** The image's bytes, or null when it did not answer with one. */
  image(url: string): Promise<FetchedImage | null>;
}

export interface WatcherPorts extends PublisherPorts {
  pages: PagePort;
}

// ---------------------------------------------------------------------------
// Committed state the watcher owns
// ---------------------------------------------------------------------------

export const WATCH_STATE_PATH = 'state/watch.json';

/** One image the watcher has seen on a schedule page, decided once. */
export interface WatchedImage {
  /** Where it was first found. */
  url: string;
  /** Whether the cheap check said it is a schedule with times on it. */
  schedule: boolean;
  /** When it was first seen, as a UTC iCalendar stamp. */
  seenAt: string;
  /** Why it was never asked about, when a free gate refused it. */
  why?: string;
}

export interface WatchedEdition {
  /** Every image ever seen on the page, by content hash. */
  images: Record<string, WatchedImage>;
  /** The schedule images as of the last drop or change, in page order. What the next poll is measured against. */
  schedule: string[];
  /** When `schedule` last moved. */
  at?: string;
}

export interface WatchState {
  $comment?: string | string[];
  entries: Record<string, WatchedEdition>;
}

const WATCH_COMMENT = [
  'COMMITTED STATE — what the watcher has seen on each watched schedule page (config/watch.yaml).',
  'Per edition: every image by content hash with the one-time verdict of the cheap "is this a',
  'schedule" check, and the schedule images as of the last drop or change. A poll that finds nothing',
  'new writes nothing. Nothing in the build reads this file.',
];

// ---------------------------------------------------------------------------
// Intent and result
// ---------------------------------------------------------------------------

export interface WatchIntent {
  kind: 'watch';
  list: WatchList;
  /** Poll every entry that is not dormant, whatever the cadence says. */
  force?: boolean;
}

export type WatchOutcome =
  /** The festival is over. */
  | 'dormant'
  /** A daily entry on an hourly run. */
  | 'not-due'
  /** The page did not answer. Nothing recorded; the next run tries again. */
  | 'unreachable'
  /** The same schedule images as last time, or none yet. */
  | 'nothing'
  /** The first schedule images. */
  | 'drop'
  /** Different schedule images from last time. */
  | 'change'
  /** The images could not be read into an edition; the owner was told. */
  | 'failed';

export interface WatchReport {
  key: string;
  festival: string;
  cadence: Cadence;
  outcome: WatchOutcome;
  /** The schedule images the page shows, by content hash, in page order. */
  images: string[];
  /** The review opened, if one was. */
  pullRequest: PullRequest | null;
  /** What moved against the baseline — what is live, or the earlier reading. */
  changes: SetChange[];
  /** One sentence when something stopped a review. */
  problem: string | null;
}

export interface WatchResult {
  reports: WatchReport[];
  /** The one commit to main: new replies and the watcher's state. Null when nothing was new. */
  commit: Commit | null;
  pullRequests: PullRequest[];
  notifications: Notification[];
}

/** An image found on the page, gated, hashed and — for a schedule — ready to read. */
interface Found {
  hash: string;
  url: string;
  image: SourceImage;
}

/** A review decided but not yet opened: its branch needs the state commit to exist first. */
interface Draft {
  report: WatchReport;
  pullRequest: PullRequest;
}

// ---------------------------------------------------------------------------
// watch
// ---------------------------------------------------------------------------

/**
 * One run over the watch list. Every due entry is polled; every drop or change
 * is read and offered as a review. The new replies and the watcher's state go
 * to main in one commit, and each review branches off it.
 */
export async function watch(intent: WatchIntent, ports: WatcherPorts): Promise<WatchResult> {
  const now = ports.clock.now();
  const stamp = icalStamp(now);
  const state = await readState(ports);
  const files: FileWrite[] = [];
  const reports: WatchReport[] = [];
  const notifications: Notification[] = [];
  const drafts: Draft[] = [];
  let stateMoved = false;

  for (const entry of intent.list) {
    const key = keyOf(entry);
    const cadence = cadenceOf(entry, now);
    const report: WatchReport = { key, festival: entry.festival, cadence, outcome: 'nothing', images: [], pullRequest: null, changes: [], problem: null };
    reports.push(report);

    if (cadence === 'dormant' || (!intent.force && !isDue(entry, now))) {
      report.outcome = cadence === 'dormant' ? 'dormant' : 'not-due';
      continue;
    }

    const edition = state.entries[key] ?? { images: {}, schedule: [] };
    const polled = await poll(entry, ports, edition, stamp);
    if (!polled) {
      report.outcome = 'unreachable';
      continue;
    }
    if (polled.recorded) {
      state.entries[key] = edition;
      stateMoved = true;
    }

    const found = polled.found;
    report.images = found.map((f) => f.hash);
    if (found.length === 0 || sameSet(edition.schedule, report.images)) continue;

    report.outcome = edition.schedule.length === 0 ? 'drop' : 'change';
    const previous = edition.schedule;
    edition.schedule = report.images;
    edition.at = stamp;
    state.entries[key] = edition;
    stateMoved = true;

    const review = await read(entry, ports, found, previous, stamp);
    files.push(...review.files);
    report.changes = review.changes;
    report.problem = review.problem;
    if (review.notification) notifications.push(review.notification);
    if (review.pullRequest) drafts.push({ report, pullRequest: review.pullRequest });
    if (review.failed) report.outcome = 'failed';
  }

  let commit: Commit | null = null;
  if (stateMoved || files.length > 0) {
    commit = {
      message: commitMessage(reports),
      files: [...files, { path: WATCH_STATE_PATH, contents: committedJson({ $comment: state.$comment ?? WATCH_COMMENT, entries: sortKeys(state.entries) }) }],
      images: [],
    };
  }
  const from = commit ? await ports.repo.commit(commit) : null;

  const pullRequests: PullRequest[] = [];
  for (const draft of drafts) {
    const pr: PullRequest = { ...draft.pullRequest, from: from! };
    try {
      await ports.repo.openPullRequest(pr);
      pullRequests.push(pr);
      draft.report.pullRequest = pr;
    } catch (err) {
      draft.report.problem = `The review could not be opened (${(err as Error).message}).`;
      notifications.push({
        kind: 'watch-failed',
        editionPath: draft.report.key,
        title: `Review could not be opened: ${pr.title}`,
        body: `${draft.report.problem} What it would have said:\n\n${pr.body}`,
      });
    }
  }
  for (const n of notifications) await ports.notify.send(n);

  return { reports, commit, pullRequests, notifications };
}

async function readState(ports: WatcherPorts): Promise<WatchState> {
  const text = await ports.repo.readFile(WATCH_STATE_PATH);
  if (text === null) return { entries: {} };
  const parsed = JSON.parse(text) as Partial<WatchState>;
  return { ...(parsed.$comment ? { $comment: parsed.$comment } : {}), entries: parsed.entries ?? {} };
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sorted = [...b].sort();
  return [...a].sort().every((h, i) => h === sorted[i]);
}

/** One line per entry that did something, for the state commit. */
function commitMessage(reports: WatchReport[]): string {
  const said = reports
    .filter((r) => r.outcome === 'drop' || r.outcome === 'change' || r.outcome === 'failed')
    .map((r) => `${r.festival} ${r.key.slice(-4)}: ${r.outcome}`);
  return `Watch: ${said.length ? said.join('; ') : 'new images seen, no schedule among them'}`;
}

// ---------------------------------------------------------------------------
// The poll: the page, its images, the cheap check — once per image, ever
// ---------------------------------------------------------------------------

/**
 * Fetch the page, hash every image on it, and decide each new one: the free
 * gates first, then the cheap check. Returns the schedule images in page
 * order, or null when the page did not answer. `recorded` says whether a
 * verdict was added — the only reason a quiet poll would write anything.
 */
async function poll(
  entry: WatchEntry,
  ports: WatcherPorts,
  edition: WatchedEdition,
  stamp: string,
): Promise<{ found: Found[]; recorded: boolean } | null> {
  const html = await ports.pages.page(entry.source);
  if (html === null) return null;

  const filter = entry.match ? new RegExp(entry.match) : null;
  const urls = imageUrlsIn(html, entry.source).filter((u) => !filter || filter.test(u));
  const found: Found[] = [];
  const seenNow = new Set<string>();
  let recorded = false;

  for (const url of urls) {
    const fetched = await ports.pages.image(url);
    if (!fetched) continue;
    const hash = sha256(fetched.bytes);
    if (seenNow.has(hash)) continue;
    seenNow.add(hash);

    const header = imageDimensions(fetched.bytes);
    const image: SourceImage = {
      filename: filenameOf(url),
      contentType: header?.contentType ?? fetched.contentType ?? 'application/octet-stream',
      bytes: fetched.bytes,
      width: header?.width ?? 0,
      height: header?.height ?? 0,
    };

    let verdict = edition.images[hash];
    if (!verdict) {
      const refused = header ? checkImage(image) : { reason: 'Not an image format a browser would upload.' };
      if (refused) {
        verdict = { url, schedule: false, seenAt: stamp, why: refused.reason };
      } else {
        const check = await ports.vision.looksLikeSchedule(image);
        verdict = { url, schedule: check.isSchedule, seenAt: stamp, ...(check.isSchedule || !check.saw ? {} : { why: `The check saw ${check.saw}.` }) };
      }
      edition.images[hash] = verdict;
      recorded = true;
    }
    if (verdict.schedule) found.push({ hash, url, image });
  }
  return { found, recorded };
}

/** The last path segment of an image's URL, for the log. Never a path. */
function filenameOf(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '');
    return last || 'image';
  } catch {
    return 'image';
  }
}

// ---------------------------------------------------------------------------
// The read: transcribe, diff against what is live, draft the review
// ---------------------------------------------------------------------------

interface Reading {
  /** New replies to store on main. */
  files: FileWrite[];
  pullRequest: PullRequest | null;
  changes: SetChange[];
  problem: string | null;
  notification: Notification | null;
  failed: boolean;
}

/**
 * Read the schedule images into an edition and draft the review. Each image
 * is transcribed once, ever — the publisher's store is consulted first and
 * written to after — and the edition goes through the same library, with the
 * same schema, as an upload. What the owner is offered depends on what is
 * live: a change to a published edition is a per-set diff; anything else is
 * the whole schedule, with what moved since the earlier reading when there
 * was one.
 */
async function read(entry: WatchEntry, ports: WatcherPorts, found: Found[], previous: string[], stamp: string): Promise<Reading> {
  const key = keyOf(entry);
  const name = `${entry.festival} ${entry.year}`;
  const files: FileWrite[] = [];
  const nothing = (problem: string | null, extra: Partial<Reading> = {}): Reading => ({ files, pullRequest: null, changes: [], problem, notification: null, failed: false, ...extra });
  const failed = (problem: string, detail: string[] = []): Reading =>
    nothing(problem, {
      failed: true,
      notification: {
        kind: 'watch-failed',
        editionPath: key,
        title: `Watcher: ${name} could not be read`,
        body: [problem, ...(detail.length ? ['', ...detail.map((d) => `- ${d}`)] : []), '', `The schedule page: ${entry.source}`, 'Images:', ...found.map((f) => `- ${f.url}`), '', 'Nothing was opened. Upload the images through your bookmark, or fix the watch entry.'].join('\n'),
      },
    });

  const saved: SavedTranscription[] = [];
  for (const f of found) {
    let reading = await ports.repo.readTranscription(f.hash);
    if (!reading) {
      const output = await ports.vision.transcribe(f.image);
      reading = { image: f.hash, filename: f.image.filename, contentType: f.image.contentType, output, transcribedAt: stamp };
      files.push({ path: `${TRANSCRIPTION_STORE_DIR}/${reading.image}.json`, contents: committedJson(reading) });
    }
    saved.push(reading);
  }

  const options = { namespace: 'owner' as const, name: entry.festival, slug: entry.slug, timezone: entry.timezone, timezoneAssumed: false, officialUrl: entry.source, verified: true };
  let transcription: Transcription;
  try {
    transcription = transcribe(modelOutputs(saved), options);
  } catch (err) {
    const problem = readingProblem(err);
    return failed(problem.reason, problem.problems ?? []);
  }
  const doc = transcription.edition;
  if (doc.festival.year !== entry.year) {
    return failed(`The images read as ${doc.festival.year}, and this entry watches ${entry.year}.`);
  }

  const published = await ports.repo.readPublished();
  const path = editionPath('owner', key);
  const live = published.editions[path];
  if (live?.blocked) return nothing(`${name} is blocked; nothing was opened.`);

  const branch = `watch/${key}/${sha256(found.map((f) => f.hash).join(',')).slice(0, 12)}`;
  const images = saved.map((reading, i) => ({ path: `${SOURCE_IMAGE_DIR}/${storedImageName(reading)}`, contentType: reading.contentType, bytes: found[i]!.image.bytes }));
  const editionFiles = (record: PublishedEdition, next: PublishedFile): FileWrite[] => [
    { path: `${OWNER_DATA_DIR}/${key}.yaml`, contents: transcription.yaml },
    { path: `${SOURCE_DIR}/${key}/TRANSCRIPTION.md`, contents: transcription.log },
    { path: PUBLISHED_PATH, contents: committedJson({ ...next, editions: sortKeys({ ...next.editions, [path]: record }) }) },
  ];

  if (live) {
    const previousYaml = await ports.repo.readFile(`${OWNER_DATA_DIR}/${key}.yaml`);
    const before = previousYaml === null ? null : loadFestivalFromString(previousYaml, `${OWNER_DATA_DIR}/${key}.yaml`);
    const kept = new Set(doc.stages.map((s) => s.id));
    const dropped = live.stages.filter((id) => !kept.has(id));
    if (dropped.length > 0) {
      const names = dropped.map((id) => before?.stages.find((s) => s.id === id)?.name ?? id);
      return failed(`${listed(names)} ${names.length === 1 ? 'is' : 'are'} not in the new images, and people have already added ${names.length === 1 ? 'it' : 'them'}. A published stage cannot disappear.`);
    }
    const changes = before ? diffSets(before, doc) : [];
    if (changes.length === 0) return nothing('The new images read the same as what is live; nothing to review.');
    const record: PublishedEdition = { ...live, stages: [...new Set([...live.stages, ...kept])].sort() };
    return {
      files,
      changes,
      problem: null,
      notification: null,
      failed: false,
      pullRequest: {
        from: '',
        branch,
        title: `${name}: ${whatMoved(changes)}`,
        body: changeBody(entry, key, found, changes, branch),
        commit: { message: `Correct ${name} (${key}) from the watched schedule page`, files: editionFiles(record, { ...published, publishedAt: stamp }), images },
      },
    };
  }

  // Not live. What moved since the earlier reading, if there was one and it
  // still reads; an earlier reading that is gone or will not read is no
  // baseline, and the review is offered as the first one was.
  let changes: SetChange[] = [];
  if (previous.length > 0) {
    const earlier = await Promise.all(previous.map((h) => ports.repo.readTranscription(h)));
    if (earlier.every((r) => r !== null)) {
      try {
        changes = diffSets(transcribe(modelOutputs(earlier as SavedTranscription[]), options).edition, doc);
        if (changes.length === 0) return nothing('The new images read the same as the earlier ones; the earlier review stands.');
      } catch {
        changes = [];
      }
    }
  }
  const record: PublishedEdition = { slug: doc.festival.slug, year: doc.festival.year, namespace: 'owner', listed: true, blocked: false, stages: doc.stages.map((s) => s.id).sort() };
  return {
    files,
    changes,
    problem: null,
    notification: null,
    failed: false,
    pullRequest: {
      from: '',
      branch,
      title: changes.length > 0 ? `${name}: ${whatMoved(changes)}` : `Set times dropped: ${name}`,
      body: reviewBody(entry, key, found, transcription, changes, branch),
      commit: { message: `Publish and list ${name} (${key}) from the watched schedule page`, files: editionFiles(record, { ...published, publishedAt: stamp }), images },
    },
  };
}

// ---------------------------------------------------------------------------
// What the owner reads
// ---------------------------------------------------------------------------

/** `A moved`, `A and B moved, C added`, `A, B and 2 more moved`. */
export function whatMoved(changes: SetChange[]): string {
  const by = { changed: 'moved', added: 'added', removed: 'dropped' } as const;
  const parts: string[] = [];
  for (const kind of ['changed', 'added', 'removed'] as const) {
    const names = [...new Set(changes.filter((c) => c.kind === kind).map((c) => (c.after ?? c.before)!.artist))];
    if (names.length === 0) continue;
    const shown = names.length > 3 ? [...names.slice(0, 2), `${names.length - 2} more`] : names;
    parts.push(`${listed(shown)} ${by[kind]}`);
  }
  return parts.join(', ');
}

const RAW = `https://raw.githubusercontent.com/${PUBLISHER_REPO}`;
const BLOB = `https://github.com/${PUBLISHER_REPO}/blob`;

function imagesSection(found: Found[], branch: string): string[] {
  return [
    '## Images',
    ...found.flatMap((f, i) => [
      `Day ${i + 1} — ${f.image.filename}, from ${f.url}`,
      '',
      `![${f.image.filename}](${RAW}/${branch}/${SOURCE_IMAGE_DIR}/${storedImageName({ image: f.hash, contentType: f.image.contentType })})`,
      '',
    ]),
  ];
}

function logLine(key: string, branch: string): string {
  return `The log with every judgement: [${SOURCE_DIR}/${key}/TRANSCRIPTION.md](${BLOB}/${branch}/${SOURCE_DIR}/${key}/TRANSCRIPTION.md)`;
}

/** `2026-10-09T15:15:00` → `3:15 PM`. */
function clock(raw: string): string {
  const h = Number(raw.slice(11, 13));
  const m = raw.slice(14, 16);
  return `${((h + 11) % 12) + 1}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/** `2026-10-09` → `Friday, Oct 9`. */
function dayHeading(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getUTCDay()]}, ${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** The whole schedule, for a review of an edition that is not live yet. */
function reviewBody(entry: WatchEntry, key: string, found: Found[], transcription: Transcription, since: SetChange[], branch: string): string {
  const doc = transcription.edition;
  const name = `${entry.festival} ${entry.year}`;
  const size = `${doc.sets.length} set${doc.sets.length === 1 ? '' : 's'} across ${doc.stages.length} stage${doc.stages.length === 1 ? '' : 's'}`;
  const lines: string[] = [
    since.length > 0
      ? `The schedule page for ${name} changed again before the earlier review was merged. This replaces it.`
      : `${name} posted set times on ${entry.source}.`,
    '',
    `${size}, read off ${listed(found.map((f) => f.image.filename))}. Nobody has checked them yet.`,
    '',
    `Merging says every set below matches the image. It publishes and lists https://stagetimes.app/${key}/ — the same commit your own confirm would make. To decline, close this.`,
    '',
  ];
  if (since.length > 0) {
    lines.push('## Since the earlier reading', ...since.map(changeLine), '');
  }
  for (const stage of doc.stages) {
    lines.push(`## ${stage.name}`);
    const sets = transcription.sets.filter((s) => s.stage === stage.id);
    let day = '';
    for (const set of sets) {
      if (set.posterDate !== day) {
        day = set.posterDate;
        lines.push(`### ${dayHeading(day)}`);
      }
      const flags = [
        ...(set.end_inferred ? ['end is a guess'] : []),
        ...(transcription.observations.some((o) => set.artist.trim().length >= 3 && o.toLowerCase().includes(set.artist.toLowerCase())) ? ['look here'] : []),
      ];
      lines.push(`- ${clock(set.start)}–${clock(set.end)} ${set.artist}${flags.length ? ` *(${flags.join(', ')})*` : ''}`);
    }
    lines.push('');
  }
  if (transcription.observations.length > 0) {
    lines.push("## The model's notes", ...transcription.observations.map((o) => `- ${o}`), '');
  }
  lines.push(...imagesSection(found, branch), logLine(key, branch), '');
  return lines.join('\n');
}

/** The per-set diff, for a change to an edition that is live. */
function changeBody(entry: WatchEntry, key: string, found: Found[], changes: SetChange[], branch: string): string {
  const name = `${entry.festival} ${entry.year}`;
  const n = changes.length;
  return [
    `The schedule page for ${name} changed: ${n} set${n === 1 ? '' : 's'} against what is live at https://stagetimes.app/${key}/.`,
    '',
    ...changes.map(changeLine),
    '',
    `Merging publishes the new times; anyone who added a stage gets them at their next refresh, and only the events that moved advance. To decline, close this.`,
    '',
    ...imagesSection(found, branch),
    logLine(key, branch),
    '',
  ].join('\n');
}
