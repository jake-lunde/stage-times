/**
 * The transcription seam: saved raw model output in, validated edition
 * document and ambiguity log out. Deterministic, no model, no filesystem.
 *
 * Everything here runs without an API key: the vision step returns raw printed
 * strings, and every rule that turns those into an edition is deterministic
 * code under test — time resolution, CLOSE → +60min, post-midnight date
 * shifting, AFTERS handling, stage ids, YAML round-tripping through
 * src/schema.ts, and the duplicate-UID hard fail.
 *
 * `transcribe()` (src/transcription.ts) is the only entry point the CLI, the
 * eval, and the publisher use; the rule helpers it applies live in
 * src/transcribe.ts and are pinned individually further down.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { transcribe, TranscribeError, type ModelOutput } from '../src/transcription.js';
import {
  assertRawTranscription,
  normalizeOfficialUrl,
  parseTimeRange,
  resolveRange,
  slugify,
  stageIdFromName,
  titleCase,
  type RawTranscription,
} from '../src/transcribe.js';
import { loadFestival, loadFestivalFromString, normalizeArtist, SchemaError } from '../src/schema.js';
import { REPO_ROOT } from './helpers.js';

// ---------------------------------------------------------------------------
// Fixture model output — a small two-day festival, as parsed JSON and as text
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

/** The same fixture as one model reply per source — one poster per day. */
function outputs(raw: RawTranscription = fixture()): ModelOutput[] {
  return raw.days.map((day, i) => ({
    source: `${day.header.split(' ')[0]!.toLowerCase()}.webp`,
    output: JSON.stringify({ ...raw, days: [day], observations: i === 0 ? raw.observations : [] }),
  }));
}

const OPTS = { namespace: 'fan' as const, timezone: 'America/Los_Angeles', timezoneAssumed: true };

// ---------------------------------------------------------------------------
// transcribe — reading model output
// ---------------------------------------------------------------------------

test('transcribe: reads the JSON text a model returned, one reply per source', () => {
  const t = transcribe(outputs(), OPTS);
  assert.equal(t.edition.festival.name, 'Harbor Lights'); // poster uppercase → title case
  assert.equal(t.edition.festival.slug, 'harbor-lights');
  assert.equal(t.edition.festival.year, 2026);
  assert.deepEqual(t.edition.stages.map((s) => s.id), ['main', 'cellar']);
  assert.equal(t.edition.sets.length, 8);
  assert.equal(t.edition.verified, false, 'a transcription is never pre-verified');
  assert.equal(t.timezoneAssumed, true);
  assert.deepEqual(t.observations, fixture().observations);
});

test('transcribe: accepts already-parsed JSON as well as text', () => {
  const fromText = transcribe(outputs(), OPTS);
  const fromObject = transcribe(
    outputs().map((o) => ({ source: o.source, output: JSON.parse(o.output as string) as unknown })),
    OPTS,
  );
  assert.equal(fromObject.yaml, fromText.yaml);
  assert.equal(fromObject.log, fromText.log);
});

test('transcribe: tolerates prose and code fences around the JSON (CLI backend replies)', () => {
  const [friday] = outputs();
  const wrapped = `Here is the transcription:\n\n\`\`\`json\n${friday!.output as string}\n\`\`\`\n\nLet me know if you need anything else.`;
  const t = transcribe([{ source: friday!.source, output: wrapped }], OPTS);
  assert.equal(t.edition.sets.length, 5);
});

test('transcribe: rejects output with no JSON object, naming the source', () => {
  assert.throws(
    () => transcribe([{ source: 'friday.webp', output: 'I cannot read this image.' }], OPTS),
    (err: unknown) => err instanceof TranscribeError && /friday\.webp: no JSON object/.test(err.message),
  );
});

test('transcribe: rejects malformed JSON, naming the source', () => {
  assert.throws(
    () => transcribe([{ source: 'friday.webp', output: '{"festival_name": "X", "days": [}' }], OPTS),
    (err: unknown) => err instanceof TranscribeError && /friday\.webp: model output is not valid JSON/.test(err.message),
  );
});

test('transcribe: rejects a well-formed reply of the wrong shape, naming the problems', () => {
  const bad = { festival_name: 'F', days: [{ date: 'August 7', header: 'H', stages: [{ name: 'S', sets: [{ artist: 'A', time: '1:00-2:00PM' }] }] }] };
  assert.throws(
    () => transcribe([{ source: 'friday.webp', output: JSON.stringify(bad) }], OPTS),
    (err: unknown) => err instanceof TranscribeError && /friday\.webp: bad transcription shape/.test(err.message) && /date must be YYYY-MM-DD/.test(err.message),
  );
});

