/**
 * Unit tests for the hand-rolled iCalendar serializer.
 *
 * These sit underneath the numbered validation gates: gate 6 lints the finished
 * feed, but if folding is wrong these tests say exactly which primitive broke.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CRLF,
  MAX_LINE_OCTETS,
  UID_DOMAIN,
  PRODID,
  calendarDescription,
  calendarName,
  escapeText,
  findTransitions,
  foldLine,
  formatSetTimeRange,
  generateVTimezone,
  offsetMinutes,
  uidFor,
} from '../src/ics.js';
import { normalizeArtist, parseWallTime, type WallTime } from '../src/schema.js';

const octets = (s: string) => Buffer.byteLength(s, 'utf8');
const wall = (s: string): WallTime => {
  const w = parseWallTime(s);
  assert.equal(typeof w, 'object', `fixture ${s} should parse`);
  return w as WallTime;
};

// ---------------------------------------------------------------------------
// foldLine
// ---------------------------------------------------------------------------

test('foldLine leaves a short line untouched', () => {
  assert.equal(foldLine('SUMMARY:black midi'), 'SUMMARY:black midi');
});

test('foldLine leaves a line of exactly 75 octets untouched', () => {
  const line = 'X:' + 'a'.repeat(73);
  assert.equal(octets(line), 75);
  assert.equal(foldLine(line), line);
});

test('foldLine folds a 76-octet line into two physical lines', () => {
  const line = 'X:' + 'a'.repeat(74);
  assert.equal(octets(line), 76);
  const folded = foldLine(line);
  const parts = folded.split(CRLF);
  assert.equal(parts.length, 2);
  assert.equal(octets(parts[0]!), 75);
  assert.equal(parts[1], ' a');
});

test('foldLine: every physical line is <= 75 octets and continuations start with one space', () => {
  const line = 'DESCRIPTION:' + 'x'.repeat(1000);
  for (const [i, part] of foldLine(line).split(CRLF).entries()) {
    assert.ok(octets(part) <= MAX_LINE_OCTETS, `line ${i} is ${octets(part)} octets`);
    if (i > 0) {
      assert.equal(part[0], ' ');
      assert.notEqual(part[1], ' ', 'continuation must carry exactly one fold space');
    }
  }
});

test('foldLine unfolds losslessly', () => {
  const line = 'DESCRIPTION:' + 'Óskar Þórðarson — a very long line '.repeat(12);
  const unfolded = foldLine(line).replace(/\r\n /g, '');
  assert.equal(unfolded, line);
});

/**
 * The critical case. A split on a raw octet boundary can land inside a UTF-8
 * sequence; if it does, both halves decode to U+FFFD and every calendar client
 * shows a mangled artist name. This constructs a line where octet 76 is a
 * continuation byte, i.e. the naive split is exactly wrong.
 */
test('foldLine never splits a multi-byte UTF-8 sequence (2-byte, boundary forced)', () => {
  // "Ó" is 2 octets (C3 93). 74 ASCII octets then "Ó" puts the split between C3 and 93.
  const line = 'X:' + 'a'.repeat(72) + 'Ó' + 'tail';
  const bytes = Buffer.from(line, 'utf8');
  assert.equal(bytes[74], 0xc3, 'fixture must place a 2-byte lead at octet 74');
  assert.equal(bytes[75]! & 0xc0, 0x80, 'fixture must place a continuation byte at octet 75');

  const folded = foldLine(line);
  assert.ok(!folded.includes('�'), 'folded output must not contain a replacement character');
  const parts = folded.split(CRLF);
  assert.equal(parts[0], 'X:' + 'a'.repeat(72), 'must back off to before the lead byte');
  assert.equal(parts[1], ' Ótail');
  assert.equal(folded.replace(/\r\n /g, ''), line);
});

test('foldLine never splits a multi-byte UTF-8 sequence (4-byte emoji, every offset)', () => {
  // 🎪 is 4 octets (F0 9F 8E AA). Sweep the emoji across the fold boundary so the
  // naive split lands on each of its three continuation bytes in turn.
  for (let pad = 68; pad <= 78; pad++) {
    const line = 'X:' + 'a'.repeat(pad) + '🎪' + 'Þórðarson';
    const folded = foldLine(line);
    assert.ok(!folded.includes('�'), `pad=${pad} produced U+FFFD`);
    assert.equal(folded.replace(/\r\n /g, ''), line, `pad=${pad} did not round-trip`);
    for (const part of folded.split(CRLF)) {
      assert.ok(octets(part) <= MAX_LINE_OCTETS, `pad=${pad}: ${octets(part)} octets`);
    }
    // Byte-level check: no physical line may start or end mid-sequence.
    for (const part of folded.split(CRLF)) {
      const b = Buffer.from(part, 'utf8');
      if (b.length > 0) assert.notEqual(b[0]! & 0xc0, 0x80, `pad=${pad}: line starts on a continuation byte`);
    }
  }
});

