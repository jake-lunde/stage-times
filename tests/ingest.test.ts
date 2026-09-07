/**
 * Deterministic ingest pipeline (src/transcribe.ts).
 *
 * Everything here runs without an API key: the vision step returns raw printed
 * strings, and every rule that turns those into a festival document is
 * deterministic code under test — time resolution, CLOSE → +60min, post-
 * midnight date shifting, AFTERS handling, stage ids, YAML round-tripping
 * through src/schema.ts, and the duplicate-UID hard fail.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertRawTranscription,
  buildIngest,
  normalizeOfficialUrl,
  parseTimeRange,
  resolveRange,
  slugify,
  stageIdFromName,
  titleCase,
  TranscribeError,
  type RawTranscription,
} from '../src/transcribe.js';
import { SchemaError } from '../src/schema.js';

// ---------------------------------------------------------------------------
// Time parsing
// ---------------------------------------------------------------------------

test('parseTimeRange: ordinary range with meridiem on the end only', () => {
  const r = parseTimeRange('3:15-3:45PM');
  assert.deepEqual(r.start, { hour: 3, minute: 15, meridiem: null });
  assert.deepEqual(r.end, { hour: 3, minute: 45, meridiem: 'PM' });
});

test('parseTimeRange: CLOSE is not a time', () => {
  const r = parseTimeRange('10:40-CLOSE');
  assert.deepEqual(r.start, { hour: 10, minute: 40, meridiem: null });
  assert.equal(r.end, null);
});

test('parseTimeRange: tolerates spaces, en-dashes and lowercase meridiem', () => {
  const r = parseTimeRange('11:30 am – 12:15 pm');
  assert.deepEqual(r.start, { hour: 11, minute: 30, meridiem: 'AM' });
  assert.deepEqual(r.end, { hour: 12, minute: 15, meridiem: 'PM' });
});

test('parseTimeRange: rejects garbage and out-of-range clock readings', () => {
  assert.throws(() => parseTimeRange('afternoon-ish'), TranscribeError);
  assert.throws(() => parseTimeRange('13:00-14:00PM'), TranscribeError);
  assert.throws(() => parseTimeRange('3:75-4:00PM'), TranscribeError);
});

// ---------------------------------------------------------------------------
// Meridiem resolution
// ---------------------------------------------------------------------------

test('resolveRange: unmarked start inherits the evening reading from a PM end', () => {
  assert.deepEqual(resolveRange(parseTimeRange('3:15-3:45PM'), null), { startMin: 915, endMin: 945 });
});

test('resolveRange: 11:30-12:15AM resolves to late evening into after-midnight', () => {
  // 23:30 → 00:15; the caller shifts the end to the next date.
  assert.deepEqual(resolveRange(parseTimeRange('11:30-12:15AM'), null), { startMin: 1410, endMin: 15 });
});

test('resolveRange: fully unmarked range prefers the evening on a duration tie', () => {
  assert.deepEqual(resolveRange(parseTimeRange('3:15-3:45'), null), { startMin: 915, endMin: 945 });
});

test('resolveRange: CLOSE start defaults to the evening reading', () => {
  assert.deepEqual(resolveRange(parseTimeRange('10:40-CLOSE'), null), { startMin: 22 * 60 + 40, endMin: null });
});

test('resolveRange: CLOSE start uses running order to disambiguate', () => {
  // Previous set started 22:15; "11:30-CLOSE" must be 23:30, not 11:30.
  assert.deepEqual(resolveRange(parseTimeRange('11:30-CLOSE'), 22 * 60 + 15), { startMin: 23 * 60 + 30, endMin: null });
  // A hypothetical morning festival: previous set started 09:00 → 11:30 is AM.
  assert.deepEqual(resolveRange(parseTimeRange('11:30-CLOSE'), 9 * 60), { startMin: 11 * 60 + 30, endMin: null });
});

// ---------------------------------------------------------------------------
// Stage identity and casing helpers
// ---------------------------------------------------------------------------

test('stageIdFromName: strips the STAGE suffix and kebab-cases', () => {
  assert.equal(stageIdFromName('MAIN STAGE'), 'main');
  assert.equal(stageIdFromName('DAYDREAM STAGE'), 'daydream');
  assert.equal(stageIdFromName("VERA'S BACKYARD"), 'vera-s-backyard');
});

test('stageIdFromName: hard-fails on year-like ids (permanent URL slugs)', () => {
  assert.throws(() => stageIdFromName('MAIN 2026 STAGE'), TranscribeError);
});

test('titleCase and slugify', () => {
  assert.equal(titleCase('CAPITOL HILL BLOCK PARTY'), 'Capitol Hill Block Party');
  assert.equal(slugify('Capitol Hill Block Party'), 'capitol-hill-block-party');
});

test('normalizeOfficialUrl: poster footer domains become lowercase https URLs', () => {
  assert.equal(normalizeOfficialUrl('CAPITOLHILLBLOCKPARTY.COM'), 'https://capitolhillblockparty.com');
  assert.equal(normalizeOfficialUrl('https://www.example.com/'), 'https://www.example.com/');
  assert.throws(() => normalizeOfficialUrl('  '), /official URL/);
});

// ---------------------------------------------------------------------------
// assertRawTranscription
// ---------------------------------------------------------------------------

test('assertRawTranscription: rejects malformed model output with named problems', () => {
  assert.throws(() => assertRawTranscription({ days: [] }, 'x'), TranscribeError);
  assert.throws(
    () =>
      assertRawTranscription(
        { festival_name: 'F', days: [{ date: 'August 7', header: 'H', stages: [{ name: 'S', sets: [{ artist: 'A', time: '1:00-2:00PM' }] }] }] },
        'x',
      ),
    /date must be YYYY-MM-DD/,
  );
});

// ---------------------------------------------------------------------------
// buildIngest — the full deterministic transform
// ---------------------------------------------------------------------------

function fixture(): RawTranscription {
  return {
    festival_name: 'HARBOR LIGHTS',
    official_url: 'HARBORLIGHTS.EXAMPLE',
    days: [
      {
        date: '2026-08-07',
        header: 'FRIDAY AUGUST 7, 2026',
        stages: [
          {
            name: 'MAIN STAGE',
            sets: [
              { artist: 'AVERY COCHRANE', time: '3:15-3:45PM' },
              { artist: 'MAGDALENA BAY', time: '9:00-10:00PM' },
              { artist: 'MUNA', time: '10:40-CLOSE' },
            ],
          },
          {
            name: 'CELLAR STAGE',
            sets: [
              { artist: 'DARK CHISME', time: '10:45-11:30PM' },
              {
                artist: 'FROST CHILDREN (DJ SET) + DJ THANK YOU',
                time: '11:30-CLOSE',
                afters: true,
              },
            ],
          },
        ],
      },
      {
        date: '2026-08-08',
        header: 'SATURDAY AUGUST 8, 2026',
        stages: [
          {
            name: 'MAIN STAGE',
            sets: [{ artist: 'DISCO LINES', time: '9:00-10:00PM' }],
          },
          {
            name: 'CELLAR STAGE',
            sets: [
              { artist: 'BAZAAR', time: '10:15-10:45PM' },
              { artist: 'DJ_DAVE + MGNA CRRRTA', time: '11:00-CLOSE', afters: true, annotations: ['(DJ SETS)'] },
            ],
          },
        ],
      },
    ],
    observations: ['MGNA CRRRTA re-checked — three R’s are printed, not an OCR error.'],
  };
}

const OPTS = { timezone: 'America/Los_Angeles', timezoneAssumed: true, sources: ['friday.webp', 'saturday.webp'] };

test('buildIngest: produces a schema-valid document with the right shape', () => {
  const built = buildIngest([fixture()], OPTS);
  assert.equal(built.festival.name, 'Harbor Lights'); // poster uppercase → title case
  assert.equal(built.festival.slug, 'harbor-lights');
  assert.equal(built.festival.year, 2026);
  assert.deepEqual(built.stages.map((s) => s.id), ['main', 'cellar']);
  assert.equal(built.doc.sets.length, 8);
  assert.equal(built.doc.verified, false, 'machine output must never be pre-verified');
});

test('buildIngest: ordinary set resolves start meridiem from the printed end', () => {
  const built = buildIngest([fixture()], OPTS);
  const avery = built.sets.find((s) => s.artist === 'AVERY COCHRANE')!;
  assert.equal(avery.start, '2026-08-07T15:15:00');
  assert.equal(avery.end, '2026-08-07T15:45:00');
  assert.equal(avery.end_inferred, false);
  assert.equal(avery.raw, 'AVERY COCHRANE');
});

test('buildIngest: CLOSE → start + 60 min, end_inferred, disclosed in notes', () => {
  const built = buildIngest([fixture()], OPTS);
  const muna = built.sets.find((s) => s.artist === 'MUNA' && s.posterDate === '2026-08-07')!;
  assert.equal(muna.start, '2026-08-07T22:40:00');
  assert.equal(muna.end, '2026-08-07T23:40:00');
  assert.equal(muna.end_inferred, true);
  assert.match(muna.notes, /End time not printed \(CLOSE\); assumed 60 minutes\./);
});

test('buildIngest: post-midnight inferred end shifts to the next calendar date', () => {
  const built = buildIngest([fixture()], OPTS);
  const afters = built.sets.find((s) => s.artist.startsWith('FROST CHILDREN'))!;
  assert.equal(afters.start, '2026-08-07T23:30:00');
  assert.equal(afters.end, '2026-08-08T00:30:00');
  assert.equal(afters.end_inferred, true);
  assert.equal(afters.crossesMidnight, true);
});

test('buildIngest: AFTERS raw string carries the label, annotations and printed time', () => {
  const built = buildIngest([fixture()], OPTS);
  const frost = built.sets.find((s) => s.artist.startsWith('FROST CHILDREN'))!;
  assert.equal(frost.raw, 'AFTERS / FROST CHILDREN (DJ SET) + DJ THANK YOU / 11:30-CLOSE');
  const dave = built.sets.find((s) => s.artist === 'DJ_DAVE + MGNA CRRRTA')!;
  assert.equal(dave.raw, 'AFTERS / DJ_DAVE + MGNA CRRRTA / (DJ SETS) / 11:00-CLOSE');
  assert.match(dave.notes, /Billed as AFTERS, DJ sets\./);
  assert.match(dave.notes, /Two acts on one printed block — kept as one event\./);
});

test('buildIngest: post-midnight printed start shifts to the next calendar date', () => {
  const raw = fixture();
  raw.days[0]!.stages[1]!.sets.push({ artist: 'NIGHT OWL', time: '12:30-1:15AM' });
  const built = buildIngest([raw], OPTS);
  const owl = built.sets.find((s) => s.artist === 'NIGHT OWL')!;
  assert.equal(owl.start, '2026-08-08T00:30:00');
  assert.equal(owl.end, '2026-08-08T01:15:00');
});

test('buildIngest: same artist on the same stage (same day or not) is a hard fail', () => {
  const raw = fixture();
  // Put MUNA on main on Saturday too — same stage across days, so the UID
  // (sha1 of slug+year+stage+normalized artist, no date) collides. Different
  // stages, as with FROST CHILDREN-style double bookings, are fine.
  raw.days[1]!.stages[0]!.sets = [{ artist: 'MUNA', time: '9:00-10:00PM' }];
  assert.throws(() => buildIngest([raw], OPTS), SchemaError);
});

test('buildIngest: YAML output round-trips through the real schema loader', () => {
  const built = buildIngest([fixture()], OPTS);
  // buildIngest itself validates via loadFestivalFromString; double-check a few
  // parsed values to prove the YAML text (not just the in-memory object) is right.
  const frost = built.doc.sets.find((s) => s.artist.startsWith('FROST CHILDREN'))!;
  assert.equal(frost.start.ical, '20260807T233000');
  assert.equal(frost.end.ical, '20260808T003000');
  assert.equal(frost.end_inferred, true);
  assert.equal(built.doc.festival.timezone, 'America/Los_Angeles');
});

test('buildIngest: two posters transcribed to the same date is an error', () => {
  const raw = fixture();
  raw.days[1]!.date = '2026-08-07';
  assert.throws(() => buildIngest([raw], OPTS), /same date/);
});

test('buildIngest: the log flags inferred ends, casing, afters, repeats and the assumed timezone', () => {
  const raw = fixture();
  raw.days[1]!.stages[0]!.sets = [{ artist: 'SOMEONE ELSE', time: '9:00-10:00PM' }];
  const built = buildIngest([raw], OPTS);
  assert.match(built.log, /no printed end time \(`CLOSE`\)/);
  assert.match(built.log, /assumed to be one\nhour after the start|assumed to be one hour after the start/);
  assert.match(built.log, /Artist casing cannot be derived/);
  assert.match(built.log, /Combined AFTERS billings kept as one event/);
  assert.match(built.log, /Timezone was assumed/);
  assert.match(built.log, /three R’s are printed/); // model observation carried through verbatim
});
