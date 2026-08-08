/**
 * Stage Times — hand-rolled iCalendar (RFC 5545 / RFC 7986) writer.
 *
 * Deliberately not a library. Published feeds are byte-compared in CI and the
 * output is a permanent public contract, so the serializer has to be something we
 * control at the octet level: line folding, escaping order, property order, and
 * the absence of any wall-clock timestamp.
 *
 * INVARIANT: nothing in this module may call Date.now(). Every timestamp that
 * reaches the output comes from committed state (state/sequences.json). A fresh
 * clock read anywhere in here makes the build non-deterministic, which breaks the
 * golden-file test and makes CI diffs meaningless.
 */

import { createHash } from 'node:crypto';
import { DateTime } from 'luxon';
import type { FestivalMeta, SetEntry, Stage, WallTime } from './schema.js';
import { normalizeArtist } from './schema.js';

// ---------------------------------------------------------------------------
// Frozen identity namespace
// ---------------------------------------------------------------------------

export const UID_DOMAIN = 'stagetimes.app'; // FROZEN. Never change, even if the site moves hosts or domains.
// This string is an identity namespace, not a hostname.

export const PRODID = '-//Stage Times//stagetimes.app//EN';
export const REFRESH_INTERVAL = 'PT12H';

export const CRLF = '\r\n';

/** Max octets per output line, excluding the CRLF (RFC 5545 §3.1). */
export const MAX_LINE_OCTETS = 75;

// ---------------------------------------------------------------------------
// Line folding
// ---------------------------------------------------------------------------

/**
 * Fold a single logical content line to at most MAX_LINE_OCTETS octets per
 * physical line, joining with CRLF + a single space.
 *
 * Splits happen on OCTET boundaries (RFC 5545 counts octets, not characters) but
 * never inside a UTF-8 multi-byte sequence: an artist like "Óskar Þórðarson" whose
 * 75th octet lands on a continuation byte would otherwise be cut in half and the
 * feed would contain a replacement character in every client.
 *
 * Continuation lines carry a leading space, which counts toward the 75, so they
 * hold at most 74 octets of content.
 */
export function foldLine(s: string): string {
  const bytes = Buffer.from(s, 'utf8');
  if (bytes.length <= MAX_LINE_OCTETS) return s;

  const chunks: Buffer[] = [];
  let pos = 0;
  let budget = MAX_LINE_OCTETS; // first line: no leading space
  while (pos < bytes.length) {
    let end = Math.min(pos + budget, bytes.length);
    if (end < bytes.length) {
      // 0b10xxxxxx is a UTF-8 continuation byte; back off until the split lands
      // on the start of a character.
      while (end > pos + 1 && (bytes[end]! & 0xc0) === 0x80) end--;
    }
    chunks.push(bytes.subarray(pos, end));
    pos = end;
    budget = MAX_LINE_OCTETS - 1; // continuation lines: one octet spent on the space
  }
  return chunks.map((b, i) => (i === 0 ? '' : ' ') + b.toString('utf8')).join(CRLF);
}

/** Unfold for testing/inspection: undo CRLF + single space. */
export function unfoldLines(text: string): string[] {
  return text.replace(/\r\n[ \t]/g, '').split(CRLF).filter((l) => l.length > 0);
}

// ---------------------------------------------------------------------------
// Text escaping
// ---------------------------------------------------------------------------

/**
 * Escape a TEXT value per RFC 5545 §3.3.11.
 * Order matters and is fixed: backslash FIRST (otherwise the backslashes we
 * introduce for ; and , get escaped a second time), then ; then , then newlines.
 */
export function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n')
    .replace(/[\r\n]/g, '\\n');
}

// ---------------------------------------------------------------------------
// UID
// ---------------------------------------------------------------------------

/**
 * UID = sha1(festivalSlug + year + stageId + normalizedArtist) hex + "@" + UID_DOMAIN.
 *
 * The start time is deliberately NOT an input. Festivals move sets constantly; a
 * time-derived UID makes every reschedule a duplicate event plus an orphaned
 * stale one, which is the single most common failure in published feeds. Same
 * UID + new DTSTART + higher SEQUENCE updates in place for every subscriber.
 *
 * The artist string is passed through the FROZEN normalizeArtist() in schema.ts.
 */