test('transcribe: refuses an empty list of model output', () => {
  assert.throws(() => transcribe([], OPTS), TranscribeError);
});

test('transcribe: is deterministic — the same model output gives byte-identical YAML and log', () => {
  const a = transcribe(outputs(), OPTS);
  const b = transcribe(outputs(), OPTS);
  assert.equal(a.yaml, b.yaml);
  assert.equal(a.log, b.log);
});

test('transcribe: the YAML is exactly what the schema loader would return as the edition', () => {
  const t = transcribe(outputs(), OPTS);
  const reloaded = loadFestivalFromString(t.yaml, t.edition.sourcePath);
  assert.deepEqual(reloaded, t.edition);
  // And a few parsed values, to prove the YAML text (not just the in-memory
  // object) is right.
  const frost = t.edition.sets.find((s) => s.artist.startsWith('FROST CHILDREN'))!;
  assert.equal(frost.start.ical, '20260807T233000');
  assert.equal(frost.end.ical, '20260808T003000');
  assert.equal(frost.end_inferred, true);
  assert.equal(t.edition.festival.timezone, 'America/Los_Angeles');
});

test('transcribe: the log and YAML name every source', () => {
  const t = transcribe(outputs(), OPTS);
  assert.match(t.log, /Source images: `friday\.webp`, `saturday\.webp`\./);
  assert.match(t.yaml, /# Source images:\n#   friday\.webp\n#   saturday\.webp/);
});

// ---------------------------------------------------------------------------
// transcribe — the rules, seen through the seam
// ---------------------------------------------------------------------------

test('transcribe: every set names the source it was read from, whatever order the sources came in', () => {
  const [friday, saturday] = outputs();
  for (const given of [[friday!, saturday!], [saturday!, friday!]]) {
    const t = transcribe(given, OPTS);
    for (const set of t.sets) {
      assert.equal(set.source, set.posterDate === '2026-08-07' ? 'friday.webp' : 'saturday.webp', `${set.artist} on ${set.posterDate}`);
    }
  }
});

test('transcribe: ordinary set resolves start meridiem from the printed end', () => {
  const t = transcribe(outputs(), OPTS);
  const avery = t.sets.find((s) => s.artist === 'AVERY COCHRANE')!;
  assert.equal(avery.start, '2026-08-07T15:15:00');
  assert.equal(avery.end, '2026-08-07T15:45:00');
  assert.equal(avery.end_inferred, false);
  assert.equal(avery.raw, 'AVERY COCHRANE');
});

test('transcribe: CLOSE → start + 60 min, an inferred-end set, disclosed in notes', () => {
  const t = transcribe(outputs(), OPTS);
  const muna = t.sets.find((s) => s.artist === 'MUNA' && s.posterDate === '2026-08-07')!;
  assert.equal(muna.start, '2026-08-07T22:40:00');
  assert.equal(muna.end, '2026-08-07T23:40:00');
  assert.equal(muna.end_inferred, true);
  assert.match(muna.notes, /End time not printed \(CLOSE\); assumed 60 minutes\./);
});

test('transcribe: post-midnight inferred end shifts to the next calendar date', () => {
  const t = transcribe(outputs(), OPTS);
  const afters = t.sets.find((s) => s.artist.startsWith('FROST CHILDREN'))!;
  assert.equal(afters.start, '2026-08-07T23:30:00');
  assert.equal(afters.end, '2026-08-08T00:30:00');
  assert.equal(afters.end_inferred, true);
  assert.equal(afters.crossesMidnight, true);
});

test('transcribe: AFTERS raw string carries the label, annotations and printed time', () => {
  const t = transcribe(outputs(), OPTS);
  const frost = t.sets.find((s) => s.artist.startsWith('FROST CHILDREN'))!;
  assert.equal(frost.raw, 'AFTERS / FROST CHILDREN (DJ SET) + DJ THANK YOU / 11:30-CLOSE');
  const dave = t.sets.find((s) => s.artist === 'DJ_DAVE + MGNA CRRRTA')!;
  assert.equal(dave.raw, 'AFTERS / DJ_DAVE + MGNA CRRRTA / (DJ SETS) / 11:00-CLOSE');
  assert.match(dave.notes, /Billed as AFTERS, DJ sets\./);
  assert.match(dave.notes, /Two acts on one printed block — kept as one event\./);
});

test('transcribe: post-midnight printed start shifts to the next calendar date', () => {
  const raw = fixture();
  raw.days[0]!.stages[1]!.sets.push({ artist: 'NIGHT OWL', time: '12:30-1:15AM' });
  const t = transcribe(outputs(raw), OPTS);
  const owl = t.sets.find((s) => s.artist === 'NIGHT OWL')!;
  assert.equal(owl.start, '2026-08-08T00:30:00');
  assert.equal(owl.end, '2026-08-08T01:15:00');
});

test('transcribe: same artist on the same stage (same day or not) is a hard fail', () => {
  const raw = fixture();
  // Put MUNA on main on Saturday too — same stage across days, so the UID
  // (sha1 of slug+year+stage+normalized artist, no date) collides. Different
  // stages, as with FROST CHILDREN-style double bookings, are fine.
  raw.days[1]!.stages[0]!.sets = [{ artist: 'MUNA', time: '9:00-10:00PM' }];
  assert.throws(() => transcribe(outputs(raw), OPTS), SchemaError);
});

test('transcribe: two sources transcribed to the same date is an error', () => {
  const raw = fixture();
  raw.days[1]!.date = '2026-08-07';
  assert.throws(() => transcribe(outputs(raw), OPTS), /same date/);
});

test('transcribe: human-supplied name, slug, URL and time zone override the poster', () => {
  const t = transcribe(outputs(), {
    namespace: 'fan',
    name: 'Harbor Lights Festival',
    slug: 'harbor-lights-fest',
    officialUrl: 'https://harborlights.example/schedule',
    timezone: 'America/New_York',
    timezoneAssumed: false,
  });
  assert.equal(t.edition.festival.name, 'Harbor Lights Festival');
  assert.equal(t.edition.festival.slug, 'harbor-lights-fest');
  assert.equal(t.edition.festival.official_url, 'https://harborlights.example/schedule');
  assert.equal(t.edition.festival.timezone, 'America/New_York');
  assert.equal(t.timezoneAssumed, false);
  assert.doesNotMatch(t.log, /Timezone was assumed/);
});

test('transcribe: the log flags inferred ends, casing, afters, repeats and the assumed time zone', () => {
  const raw = fixture();
  raw.days[1]!.stages[0]!.sets = [{ artist: 'SOMEONE ELSE', time: '9:00-10:00PM' }];
  const t = transcribe(outputs(raw), OPTS);
  assert.match(t.log, /no printed end time \(`CLOSE`\)/);
  assert.match(t.log, /assumed to be one\nhour after the start|assumed to be one hour after the start/);
  assert.match(t.log, /Artist casing cannot be derived/);
  assert.match(t.log, /Combined AFTERS billings kept as one event/);
  assert.match(t.log, /Timezone was assumed/);
  assert.match(t.log, /three R’s are printed/); // model observation carried through verbatim
});

// ---------------------------------------------------------------------------
// transcribe — corrections made on review
// ---------------------------------------------------------------------------

test('transcribe: a review edit replaces the artist, start or end and lands in the YAML', () => {
  const plain = transcribe(outputs(), OPTS);
  const muna = plain.sets.findIndex((s) => s.artist === 'MUNA');
  const avery = plain.sets.findIndex((s) => s.artist === 'AVERY COCHRANE');
  const t = transcribe(outputs(), {
    ...OPTS,
    edits: [
      { index: avery, artist: 'Avery Cochrane', start: '2026-08-07T15:20:00' },
      { index: muna, end: '2026-08-07T23:55:00' },
    ],
  });
  const edited = loadFestivalFromString(t.yaml, 'edited');
  const averySet = edited.sets.find((s) => s.artist === 'Avery Cochrane')!;
  assert.equal(averySet.start.raw, '2026-08-07T15:20:00', 'the edited start is what the schema loads');
  assert.equal(averySet.end.raw, '2026-08-07T15:45:00', 'an unedited field keeps the machine reading');
  const munaSet = edited.sets.find((s) => s.artist === 'MUNA')!;
  assert.equal(munaSet.end.raw, '2026-08-07T23:55:00');
  assert.equal(munaSet.end_inferred, false, 'a typed-in end is no longer a guess');
  assert.doesNotMatch(munaSet.notes, /assumed 60 minutes/);
});

test('transcribe: every edit is recorded in the log, machine reading beside the correction', () => {
  const plain = transcribe(outputs(), OPTS);
  const avery = plain.sets.findIndex((s) => s.artist === 'AVERY COCHRANE');
  const t = transcribe(outputs(), {
    ...OPTS,
    edits: [{ index: avery, artist: 'Avery Cochrane', start: '2026-08-07T15:20:00' }],
  });
  assert.equal(t.edits.length, 2, 'two fields changed on one set is two edits');
  assert.deepEqual(
    t.edits.map((e) => e.field),
    ['artist', 'start'],
  );
  assert.match(t.log, /## Corrections made on review/);
  assert.match(t.log, /\| main \| AVERY COCHRANE \| artist \| AVERY COCHRANE \| Avery Cochrane \|/);
  assert.match(t.log, /\| main \| AVERY COCHRANE \| start \| 2026-08-07T15:15:00 \| 2026-08-07T15:20:00 \|/);
});

test('transcribe: an edit that changes nothing is not recorded, and no edits says so', () => {
  const plain = transcribe(outputs(), OPTS);
  const avery = plain.sets.findIndex((s) => s.artist === 'AVERY COCHRANE');
  const t = transcribe(outputs(), { ...OPTS, edits: [{ index: avery, artist: 'AVERY COCHRANE' }] });
  assert.deepEqual(t.edits, []);
  assert.match(t.log, /None — every set is exactly as the machine read it\./);
});

test('transcribe: an edit pointing past the last set is a hard fail, not a silent no-op', () => {
  assert.throws(
    () => transcribe(outputs(), { ...OPTS, edits: [{ index: 99, artist: 'X' }] }),
    (err: unknown) => err instanceof TranscribeError && /points at set 99, but the transcription has 8 sets/.test(err.message),
  );
});

test('transcribe: an edited time still has to pass the schema', () => {
  assert.throws(
    () => transcribe(outputs(), { ...OPTS, edits: [{ index: 0, end: 'half nine' }] }),
    (err: unknown) => err instanceof SchemaError && /`end` is not a local datetime/.test(err.message),
  );
});

test('transcribe: verified: true writes the flag and says a human checked it', () => {
  const t = transcribe(outputs(), { ...OPTS, verified: true });
  assert.equal(t.edition.verified, true);
  assert.match(t.yaml, /^verified: true$/m);
  assert.match(t.yaml, /# verified: true — a human checked every set/);
  assert.match(t.log, /checked set by set against the source image by a human/);
  // The default is unchanged: nobody has looked at a bare transcription.
  assert.equal(transcribe(outputs(), OPTS).edition.verified, false);
});

// ---------------------------------------------------------------------------
// transcribe — a real model reply against the hand-verified edition
// ---------------------------------------------------------------------------

test('transcribe: the saved CHBP Friday model reply matches the verified edition set for set', () => {
  // The model's reply for the Friday poster, saved verbatim by the eval run
  // that scored 79/79. The hand-verified edition is the ground truth.
  const fixturePath = join(REPO_ROOT, 'tests', 'fixtures', 'model-output', 'chbp-2026-friday.json');
  const t = transcribe([{ source: 'CHBP+Daily+Schedule_FRIDAY.webp', output: readFileSync(fixturePath, 'utf8') }], {
    namespace: 'owner',
    name: 'Capitol Hill Block Party',
    slug: 'capitol-hill-block-party',
    timezone: 'America/Los_Angeles',
    timezoneAssumed: false,
  });

  const hand = loadFestival(join(REPO_ROOT, 'data', 'capitol-hill-block-party-2026.yaml'));
  // Friday's sets: those that start on the 7th, plus post-midnight sets that
  // belong to it.
  const fridayHand = hand.sets.filter(
    (s) => s.start.raw.startsWith('2026-08-07') || (s.start.raw.startsWith('2026-08-08') && s.start.hour < 6),
  );
  assert.equal(fridayHand.length, 26);
  assert.equal(t.sets.length, 26);

  const byKey = new Map(fridayHand.map((s) => [`${s.stage}\0${normalizeArtist(s.artist)}`, s]));
  for (const set of t.sets) {
    const expected = byKey.get(`${set.stage}\0${normalizeArtist(set.artist)}`);
    assert.ok(expected, `${set.stage} · ${set.artist} is not in the verified edition`);
    assert.equal(set.artist, expected.artist);
    assert.equal(set.start, expected.start.raw, `${set.artist} start`);
    assert.equal(set.end, expected.end.raw, `${set.artist} end`);
    assert.equal(set.end_inferred, expected.end_inferred, `${set.artist} end_inferred`);
  }
  for (const stage of t.edition.stages) {
    assert.ok(hand.stages.some((s) => s.id === stage.id), `stage id ${stage.id} is not one of the verified stage ids`);
  }
});

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
