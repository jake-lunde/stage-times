/**
 * Stage Times — YAML schema types, loader, and validator.
 *
 * The YAML in `data/<festival-slug>-<year>.yaml` is the source of truth. This module
 * turns it into typed, validated structures and refuses to hand back anything the
 * build could silently mis-publish. Every failure names the offending entry.
 */

import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { DateTime } from 'luxon';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FestivalMeta {
  name: string;
  slug: string;
  year: number;
  timezone: string;
  official_url: string;
}

export interface Stage {
  id: string;
  name: string;
  description: string;
}

/** A local wall-clock datetime with no offset. Never a UTC instant. */
export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** iCalendar DATE-TIME form in local time: `YYYYMMDDTHHMMSS` (no trailing Z). */
  ical: string;
  /** Original string as written in the YAML. */
  raw: string;
}

export interface SetEntry {
  stage: string;
  artist: string;
  start: WallTime;
  end: WallTime;
  end_inferred: boolean;
  notes: string;
  /** 0-based position in the YAML `sets:` list, for error messages. */
  index: number;
}

export interface FestivalDoc {
  festival: FestivalMeta;
  stages: Stage[];
  sets: SetEntry[];
  /**
   * Has a human checked this transcription against the source images?
   *
   * Ingest is a vision task and a wrong set time in a published feed is the worst
   * failure this project has. Absent or false means "not yet checked" — the build
   * still runs so pages can be previewed, but `--production` refuses to emit.
   * Fail-safe by omission: you have to type `verified: true` to publish.
   */
  verified: boolean;
  /** Path the document was loaded from, or a synthetic label for in-memory docs. */
  sourcePath: string;
}

export class SchemaError extends Error {
  readonly problems: string[];
  constructor(sourcePath: string, problems: string[]) {
    super(
      `Schedule validation failed for ${sourcePath} — ${problems.length} problem` +
        `${problems.length === 1 ? '' : 's'}:\n` +
        problems.map((p) => `  • ${p}`).join('\n'),
    );
    this.name = 'SchemaError';
    this.problems = problems;
  }
}

// ---------------------------------------------------------------------------
// Slug rules (see the URL contract in the brief)
// ---------------------------------------------------------------------------

/** lowercase kebab-case, ASCII only, no leading/trailing/doubled dashes. */
export const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A stage id is a permanent URL slug, so it must not encode anything that changes
 * year to year. Rejected shapes:
 *   - any run of 4+ digits (`main2026`, `stage2026`)  — year-like
 *   - an explicit 19xx/20xx anywhere                  — year-like
 *   - two digit runs separated by a dash (`main-8-14`) — date-like
 */
const YEARLIKE_RE = /\d{4}|(?:19|20)\d{2}/;
const DATELIKE_RE = /\d+-\d+/;

export function stageIdProblem(id: string): string | null {
  if (id.length === 0) return 'is empty';
  // eslint-disable-next-line no-control-regex
  if (!/^[\x00-\x7F]*$/.test(id)) return 'contains non-ASCII characters';
  if (!KEBAB_RE.test(id)) return 'is not lowercase ASCII kebab-case (^[a-z0-9]+(-[a-z0-9]+)*$)';
  if (YEARLIKE_RE.test(id)) return 'contains a year — stage ids are permanent and must not encode a year';
  if (DATELIKE_RE.test(id)) return 'contains a date — stage ids are permanent and must not encode a date';
  return null;
}

// ---------------------------------------------------------------------------
// Artist normalization — FROZEN. Feeds UID derivation.
// ---------------------------------------------------------------------------

/**
 * FROZEN NORMALIZATION. Do not change this function after first publish.
 *
 * The UID of every published event is derived from the output of this function.
 * Changing it — even to "improve" it — changes every UID, which makes every
 * subscriber's calendar drop the old events and re-add new ones (or, worse, keep
 * both). Treat it exactly like UID_DOMAIN: it is an identity namespace, not a
 * text utility.
 *
 * The frozen choice, in order:
 *   1. Unicode NFD decomposition
 *   2. strip combining marks (\p{M}) — "Óskar Þórðarson" -> "Oskar Þorðarson";
 *      note this strips diacritics but does NOT transliterate standalone letters
 *      like þ/ð/ø, which is deliberate: transliteration tables are opinionated and
 *      would be a second thing to freeze.
 *   3. lowercase (locale-independent `toLowerCase`)
 *   4. trim
 *   5. collapse every internal run of Unicode whitespace to a single U+0020
 *
 * Deliberately NOT done: punctuation stripping, `&`->`and`, "The " removal.
 * All of those merge distinct artists.
 */