export function uidFor(festivalSlug: string, year: number, stageId: string, artist: string): string {
  const material = `${festivalSlug}${year}${stageId}${normalizeArtist(artist)}`;
  return `${createHash('sha1').update(material, 'utf8').digest('hex')}@${UID_DOMAIN}`;
}

// ---------------------------------------------------------------------------
// Time zone probing and VTIMEZONE generation
// ---------------------------------------------------------------------------

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();
const abbrevFormatters = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(zone: string): Intl.DateTimeFormat {
  let f = offsetFormatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
    offsetFormatters.set(zone, f);
  }
  return f;
}

function abbrevFormatter(zone: string): Intl.DateTimeFormat {
  let f = abbrevFormatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' });
    abbrevFormatters.set(zone, f);
  }
  return f;
}

function tzNamePart(f: Intl.DateTimeFormat, epochMs: number): string {
  for (const p of f.formatToParts(new Date(epochMs))) {
    if (p.type === 'timeZoneName') return p.value;
  }
  throw new Error('Intl.DateTimeFormat did not produce a timeZoneName part');
}

/** UTC offset in minutes for `zone` at `epochMs`, derived by probing Intl. No tzdata bundled. */
export function offsetMinutes(zone: string, epochMs: number): number {
  const raw = tzNamePart(offsetFormatter(zone), epochMs); // "GMT-05:00" | "GMT+05:45" | "GMT"
  if (raw === 'GMT' || raw === 'UTC') return 0;
  const m = /^(?:GMT|UTC)([+-])(\d{2}):?(\d{2})?$/.exec(raw);
  if (!m) throw new Error(`Cannot parse UTC offset "${raw}" for zone ${zone}`);
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? '0'));
}

/** Short abbreviation ("CST", "CDT", or "GMT+05:45" for zones without one). */
function zoneAbbrev(zone: string, epochMs: number): string {
  return tzNamePart(abbrevFormatter(zone), epochMs);
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const h = String(Math.floor(abs / 60)).padStart(2, '0');
  const m = String(abs % 60).padStart(2, '0');
  return `${sign}${h}${m}`;
}

