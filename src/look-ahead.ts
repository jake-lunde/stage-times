/**
 * Stage Times — the look-ahead.
 *
 * Once a month, one issue in the owner's GitHub inbox: every edition in the
 * almanac (`config/festivals.yaml`) whose first day falls in the next ninety
 * days, with its dates, when its drop is expected going by the previous
 * edition's lead, the form its source takes, and whether the watch list
 * already has it. An edition nobody watches carries a checkbox and the exact
 * entry to paste into `config/watch.yaml`, so a watcher is added before the
 * drop and not after.
 *
 * The same seam as the watcher and the signal: an intent — the almanac and the
 * watch list — plus the publisher's notify and clock ports go in, and the one
 * notification it would send comes out. Nothing in here reads a file or looks
 * at a clock; `src/monthly.ts` is the scheduled entrypoint.
 *
 * The almanac is committed configuration, like the watch list: what is on
 * record about each festival — its editions' days, and for a past edition the
 * day its set times dropped. The look-ahead never guesses a date. An edition
 * with no earlier drop on record says so, and a festival whose next edition's
 * days are not on record yet is listed as such, so the almanac gets fixed.
 */

import { parse as parseYaml } from 'yaml';
import { ISO_DATE_RE, type ClockPort, type Notification, type NotifyPort } from './publisher.js';
import { isValidTimeZone } from './schema.js';
import { slugify } from './transcribe.js';
import { keyOf, type WatchList } from './watcher.js';

// ---------------------------------------------------------------------------
// The almanac
// ---------------------------------------------------------------------------

/**
 * Where a festival's set times appear. Only `poster` is something the watcher
 * reads; the rest reach the owner through the signal or an upload.
 */
export const SOURCE_FORMS = {
  poster: 'Images on the site',
  web: 'Text on the site',
  app: 'App only',
  social: 'Social posts only',
  unknown: 'Not known yet',
} as const;

export type SourceForm = keyof typeof SOURCE_FORMS;

/** One edition on record. */
export interface AlmanacEdition {
  year: number;
  dates: { first: string; last: string };
  /** The day its set times were first posted, once that has happened and been checked. */
  dropped?: string;
}

/** One festival, as committed configuration (`config/festivals.yaml`). */
export interface AlmanacFestival {
  festival: string;
  /** Permanent URL slug, derived from the name when omitted — the watch entry's slug. */
  slug: string;
  /** The page to watch: the schedule page, or the lineup page until one exists. */
  source: string;
  timezone: string;
  form: SourceForm;
  /** Carried into the watch entry as it is. */
  match?: string;
  subreddit?: string;
  /** Oldest first. */
  editions: AlmanacEdition[];
}

export type Almanac = AlmanacFestival[];

export class AlmanacError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlmanacError';
  }
}

/** The almanac from its YAML text, validated; a problem names the festival and the field. */
export function loadAlmanac(text: string): Almanac {
  const raw: unknown = parseYaml(text);
  if (!Array.isArray(raw)) throw new AlmanacError('the almanac must be a list of festivals');
  const seen = new Set<string>();
  return raw.map((item, i) => {
    const festival = almanacFestival(item, i + 1);
    if (seen.has(festival.slug)) throw new AlmanacError(`festival ${i + 1} (${festival.festival}): ${festival.slug} is in the almanac twice`);
    seen.add(festival.slug);
    return festival;
  });
}