export function normalizeArtist(artist: string): string {
  return artist
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/gu, ' ');
}

// ---------------------------------------------------------------------------
// Wall time parsing
// ---------------------------------------------------------------------------

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return DAYS_IN_MONTH[month - 1] ?? 31;
}

export function parseWallTime(value: unknown): WallTime | string {
  if (typeof value !== 'string') {
    return `must be a quoted local datetime string like "2026-08-14T19:30:00" (got ${
      value instanceof Date ? 'a YAML timestamp — quote it' : JSON.stringify(value)
    })`;
  }
  const m = WALL_RE.exec(value.trim());
  if (!m) return `is not a local datetime of the form "YYYY-MM-DDTHH:MM:SS" (got ${JSON.stringify(value)})`;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] ?? '0');
  if (month < 1 || month > 12) return `has month ${month} out of range in ${JSON.stringify(value)}`;
  if (day < 1 || day > daysInMonth(year, month)) return `has day ${day} out of range in ${JSON.stringify(value)}`;
  if (hour > 23) return `has hour ${hour} out of range in ${JSON.stringify(value)}`;
  if (minute > 59) return `has minute ${minute} out of range in ${JSON.stringify(value)}`;
  if (second > 59) return `has second ${second} out of range in ${JSON.stringify(value)}`;
  const p2 = (n: number) => String(n).padStart(2, '0');
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    ical: `${year}${p2(month)}${p2(day)}T${p2(hour)}${p2(minute)}${p2(second)}`,
    raw: value,
  };
}

/**
 * Resolve a local wall time in an IANA zone to a UTC instant (epoch ms).
 * Ambiguous times (the repeated hour at a fall-back) resolve to the FIRST
 * occurrence, i.e. the pre-transition offset. Nonexistent times (the skipped
 * hour at a spring-forward) are reported as an error rather than silently shifted.
 */
export function wallToUtc(zone: string, w: WallTime): number | string {
  const dt = DateTime.fromObject(
    { year: w.year, month: w.month, day: w.day, hour: w.hour, minute: w.minute, second: w.second },
    { zone },
  );
  if (!dt.isValid) {
    return `local time ${w.raw} does not exist in ${zone} (${dt.invalidExplanation ?? dt.invalidReason})`;
  }
  // Luxon maps a nonexistent local time forward instead of failing; detect it.
  if (dt.hour !== w.hour || dt.minute !== w.minute || dt.day !== w.day) {
    return `local time ${w.raw} does not exist in ${zone} — it falls in a daylight-saving gap`;
  }
  return dt.toMillis();
}

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function reqString(obj: Record<string, unknown>, key: string, where: string, problems: string[]): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.trim() === '') {
    problems.push(`${where}: \`${key}\` is required and must be a non-empty string (got ${JSON.stringify(v)})`);
    return '';
  }
  return v;
}

function optString(obj: Record<string, unknown>, key: string, where: string, problems: string[]): string {
  const v = obj[key];
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') {
    problems.push(`${where}: \`${key}\` must be a string if present (got ${JSON.stringify(v)})`);
    return '';
  }
  return v;
}

/**
 * Validate a raw parsed-YAML value into a FestivalDoc. Throws SchemaError listing
 * every problem found, so a human fixes the file once rather than N times.
 */