/** Render an epoch instant as an iCalendar local DATE-TIME using a fixed offset. */
function localStampAtOffset(epochMs: number, offsetMin: number): string {
  const d = new Date(epochMs + offsetMin * 60_000);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}` +
    `T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}`
  );
}

export interface Transition {
  /** First epoch-ms instant at which the new offset applies. */
  at: number;
  fromMinutes: number;
  toMinutes: number;
}

/**
 * Find every UTC-offset transition in (startMs, endMs] by probing Intl.
 * Coarse daily scan to bracket a change, then binary search to the second.
 */
export function findTransitions(zone: string, startMs: number, endMs: number): Transition[] {
  const DAY = 86_400_000;
  const out: Transition[] = [];
  let prevProbe = startMs;
  let prevOffset = offsetMinutes(zone, startMs);

  for (let t = startMs + DAY; t <= endMs + DAY; t += DAY) {
    const probeAt = Math.min(t, endMs);
    const off = offsetMinutes(zone, probeAt);
    if (off !== prevOffset) {
      let lo = Math.floor(prevProbe / 1000);
      let hi = Math.floor(probeAt / 1000);
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (offsetMinutes(zone, mid * 1000) === prevOffset) lo = mid;
        else hi = mid;
      }
      const at = hi * 1000;
      out.push({ at, fromMinutes: prevOffset, toMinutes: offsetMinutes(zone, at) });
      prevOffset = off;
    }
    prevProbe = probeAt;
    if (probeAt >= endMs) break;
  }
  return out;
}

interface Observance {
  type: 'STANDARD' | 'DAYLIGHT';
  dtstart: string;
  from: number;
  to: number;
  tzname: string;
  rdates: string[];
}

/**
 * Build a VTIMEZONE for `zone` covering whole calendar years [minYear..maxYear].
 *
 * Offsets are derived entirely by probing Intl.DateTimeFormat with
 * timeZoneName:'longOffset' — no network, no bundled tzdata. Observances are
 * emitted with explicit dates (DTSTART plus RDATE for repeats within the window)
 * rather than an RRULE, because the window is a couple of years and an explicit
 * list cannot drift from the real rule the way a synthesized RRULE can.
 *
 * A base observance is always emitted at Jan 1 of minYear so that every DTSTART
 * in the feed has an observance in effect at or before it.
 *
 * DTSTART of an observance is a local time expressed in the OUTGOING offset
 * (TZOFFSETFROM), per RFC 5545 §3.6.5.
 */
export function generateVTimezone(zone: string, minYear: number, maxYear: number): string[] {
  const windowStart = Date.UTC(minYear, 0, 1, 0, 0, 0);
  const windowEnd = Date.UTC(maxYear + 1, 0, 1, 0, 0, 0);

  const baseOffset = offsetMinutes(zone, windowStart);
  const baseIsDst = DateTime.fromMillis(windowStart, { zone }).isInDST;
  const observances: Observance[] = [
    {
      type: baseIsDst ? 'DAYLIGHT' : 'STANDARD',
      dtstart: `${minYear}0101T000000`,
      from: baseOffset,
      to: baseOffset,
      tzname: zoneAbbrev(zone, windowStart),
      rdates: [],
    },
  ];

  const grouped = new Map<string, Observance>();
  for (const tr of findTransitions(zone, windowStart, windowEnd)) {
    const isDst = DateTime.fromMillis(tr.at, { zone }).isInDST;
    const type: 'STANDARD' | 'DAYLIGHT' = isDst ? 'DAYLIGHT' : 'STANDARD';
    const tzname = zoneAbbrev(zone, tr.at);
    // DTSTART is the wall time of the transition as read on the OLD offset.
    const stamp = localStampAtOffset(tr.at, tr.fromMinutes);
    const key = `${type}|${tr.fromMinutes}|${tr.toMinutes}|${tzname}`;
    const existing = grouped.get(key);
    if (existing) existing.rdates.push(stamp);
    else grouped.set(key, { type, dtstart: stamp, from: tr.fromMinutes, to: tr.toMinutes, tzname, rdates: [] });
  }
  observances.push(...grouped.values());
  observances.sort((a, b) => (a.dtstart < b.dtstart ? -1 : a.dtstart > b.dtstart ? 1 : a.type < b.type ? -1 : 1));

  const lines: string[] = ['BEGIN:VTIMEZONE', `TZID:${zone}`];
  for (const o of observances) {
    lines.push(`BEGIN:${o.type}`);
    lines.push(`DTSTART:${o.dtstart}`);
    lines.push(`TZOFFSETFROM:${formatOffset(o.from)}`);
    lines.push(`TZOFFSETTO:${formatOffset(o.to)}`);
    lines.push(`TZNAME:${escapeText(o.tzname)}`);
    for (const rd of o.rdates.slice().sort()) lines.push(`RDATE:${rd}`);
    lines.push(`END:${o.type}`);
  }
  lines.push('END:VTIMEZONE');
  return lines;
}

// ---------------------------------------------------------------------------
// Human-readable, ICU-independent date formatting (for DESCRIPTION)
// ---------------------------------------------------------------------------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * Formatted by hand rather than with Intl on purpose: Intl output changes between
 * ICU versions, which would silently break the golden-file test on a Node upgrade.
 */
function weekdayOf(w: WallTime): string {
  const idx = new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();
  return WEEKDAYS[idx]!;
}

export function formatDay(w: WallTime): string {
  return `${weekdayOf(w)} ${w.day} ${MONTHS[w.month - 1]!} ${w.year}`;
}

export function formatClock(w: WallTime): string {
  const h24 = w.hour;
  const suffix = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(w.minute).padStart(2, '0')} ${suffix}`;
}

export function formatSetTimeRange(start: WallTime, end: WallTime): string {
  const sameDay = start.year === end.year && start.month === end.month && start.day === end.day;
  if (sameDay) return `${formatDay(start)}, ${formatClock(start)} – ${formatClock(end)}`;
  return `${formatDay(start)}, ${formatClock(start)} – ${formatDay(end)}, ${formatClock(end)}`;
}

// ---------------------------------------------------------------------------
// Event content
// ---------------------------------------------------------------------------

export const END_INFERRED_CAVEAT =
  'End time not printed on the official schedule; inferred from the next set on this stage. Treat it as approximate.';

/** Everything about an event that a subscriber can see. Hashed to drive SEQUENCE. */
export interface EventContent {
  uid: string;
  summary: string;
  location: string;
  description: string;
  dtstart: string;
  dtend: string;
  tzid: string;
}