function almanacFestival(item: unknown, n: number): AlmanacFestival {
  const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
  const name = typeof obj['festival'] === 'string' ? obj['festival'].trim() : '';
  const fail = (what: string): never => {
    throw new AlmanacError(`festival ${n}${name ? ` (${name})` : ''}: ${what}`);
  };
  if (!name || slugify(name) === '') fail('festival is required');

  const slug = obj['slug'] === undefined ? slugify(name) : String(obj['slug']);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) fail(`slug must be lowercase words joined by hyphens, not ${JSON.stringify(slug)}`);

  const source = typeof obj['source'] === 'string' ? obj['source'].trim() : '';
  if (!/^https?:\/\/\S+$/.test(source)) fail('source is required: the page to watch, as an http(s) link');

  const timezone = typeof obj['timezone'] === 'string' ? obj['timezone'] : '';
  if (!timezone || !isValidTimeZone(timezone)) fail(`timezone is required, as an IANA zone${timezone ? ` (${timezone} is not one)` : ''}`);

  const form = obj['form'];
  if (typeof form !== 'string' || !(form in SOURCE_FORMS)) fail(`form is required, one of ${Object.keys(SOURCE_FORMS).join(', ')}`);

  if (!Array.isArray(obj['editions']) || obj['editions'].length === 0) fail('editions is required: at least one year');
  const editions = (obj['editions'] as unknown[]).map((e) => almanacEdition(e, fail));
  editions.sort((a, b) => a.year - b.year);
  editions.forEach((e, i) => {
    if (i > 0 && editions[i - 1]!.year === e.year) fail(`${e.year} is on record twice`);
  });

  const festival: AlmanacFestival = { festival: name, slug, source, timezone, form: form as SourceForm, editions };
  if (obj['match'] !== undefined) festival.match = String(obj['match']);
  if (obj['subreddit'] !== undefined) festival.subreddit = String(obj['subreddit']).trim().replace(/^\/?r\//i, '');
  return festival;
}

function almanacEdition(item: unknown, fail: (what: string) => never): AlmanacEdition {
  const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
  const year = obj['year'];
  if (typeof year !== 'number' || !Number.isInteger(year) || year < 2000 || year > 2100) fail('every edition needs a year, as a four-digit number');
  const dates = obj['dates'] as Record<string, unknown> | undefined;
  const first = isoDate(dates?.['first']);
  const last = isoDate(dates?.['last']);
  if (!first || !last || last < first) fail(`${year}: dates is required: first and last day, YYYY-MM-DD, first no later than last`);
  if (!first!.startsWith(String(year))) fail(`${year}: the first day is not in ${year}`);
  const edition: AlmanacEdition = { year: year as number, dates: { first: first!, last: last! } };
  if (obj['dropped'] !== undefined) {
    const dropped = isoDate(obj['dropped']);
    if (!dropped || dropped > first!) fail(`${year}: dropped must be a day, YYYY-MM-DD, no later than the first day`);
    edition.dropped = dropped!;
  }
  return edition;
}

function isoDate(value: unknown): string | null {
  const s = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '');
  return ISO_DATE_RE.test(s) ? s : null;
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
/** How far ahead the look-ahead reads, counting the day it runs. */
export const LOOK_AHEAD_DAYS = 90;
/** The longest drop lead on record (CONTEXT: drop). A watch window with no earlier drop to go by opens this far out. */
export const LONGEST_LEAD_DAYS = 77;
/** A watch window opens this long before the expected drop, because drops come early as often as late. */
export const WINDOW_MARGIN_DAYS = 7;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function dayOf(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  return isoOf(dayOf(iso) + n * DAY_MS);
}

function daysBetween(from: string, to: string): number {
  return Math.round((dayOf(to) - dayOf(from)) / DAY_MS);
}