test('foldLine handles a line made entirely of 4-octet characters', () => {
  const line = 'X:' + '🎪'.repeat(80);
  const folded = foldLine(line);
  assert.equal(folded.replace(/\r\n /g, ''), line);
  for (const part of folded.split(CRLF)) assert.ok(octets(part) <= MAX_LINE_OCTETS);
});

// ---------------------------------------------------------------------------
// escapeText
// ---------------------------------------------------------------------------

test('escapeText escapes backslash first, then semicolon and comma', () => {
  assert.equal(escapeText('a\\b'), 'a\\\\b');
  assert.equal(escapeText('Two Rivers, One Bridge'), 'Two Rivers\\, One Bridge');
  assert.equal(escapeText('a;b'), 'a\\;b');
  // Backslash-first ordering: the backslash we introduce for the comma must not
  // itself be escaped again.
  assert.equal(escapeText('a\\,b'), 'a\\\\\\,b');
});

test('escapeText turns newlines into literal \\n and leaves colons alone', () => {
  assert.equal(escapeText('one\ntwo'), 'one\\ntwo');
  assert.equal(escapeText('one\r\ntwo'), 'one\\ntwo');
  assert.equal(escapeText('one\rtwo'), 'one\\ntwo');
  assert.equal(escapeText('Official schedule: https://x/y'), 'Official schedule: https://x/y');
});

test('escapeText leaves non-ASCII intact (UTF-8 is legal in TEXT values)', () => {
  assert.equal(escapeText('¡Aparato!'), '¡Aparato!');
  assert.equal(escapeText('Óskar Þórðarson'), 'Óskar Þórðarson');
});

// ---------------------------------------------------------------------------
// UID
// ---------------------------------------------------------------------------

test('UID_DOMAIN is the frozen identity namespace', () => {
  assert.equal(UID_DOMAIN, 'stagetimes.app');
  assert.equal(PRODID, '-//Stage Times//stagetimes.app//EN');
});

test('uidFor is sha1 hex + @ + UID_DOMAIN', () => {
  const uid = uidFor('harbor-lights', 2026, 'main', 'Paper Anchor');
  assert.match(uid, /^[0-9a-f]{40}@stagetimes\.app$/);
});

test('uidFor is stable across calls and independent of start time', () => {
  const a = uidFor('harbor-lights', 2026, 'main', 'Paper Anchor');
  const b = uidFor('harbor-lights', 2026, 'main', 'Paper Anchor');
  assert.equal(a, b);
});

test('uidFor varies with each of its four inputs', () => {
  const base = uidFor('harbor-lights', 2026, 'main', 'Paper Anchor');
  assert.notEqual(base, uidFor('harbor-lights', 2027, 'main', 'Paper Anchor'));
  assert.notEqual(base, uidFor('harbor-lights', 2026, 'grove', 'Paper Anchor'));
  assert.notEqual(base, uidFor('harbour-lights', 2026, 'main', 'Paper Anchor'));
  assert.notEqual(base, uidFor('harbor-lights', 2026, 'main', 'Paper Anchors'));
});

test('normalizeArtist is the frozen normalization: case, whitespace, diacritics', () => {
  assert.equal(normalizeArtist('  SOPHIE  '), 'sophie');
  assert.equal(normalizeArtist('black   midi'), 'black midi');
  assert.equal(normalizeArtist('black\tmidi'), 'black midi');
  assert.equal(normalizeArtist('Óskar'), 'oskar');
  assert.equal(normalizeArtist('Matinée'), 'matinee');
  assert.equal(normalizeArtist('¡Aparato!'), '¡aparato!');
  // Deliberately NOT transliterated — freezing a transliteration table is a second
  // permanent decision we declined to make.
  assert.equal(normalizeArtist('Þórðarson'), 'þorðarson');
  // Punctuation and "&" are preserved: collapsing them would merge distinct acts.
  assert.equal(normalizeArtist('Sable & Sons'), 'sable & sons');
});

test('normalizeArtist makes precomposed and decomposed spellings agree', () => {
  const precomposed = 'Ósk';
  const decomposed = 'Ósk';
  assert.notEqual(precomposed, decomposed);
  assert.equal(normalizeArtist(precomposed), normalizeArtist(decomposed));
  assert.equal(
    uidFor('f', 2026, 's', precomposed),
    uidFor('f', 2026, 's', decomposed),
    'a YAML re-save in a different Unicode normal form must not orphan events',
  );
});

// ---------------------------------------------------------------------------
// Calendar naming
// ---------------------------------------------------------------------------

const meta = {
  name: 'Harbor Lights Festival',
  slug: 'harbor-lights',
  year: 2026,
  timezone: 'America/Chicago',
  official_url: 'https://example.com/x',
};

test('calendarName is "<Stage> — <Festival> <YY>"', () => {
  assert.equal(calendarName(meta, 'Lakefront Main Stage'), 'Lakefront Main Stage — Harbor Lights Festival 26');
  assert.equal(calendarName({ ...meta, year: 2007 }, 'Main'), 'Main — Harbor Lights Festival 07');
});

test('calendarDescription is "<Festival> <Year> set times for <Stage>. stagetimes.app"', () => {
  assert.equal(
    calendarDescription(meta, 'The Grove'),
    'Harbor Lights Festival 2026 set times for The Grove. stagetimes.app',
  );
});