export function validateDoc(raw: unknown, sourcePath: string): FestivalDoc {
  const problems: string[] = [];
  const root = asRecord(raw);
  if (!root) throw new SchemaError(sourcePath, ['top level of the file must be a YAML mapping']);

  // --- festival ------------------------------------------------------------
  const fRaw = asRecord(root['festival']);
  if (!fRaw) problems.push('`festival:` block is missing or is not a mapping');
  const festival: FestivalMeta = {
    name: fRaw ? reqString(fRaw, 'name', 'festival', problems) : '',
    slug: fRaw ? reqString(fRaw, 'slug', 'festival', problems) : '',
    year: 0,
    timezone: fRaw ? reqString(fRaw, 'timezone', 'festival', problems) : '',
    official_url: fRaw ? reqString(fRaw, 'official_url', 'festival', problems) : '',
  };
  if (fRaw) {
    const y = fRaw['year'];
    if (typeof y !== 'number' || !Number.isInteger(y) || y < 1900 || y > 2999) {
      problems.push(`festival: \`year\` must be a four-digit integer (got ${JSON.stringify(y)})`);
    } else {
      festival.year = y;
    }
    if (festival.slug && !KEBAB_RE.test(festival.slug)) {
      problems.push(
        `festival: \`slug\` "${festival.slug}" is not lowercase ASCII kebab-case — it is permanent and appears in every published URL`,
      );
    }
    if (festival.timezone && !isValidTimeZone(festival.timezone)) {
      problems.push(`festival: \`timezone\` "${festival.timezone}" is not a valid IANA time zone id`);
    }
    if (festival.official_url && !/^https?:\/\//.test(festival.official_url)) {
      problems.push(`festival: \`official_url\` "${festival.official_url}" must be an http(s) URL`);
    }
  }

  // --- stages --------------------------------------------------------------
  const stagesRaw = root['stages'];
  const stages: Stage[] = [];
  if (!Array.isArray(stagesRaw) || stagesRaw.length === 0) {
    problems.push('`stages:` must be a non-empty list');
  } else {
    const seen = new Map<string, number>();
    stagesRaw.forEach((sRaw, i) => {
      const where = `stages[${i}]`;
      const s = asRecord(sRaw);
      if (!s) {
        problems.push(`${where}: must be a mapping`);
        return;
      }
      const id = reqString(s, 'id', where, problems);
      const name = reqString(s, 'name', where, problems);
      const description = optString(s, 'description', where, problems);
      if (id) {
        const problem = stageIdProblem(id);
        if (problem) {
          problems.push(
            `${where}: stage id "${id}" ${problem}. Stage ids are permanent URL slugs (/${festival.slug || '<slug>'}-${
              festival.year || '<year>'
            }/${id}.ics) and can never be renamed after publish.`,
          );
        }
        const prev = seen.get(id);
        if (prev !== undefined) {
          problems.push(`${where}: duplicate stage id "${id}" — already declared at stages[${prev}]`);
        } else {
          seen.set(id, i);
        }
      }
      stages.push({ id, name, description });
    });
  }

  // --- sets ----------------------------------------------------------------
  const setsRaw = root['sets'];
  const sets: SetEntry[] = [];
  const declared = new Set(stages.map((s) => s.id).filter(Boolean));
  if (!Array.isArray(setsRaw) || setsRaw.length === 0) {
    problems.push('`sets:` must be a non-empty list');
  } else {
    setsRaw.forEach((eRaw, i) => {
      const where = `sets[${i}]`;
      const e = asRecord(eRaw);
      if (!e) {
        problems.push(`${where}: must be a mapping`);
        return;
      }
      const stage = reqString(e, 'stage', where, problems);
      const artist = reqString(e, 'artist', where, problems);
      const label = `${where} (${artist || '<no artist>'} @ ${stage || '<no stage>'})`;

      // Gate 7, half one: every set references a declared stage id.
      if (stage && !declared.has(stage)) {
        problems.push(
          `${label}: references undeclared stage id "${stage}". Declared stage ids are: ${
            [...declared].map((d) => `"${d}"`).join(', ') || '(none)'
          }`,
        );
      }

      const start = parseWallTime(e['start']);
      const end = parseWallTime(e['end']);
      if (typeof start === 'string') problems.push(`${label}: \`start\` ${start}`);
      if (typeof end === 'string') problems.push(`${label}: \`end\` ${end}`);

      const endInferredRaw = e['end_inferred'];
      let end_inferred = false;
      if (endInferredRaw === undefined || endInferredRaw === null) {
        end_inferred = false;
      } else if (typeof endInferredRaw === 'boolean') {
        end_inferred = endInferredRaw;
      } else {
        problems.push(`${label}: \`end_inferred\` must be true or false (got ${JSON.stringify(endInferredRaw)})`);
      }
      const notes = optString(e, 'notes', label, problems);

      if (typeof start !== 'string' && typeof end !== 'string') {
        // Compare real UTC instants, not wall clocks: a set crossing a fall-back
        // transition can legitimately have an end wall time numerically <= its start.
        let ok = true;
        if (festival.timezone && isValidTimeZone(festival.timezone)) {
          const sUtc = wallToUtc(festival.timezone, start);
          const eUtc = wallToUtc(festival.timezone, end);
          if (typeof sUtc === 'string') {
            problems.push(`${label}: \`start\` ${sUtc}`);
            ok = false;
          }
          if (typeof eUtc === 'string') {
            problems.push(`${label}: \`end\` ${eUtc}`);
            ok = false;
          }
          if (ok && typeof sUtc === 'number' && typeof eUtc === 'number' && eUtc <= sUtc) {
            problems.push(
              `${label}: end ${end.raw} is ${eUtc === sUtc ? 'the same instant as' : 'before'} start ${
                start.raw
              } — a set must end after it starts`,
            );
            ok = false;
          }
        } else if (end.ical <= start.ical) {
          problems.push(`${label}: end ${end.raw} is not after start ${start.raw}`);
          ok = false;
        }
        if (ok) {
          sets.push({ stage, artist, start, end, end_inferred, notes, index: i });
        }
      }
    });
  }

  // Gate 7, half two: every declared stage has at least one set.
  if (stages.length > 0 && sets.length > 0) {
    const used = new Set(sets.map((s) => s.stage));
    for (const stage of stages) {
      if (stage.id && !used.has(stage.id)) {
        problems.push(
          `stages: declared stage "${stage.id}" (${stage.name}) has zero sets. Publishing an empty feed for it would show subscribers a blank calendar — either add its sets or remove the stage.`,
        );
      }
    }
  }

  // UID collision guard. UID = sha1(slug+year+stage+normalizedArtist) by contract,
  // so the same artist twice on the same stage collides. The brief's UID formula
  // has no room for a discriminator, so this must be a human decision.
  {
    const byUidKey = new Map<string, SetEntry[]>();
    for (const s of sets) {
      const key = `${s.stage}\0${normalizeArtist(s.artist)}`;
      const arr = byUidKey.get(key);
      if (arr) arr.push(s);
      else byUidKey.set(key, [s]);
    }
    for (const [, group] of byUidKey) {
      if (group.length > 1) {
        const first = group[0]!;
        problems.push(
          `sets: "${first.artist}" appears ${group.length} times on stage "${first.stage}" (entries ${group
            .map((g) => `sets[${g.index}] ${g.start.raw}`)
            .join(', ')}). UID is sha1(slug+year+stage+normalized-artist) and deliberately excludes the start time, so these would collide into one event. Disambiguate the artist strings (e.g. "Artist (late set)") or move one to another stage id.`,
        );
      }
    }
  }

  // `verified` gates production publishing. Anything other than a literal `true`
  // counts as unverified, including the field being absent entirely.
  const verifiedRaw = root['verified'];
  if (verifiedRaw !== undefined && typeof verifiedRaw !== 'boolean') {
    problems.push(`\`verified\` must be true or false (got ${JSON.stringify(verifiedRaw)})`);
  }
  const verified = verifiedRaw === true;

  if (problems.length > 0) throw new SchemaError(sourcePath, problems);
  return { festival, stages, sets, verified, sourcePath };
}

export function loadFestival(path: string): FestivalDoc {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new SchemaError(path, [`cannot read file: ${(err as Error).message}`]);
  }
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new SchemaError(path, [`YAML parse error: ${(err as Error).message}`]);
  }
  return validateDoc(raw, path);
}

/** Parse YAML text without touching the filesystem — used by tests for mutated fixtures. */
export function loadFestivalFromString(text: string, label: string): FestivalDoc {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new SchemaError(label, [`YAML parse error: ${(err as Error).message}`]);
  }
  return validateDoc(raw, label);
}