/** `9 Oct`, or `9 Oct 2026` with the year. */
function shortDay(iso: string, withYear = false): string {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]!.slice(0, 3)}${withYear ? ` ${y}` : ''}`;
}

/** `9–11 Oct`, `31 Oct – 2 Nov`, `9 Oct` for one day. */
function dayRange(first: string, last: string): string {
  if (first === last) return shortDay(first);
  if (first.slice(0, 7) === last.slice(0, 7)) return `${Number(first.slice(8))}–${shortDay(last)}`;
  return `${shortDay(first)} – ${shortDay(last)}`;
}

/** `8 weeks`, or `4 days` under a fortnight. */
function leadText(days: number): string {
  return days >= 14 ? `${Math.round(days / 7)} weeks` : `${days} day${days === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// Intent and result
// ---------------------------------------------------------------------------

export interface LookAheadIntent {
  kind: 'look-ahead';
  almanac: Almanac;
  list: WatchList;
}

export interface LookAheadPorts {
  notify: NotifyPort;
  clock: ClockPort;
}

/** The previous edition's lead, when a drop is on record for it. */
export interface ExpectedDrop {
  /** The earlier edition the lead is taken from. */
  from: number;
  /** Days between that edition's drop and its first day. */
  leadDays: number;
  /** This edition's first day less that lead. */
  on: string;
}

export interface LookAheadRow {
  /** The edition's key, `<slug>-<year>` — its watch-list key and its path at the root. */
  key: string;
  festival: string;
  year: number;
  /** Null when the festival's next edition is not in the almanac yet. */
  dates: { first: string; last: string } | null;
  /** Null when no earlier drop is on record. */
  expected: ExpectedDrop | null;
  form: SourceForm;
  watched: boolean;
  /** The entry to paste into `config/watch.yaml`, for an unwatched edition with days on record. */
  edit: string | null;
}

export interface LookAheadResult {
  /** The run's day and the window's last day, inclusive. */
  window: { from: string; to: string };
  rows: LookAheadRow[];
  /** The issue it sent. */
  notification: Notification;
}

// ---------------------------------------------------------------------------
// lookAhead
// ---------------------------------------------------------------------------

/**
 * One run: the rows for the next ninety days, and the one issue that carries
 * them. The issue is sent even when there are no rows — a month with nothing
 * coming is worth knowing, and the almanac may be what is missing.
 */
export async function lookAhead(intent: LookAheadIntent, ports: LookAheadPorts): Promise<LookAheadResult> {
  const from = isoOf(ports.clock.now());
  const to = addDays(from, LOOK_AHEAD_DAYS - 1);
  const rows = rowsFor(intent, from, to);
  const month = `${MONTHS[Number(from.slice(5, 7)) - 1]} ${from.slice(0, 4)}`;
  const notification: Notification = {
    kind: 'look-ahead',
    title: `Look-ahead for ${month}: ${shortDay(from)} to ${shortDay(to, true)}`,
    body: issueBody(rows, from, to),
  };
  await ports.notify.send(notification);
  return { window: { from, to }, rows, notification };
}

/** Every edition whose first day falls from `from` through `to`, earliest first, then by name. */
export function rowsFor(intent: Pick<LookAheadIntent, 'almanac' | 'list'>, from: string, to: string): LookAheadRow[] {
  const watched = new Set(intent.list.map((e) => keyOf(e)));
  const rows: LookAheadRow[] = [];
  for (const festival of intent.almanac) {
    const inWindow = festival.editions.filter((e) => e.dates.first >= from && e.dates.first <= to);
    for (const edition of inWindow) {
      const key = keyOf({ slug: festival.slug, year: edition.year });
      const expected = expectedDrop(festival, edition);
      const isWatched = watched.has(key);
      rows.push({
        key,
        festival: festival.festival,
        year: edition.year,
        dates: edition.dates,
        expected,
        form: festival.form,
        watched: isWatched,
        edit: isWatched ? null : watchEdit(festival, edition, expected, from),
      });
    }
    // The next edition falls in the window going by last year's days, and its own are not on record.
    const latest = festival.editions[festival.editions.length - 1]!;
    const anniversary = `${latest.year + 1}${latest.dates.first.slice(4)}`;
    if (inWindow.length === 0 && anniversary >= from && anniversary <= to) {
      const key = keyOf({ slug: festival.slug, year: latest.year + 1 });
      rows.push({ key, festival: festival.festival, year: latest.year + 1, dates: null, expected: null, form: festival.form, watched: watched.has(key), edit: null });
    }
  }
  const firstOf = (r: LookAheadRow): string => r.dates?.first ?? '9999';
  return rows.sort((a, b) => firstOf(a).localeCompare(firstOf(b)) || a.festival.localeCompare(b.festival) || a.key.localeCompare(b.key));
}

/** The lead of the latest earlier edition with a drop on record, applied to this one. */
export function expectedDrop(festival: AlmanacFestival, edition: AlmanacEdition): ExpectedDrop | null {
  const previous = festival.editions.filter((e) => e.year < edition.year && e.dropped).pop();
  if (!previous) return null;
  const leadDays = daysBetween(previous.dropped!, previous.dates.first);
  return { from: previous.year, leadDays, on: addDays(edition.dates.first, -leadDays) };
}

/**
 * The watch entry for an edition, exactly as `config/watch.yaml` writes one.
 * Its drop window opens a week before the expected drop, or the longest lead
 * on record before the first day when there is nothing to go by, and never
 * before today.
 */
export function watchEdit(festival: AlmanacFestival, edition: AlmanacEdition, expected: ExpectedDrop | null, today: string): string {
  const opens = expected ? addDays(expected.on, -WINDOW_MARGIN_DAYS) : addDays(edition.dates.first, -LONGEST_LEAD_DAYS);
  const lines = [`- festival: ${yamlText(festival.festival)}`];
  if (slugify(festival.festival) !== festival.slug) lines.push(`  slug: ${festival.slug}`);
  lines.push(
    `  year: ${edition.year}`,
    `  source: ${festival.source}`,
    `  timezone: ${festival.timezone}`,
    `  dates: { first: ${edition.dates.first}, last: ${edition.dates.last} }`,
    `  window: { from: ${opens > today ? opens : today} }`,
  );
  if (festival.match !== undefined) lines.push(`  match: ${yamlText(festival.match)}`);
  if (festival.subreddit !== undefined) lines.push(`  subreddit: ${festival.subreddit}`);
  return lines.join('\n');
}

/** A plain scalar when YAML would read it back unchanged, else double-quoted. */
function yamlText(s: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9 .'&()-]*$/.test(s) && !/ $/.test(s) ? s : JSON.stringify(s);
}

// ---------------------------------------------------------------------------
// The issue
// ---------------------------------------------------------------------------

function expectedText(row: LookAheadRow): string {
  if (!row.dates) return 'Unknown';
  if (!row.expected) return 'No earlier drop on record';
  return `Around ${shortDay(row.expected.on)} (${leadText(row.expected.leadDays)} ahead, as in ${row.expected.from})`;
}

/** What the owner should know before adding a watcher, by source form. */
const FORM_NOTES: Record<SourceForm, string> = {
  poster: '',
  web: 'Text on the site: the watcher reads images only, so add a subreddit for the signal too.',
  app: 'App only: the watcher reads images only, so add a subreddit for the signal too.',
  social: 'Social posts only: the watcher reads images only, so add a subreddit for the signal too.',
  unknown: 'Where the times will appear is not known yet; the watcher reads any image the page shows.',
};

function issueBody(rows: LookAheadRow[], from: string, to: string): string {
  const out = [`Every edition starting ${shortDay(from, true)} to ${shortDay(to, true)}, from \`config/festivals.yaml\`.`, ''];
  if (rows.length === 0) {
    out.push('Nothing on record in this window. If something is missing, add it to the almanac.');
    return out.join('\n');
  }
  out.push('| Edition | Dates | Drop expected | Source | Watched |', '|---|---|---|---|---|');
  for (const r of rows) {
    const dates = r.dates ? dayRange(r.dates.first, r.dates.last) : 'Not on record';
    out.push(`| ${r.festival} ${r.year} | ${dates} | ${expectedText(r)} | ${SOURCE_FORMS[r.form]} | ${r.watched ? 'Yes' : 'No'} |`);
  }

  const toAdd = rows.filter((r) => r.edit);
  if (toAdd.length > 0) {
    out.push('', '## Not watched', '', 'Tick one to add it, then append its entry to `config/watch.yaml`.', '');
    for (const r of toAdd) {
      const note = FORM_NOTES[r.form] ? ` ${FORM_NOTES[r.form]}` : '';
      out.push(`- [ ] **${r.festival} ${r.year}**, ${dayRange(r.dates!.first, r.dates!.last)}.${note}`, '', '  ```yaml', ...r.edit!.split('\n').map((l) => `  ${l}`), '  ```', '');
    }
    while (out[out.length - 1] === '') out.pop();
  }

  const missing = rows.filter((r) => !r.dates);
  if (missing.length > 0) {
    out.push('', '## Days not on record', '');
    for (const r of missing) out.push(`- [ ] ${r.festival} ${r.year}: add its days to \`config/festivals.yaml\`.`);
  }
  return out.join('\n');
}