// ---------------------------------------------------------------------------
// Human-readable time range (ICU-independent)
// ---------------------------------------------------------------------------

test('formatSetTimeRange renders a same-day range once', () => {
  assert.equal(
    formatSetTimeRange(wall('2026-08-14T19:30:00'), wall('2026-08-14T20:45:00')),
    'Fri 14 Aug 2026, 7:30 PM – 8:45 PM',
  );
});

test('formatSetTimeRange spells out the date again when a set crosses midnight', () => {
  assert.equal(
    formatSetTimeRange(wall('2026-08-14T22:30:00'), wall('2026-08-15T00:00:00')),
    'Fri 14 Aug 2026, 10:30 PM – Sat 15 Aug 2026, 12:00 AM',
  );
});

test('formatSetTimeRange uses 12 AM for midnight and 12 PM for noon', () => {
  assert.equal(
    formatSetTimeRange(wall('2026-08-15T00:00:00'), wall('2026-08-15T12:00:00')),
    'Sat 15 Aug 2026, 12:00 AM – 12:00 PM',
  );
});

// ---------------------------------------------------------------------------
// Time zone probing
// ---------------------------------------------------------------------------

test('offsetMinutes probes real offsets via Intl', () => {
  assert.equal(offsetMinutes('America/Chicago', Date.UTC(2026, 0, 15, 12)), -360);
  assert.equal(offsetMinutes('America/Chicago', Date.UTC(2026, 6, 15, 12)), -300);
  assert.equal(offsetMinutes('UTC', Date.UTC(2026, 6, 15, 12)), 0);
  assert.equal(offsetMinutes('Asia/Kathmandu', Date.UTC(2026, 6, 15, 12)), 345, 'sub-hour offsets must work');
  assert.equal(offsetMinutes('Australia/Sydney', Date.UTC(2026, 0, 15, 0)), 660);
});

test('findTransitions locates both 2026 US transitions to the second', () => {
  const t = findTransitions('America/Chicago', Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1));
  assert.equal(t.length, 2);
  assert.equal(new Date(t[0]!.at).toISOString(), '2026-03-08T08:00:00.000Z');
  assert.deepEqual([t[0]!.fromMinutes, t[0]!.toMinutes], [-360, -300]);
  assert.equal(new Date(t[1]!.at).toISOString(), '2026-11-01T07:00:00.000Z');
  assert.deepEqual([t[1]!.fromMinutes, t[1]!.toMinutes], [-300, -360]);
});

test('generateVTimezone emits a base observance plus both transitions', () => {
  const lines = generateVTimezone('America/Chicago', 2026, 2026);
  assert.equal(lines[0], 'BEGIN:VTIMEZONE');
  assert.equal(lines[1], 'TZID:America/Chicago');
  assert.equal(lines.at(-1), 'END:VTIMEZONE');
  const body = lines.join('\n');
  assert.equal((body.match(/BEGIN:STANDARD/g) ?? []).length, 2);
  assert.equal((body.match(/BEGIN:DAYLIGHT/g) ?? []).length, 1);
  // DTSTART of an observance is local time in the OUTGOING offset (RFC 5545 3.6.5):
  // 2:00 CST -> CDT in spring, 2:00 CDT -> CST in autumn.
  assert.ok(body.includes('DTSTART:20260308T020000'));
  assert.ok(body.includes('DTSTART:20261101T020000'));
  assert.ok(body.includes('TZOFFSETFROM:-0600\nTZOFFSETTO:-0500'));
  assert.ok(body.includes('TZOFFSETFROM:-0500\nTZOFFSETTO:-0600'));
  assert.ok(body.includes('DTSTART:20260101T000000'), 'a base observance must precede every event');
});

test('generateVTimezone groups repeated yearly transitions with RDATE', () => {
  const body = generateVTimezone('America/Chicago', 2026, 2028).join('\n');
  assert.equal((body.match(/BEGIN:DAYLIGHT/g) ?? []).length, 1, 'same rule should collapse into one observance');
  assert.ok(body.includes('RDATE:20270314T020000'));
  assert.ok(body.includes('RDATE:20280312T020000'));
});

test('generateVTimezone handles a zone with no DST at all', () => {
  const body = generateVTimezone('America/Phoenix', 2026, 2026).join('\n');
  assert.equal((body.match(/BEGIN:STANDARD/g) ?? []).length, 1);
  assert.equal((body.match(/BEGIN:DAYLIGHT/g) ?? []).length, 0);
  assert.ok(body.includes('TZOFFSETTO:-0700'));
});

test('generateVTimezone handles a southern-hemisphere zone (DST in effect on 1 Jan)', () => {
  const body = generateVTimezone('Australia/Sydney', 2026, 2026).join('\n');
  assert.ok(body.includes('BEGIN:DAYLIGHT'));
  assert.ok(body.includes('TZOFFSETTO:+1100'));
  assert.ok(body.includes('TZOFFSETTO:+1000'));
});
