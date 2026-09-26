/**
 * Stage Times — the almanac: what is on record about the big festivals
 * (`config/festivals.yaml`).
 *
 * Committed configuration: each festival's schedule page, the zone its times
 * are printed in, the form its source takes, and its editions' days — and for
 * a past edition the day its set times dropped. One reader: the publisher
 * reads the zone, so a link to a festival on record is read in that
 * festival's own zone rather than the default (src/publisher.ts). The rest is
 * kept as a record for whoever adds next year's edition by hand.
 *
 * Nothing here reads a file: the loader takes the YAML text and the callers
 * own the I/O. Nothing here is guessed either — the almanac is what somebody
 * checked and wrote down.
 */

import { parse as parseYaml } from 'yaml';
import { isValidTimeZone } from './schema.js';
import { slugify } from './transcribe.js';

/** `YYYY-MM-DD`. The publisher's own, repeated here so this module stays below it. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Where a festival's set times appear. */
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
  /** Permanent URL slug, derived from the name when omitted. */
  slug: string;
  /** The schedule page, or the lineup page until one exists. */
  source: string;
  timezone: string;
  form: SourceForm;
  /** Kept as a record; nothing reads it now. */
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
  if (!/^https?:\/\/\S+$/.test(source)) fail('source is required: the schedule page, as an http(s) link');

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
// The zone on record
// ---------------------------------------------------------------------------

/** What a reading offers to match a festival on record by: the schedule link, and the name as printed. */
export interface FestivalClues {
  /** The official schedule's address — the link that was read, or the one printed on the poster. */
  url?: string | null;
  /** The festival's name, as printed or as typed. */
  name?: string | null;
}

/**
 * The zone a festival's times are printed in, from the record of it — a
 * festival is always in the same place, so the poster need not say. Matched
 * by the schedule page's host first (`www.` aside), then by the name: the
 * printed name slugifies to the festival's slug or starts with it
 * (`AUSTIN CITY LIMITS MUSIC FESTIVAL 25 YEARS` → `austin-city-limits-…`),
 * or contains the festival's name. Null when nothing on record matches;
 * never a guess.
 */
export function zoneOnRecord(almanac: Almanac, clues: FestivalClues): string | null {
  const host = hostOf(clues.url);
  if (host) {
    const byHost = almanac.find((f) => hostOf(f.source) === host);
    if (byHost) return byHost.timezone;
  }
  const name = (clues.name ?? '').trim();
  if (!name) return null;
  const slug = slugify(name);
  const lower = name.toLowerCase();
  const byName = almanac.find(
    (f) => slug === f.slug || slug.startsWith(f.slug + '-') || lower.includes(f.festival.toLowerCase()),
  );
  return byName ? byName.timezone : null;
}

/** `aclfestival.com` for `https://www.aclfestival.com/schedule`; null for anything that is not a link. */
function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}