export function makeEventContent(festival: FestivalMeta, stage: Stage, set: SetEntry): EventContent {
  const descriptionLines = [
    stage.name,
    formatSetTimeRange(set.start, set.end),
    ...(set.end_inferred ? [END_INFERRED_CAVEAT] : []),
    `Official schedule: ${festival.official_url}`,
  ];
  return {
    uid: uidFor(festival.slug, festival.year, stage.id, set.artist),
    summary: set.artist,
    location: stage.name,
    description: descriptionLines.join('\n'),
    dtstart: set.start.ical,
    dtend: set.end.ical,
    tzid: festival.timezone,
  };
}

/**
 * Stable content hash driving SEQUENCE. Covers exactly the subscriber-visible
 * fields; deliberately excludes SEQUENCE, DTSTAMP and LAST-MODIFIED, which are
 * outputs of the hash rather than inputs (including them would make every build
 * increment forever).
 */
export function eventContentHash(c: EventContent): string {
  const material = [c.uid, c.summary, c.location, c.description, c.dtstart, c.dtend, c.tzid].join('\0');
  return createHash('sha1').update(material, 'utf8').digest('hex');
}

export interface RenderedEvent extends EventContent {
  sequence: number;
  /** `YYYYMMDDTHHMMSSZ`, from committed state — never the wall clock. */
  dtstamp: string;
  lastModified: string;
}

// ---------------------------------------------------------------------------
// Calendar rendering
// ---------------------------------------------------------------------------

export interface CalendarSpec {
  festival: FestivalMeta;
  /** Display name of the stage this feed represents, or "All Stages" for all.ics. */
  stageName: string;
  events: RenderedEvent[];
}

/** `<Stage name> — <Festival> <YY>` — stage first, because iOS truncates early. */
export function calendarName(festival: FestivalMeta, stageName: string): string {
  const yy = String(festival.year % 100).padStart(2, '0');
  return `${stageName} — ${festival.name} ${yy}`;
}

/** `<Festival> <Year> set times for <Stage>. stagetimes.app` */
export function calendarDescription(festival: FestivalMeta, stageName: string): string {
  return `${festival.name} ${festival.year} set times for ${stageName}. stagetimes.app`;
}

export function renderCalendar(spec: CalendarSpec): string {
  const { festival, stageName, events } = spec;

  const years = new Set<number>();
  for (const ev of events) {
    years.add(Number(ev.dtstart.slice(0, 4)));
    years.add(Number(ev.dtend.slice(0, 4)));
  }
  if (years.size === 0) years.add(festival.year);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);

  const name = calendarName(festival, stageName);
  const desc = calendarDescription(festival, stageName);

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    // No METHOD:PUBLISH — it makes some clients treat the file as an iTIP
    // invitation import rather than a subscribable calendar.
    `NAME:${escapeText(name)}`,
    `X-WR-CALNAME:${escapeText(name)}`,
    `DESCRIPTION:${escapeText(desc)}`,
    `X-WR-CALDESC:${escapeText(desc)}`,
    `X-WR-TIMEZONE:${festival.timezone}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${REFRESH_INTERVAL}`,
    `X-PUBLISHED-TTL:${REFRESH_INTERVAL}`,
    ...generateVTimezone(festival.timezone, minYear, maxYear),
  ];

  for (const ev of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${ev.uid}`,
      `DTSTAMP:${ev.dtstamp}`,
      `DTSTART;TZID=${ev.tzid}:${ev.dtstart}`,
      `DTEND;TZID=${ev.tzid}:${ev.dtend}`,
      `SUMMARY:${escapeText(ev.summary)}`,
      `LOCATION:${escapeText(ev.location)}`,
      `DESCRIPTION:${escapeText(ev.description)}`,
      'STATUS:CONFIRMED',
      // A set shouldn't mark the subscriber busy.
      'TRANSP:TRANSPARENT',
      `SEQUENCE:${ev.sequence}`,
      `LAST-MODIFIED:${ev.lastModified}`,
      'END:VEVENT',
      // No VALARM, ever. Default alerts on a subscribed calendar are hostile.
    );
  }

  lines.push('END:VCALENDAR');

  // Trailing CRLF after END:VCALENDAR is required — the last line is a content
  // line like any other and must be terminated.
  return lines.map(foldLine).join(CRLF) + CRLF;
}
