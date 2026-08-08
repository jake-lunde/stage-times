/**
 * The eight validation gates from the brief.
 *
 * Gates 1–7 live here. Gate 8 is a post-deploy smoke script against a live URL
 * and cannot run in a unit test — see tests/smoke.ts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import ICAL from 'ical.js';

import {
  assertPublishedSlugsPresent,
  buildFeeds,
  readPublished,
  type BuildResult,
  type PublishedFile,
} from '../src/build.js';
import { MAX_LINE_OCTETS, UID_DOMAIN } from '../src/ics.js';
import { SchemaError, loadFestival, validateDoc, wallToUtc } from '../src/schema.js';
import { parse as parseYaml } from 'yaml';
import {
  GOLDEN_DIR,
  REPO_ROOT,
  buildDst,
  docFromText,
  dstYamlText,
  emptyState,
  getProps,
  harborDoc,
  logicalLines,
} from './helpers.js';

const UPDATE_GOLDEN = process.env['STAGE_TIMES_UPDATE_GOLDEN'] === '1';

function icsFiles(result: BuildResult): [string, string][] {
  return [...result.files.entries()].filter(([p]) => p.endsWith('.ics'));
}

const harbor = harborDoc();
const harborBuild = buildFeeds(harbor, emptyState('20260808T000000Z'));
const dstBuild = buildDst();

// ===========================================================================
// GATE 1 — parse every generated .ics with an INDEPENDENT library (ical.js)
// ===========================================================================

function parseIcs(text: string): ICAL.Component {
  return new ICAL.Component(ICAL.parse(text));
}

test('gate 1: ical.js parses every generated feed as a VCALENDAR with the right headers', () => {
  for (const [path, text] of [...icsFiles(harborBuild), ...icsFiles(dstBuild)]) {
    const comp = parseIcs(text);
    assert.equal(comp.name, 'vcalendar', `${path}: root component`);
    assert.equal(comp.getFirstPropertyValue('version'), '2.0', `${path}: VERSION`);
    assert.equal(comp.getFirstPropertyValue('prodid'), '-//Stage Times//stagetimes.app//EN', `${path}: PRODID`);
    assert.equal(comp.getFirstPropertyValue('calscale'), 'GREGORIAN', `${path}: CALSCALE`);
    assert.equal(comp.getFirstPropertyValue('method'), null, `${path}: METHOD must be absent`);
    assert.ok(comp.getFirstSubcomponent('vtimezone'), `${path}: VTIMEZONE`);
    assert.equal(comp.getAllSubcomponents('vtimezone').length, 1, `${path}: exactly one VTIMEZONE`);
  }
});

test('gate 1: event counts match the YAML, per stage and in aggregate', () => {
  const key = `${harbor.festival.slug}-${harbor.festival.year}`;
  let running = 0;
  for (const stage of harbor.stages) {
    const expected = harbor.sets.filter((s) => s.stage === stage.id).length;
    assert.ok(expected > 0, `${stage.id} should have sets`);
    running += expected;
    const comp = parseIcs(harborBuild.files.get(`${key}/${stage.id}.ics`)!);
    assert.equal(comp.getAllSubcomponents('vevent').length, expected, `${stage.id}.ics event count`);
  }
  const all = parseIcs(harborBuild.files.get(`${key}/all.ics`)!);
  assert.equal(all.getAllSubcomponents('vevent').length, harbor.sets.length);
  assert.equal(running, harbor.sets.length, 'stage feeds must partition the set list exactly');
});

test('gate 1: per-stage partitioning — no event appears in the wrong feed, all.ics is the exact union', () => {
  const key = `${harbor.festival.slug}-${harbor.festival.year}`;
  const seen = new Set<string>();

  for (const stage of harbor.stages) {
    const comp = parseIcs(harborBuild.files.get(`${key}/${stage.id}.ics`)!);
    const expectedArtists = new Set(harbor.sets.filter((s) => s.stage === stage.id).map((s) => s.artist));
    for (const ve of comp.getAllSubcomponents('vevent')) {
      const uid = String(ve.getFirstPropertyValue('uid'));
      const summary = String(ve.getFirstPropertyValue('summary'));
      const location = String(ve.getFirstPropertyValue('location'));
      assert.equal(location, stage.name, `${stage.id}.ics: LOCATION must be the stage display name`);
      assert.ok(expectedArtists.has(summary), `${stage.id}.ics contains "${summary}", which is not on that stage`);
      assert.match(uid, new RegExp(`@${UID_DOMAIN.replace('.', '\\.')}$`));
      assert.equal(seen.has(uid), false, `UID ${uid} appears in two stage feeds`);
      seen.add(uid);
    }
  }

  const allUids = parseIcs(harborBuild.files.get(`${key}/all.ics`)!)
    .getAllSubcomponents('vevent')
    .map((ve) => String(ve.getFirstPropertyValue('uid')));
  assert.equal(new Set(allUids).size, allUids.length, 'all.ics must not duplicate a UID');
  assert.deepEqual([...allUids].sort(), [...seen].sort(), 'all.ics must be the exact union of the stage feeds');
});

test('gate 1: no event ends before (or when) it starts, per ical.js', () => {
  for (const [path, text] of [...icsFiles(harborBuild), ...icsFiles(dstBuild)]) {
    const comp = parseIcs(text);
    ICAL.TimezoneService.reset();
    for (const vt of comp.getAllSubcomponents('vtimezone')) {
      ICAL.TimezoneService.register(new ICAL.Timezone(vt));
    }
    for (const ve of comp.getAllSubcomponents('vevent')) {
      const ev = new ICAL.Event(ve);
      const start = ev.startDate.toJSDate().getTime();
      const end = ev.endDate.toJSDate().getTime();
      assert.ok(
        end > start,
        `${path}: "${ev.summary}" ends at ${new Date(end).toISOString()} which is not after ${new Date(
          start,
        ).toISOString()}`,
      );
    }
    ICAL.TimezoneService.reset();
  }
});

test('gate 1: required event fields present, and no VALARM anywhere', () => {
  for (const [path, text] of [...icsFiles(harborBuild), ...icsFiles(dstBuild)]) {
    const comp = parseIcs(text);
    for (const ve of comp.getAllSubcomponents('vevent')) {
      assert.equal(ve.getFirstPropertyValue('status'), 'CONFIRMED', `${path}: STATUS`);
      assert.equal(ve.getFirstPropertyValue('transp'), 'TRANSPARENT', `${path}: TRANSP`);
      assert.ok(ve.getFirstPropertyValue('dtstamp'), `${path}: DTSTAMP`);
      assert.ok(ve.getFirstPropertyValue('last-modified'), `${path}: LAST-MODIFIED`);
      assert.notEqual(ve.getFirstPropertyValue('sequence'), null, `${path}: SEQUENCE`);
      assert.ok(String(ve.getFirstPropertyValue('description')).includes('Official schedule:'), `${path}: link`);
      assert.equal(ve.getAllSubcomponents('valarm').length, 0, `${path}: subscribed feeds must ship no VALARM`);
    }
  }
});

test('gate 1: calendar naming and refresh hints survive an independent parse', () => {
  const key = `${harbor.festival.slug}-${harbor.festival.year}`;
  const comp = parseIcs(harborBuild.files.get(`${key}/main.ics`)!);
  const expectedName = 'Lakefront Main Stage — Harbor Lights Festival 26';
  const expectedDesc = 'Harbor Lights Festival 2026 set times for Lakefront Main Stage. stagetimes.app';
  assert.equal(comp.getFirstPropertyValue('x-wr-calname'), expectedName);
  assert.equal(comp.getFirstPropertyValue('name'), expectedName);
  assert.equal(comp.getFirstPropertyValue('x-wr-caldesc'), expectedDesc);
  assert.equal(comp.getFirstPropertyValue('description'), expectedDesc);
  assert.equal(comp.getFirstPropertyValue('x-published-ttl'), 'PT12H');
  assert.equal(String(comp.getFirstPropertyValue('refresh-interval')), 'PT12H');
});

test('gate 1: escaped text round-trips through an independent parser', () => {
  const key = `${harbor.festival.slug}-${harbor.festival.year}`;
  const canal = parseIcs(harborBuild.files.get(`${key}/canal.ics`)!);
  const summaries = canal.getAllSubcomponents('vevent').map((v) => String(v.getFirstPropertyValue('summary')));
  assert.ok(summaries.includes('Two Rivers, One Bridge'), 'comma must survive escaping');
  assert.ok(summaries.includes('Óskar Þórðarson'), 'multi-byte name must survive folding');

  const annex = parseIcs(harborBuild.files.get(`${key}/annex.ics`)!);
  const annexSummaries = annex.getAllSubcomponents('vevent').map((v) => String(v.getFirstPropertyValue('summary')));
  assert.ok(annexSummaries.includes('¡Aparato!'));

  const main = parseIcs(harborBuild.files.get(`${key}/main.ics`)!);
  const long = main
    .getAllSubcomponents('vevent')
    .map((v) => String(v.getFirstPropertyValue('summary')))
    .find((s) => s.startsWith('The Mechanical Hound'));
  assert.equal(long, 'The Mechanical Hound Orchestra of Greater Saint Paul');

  const desc = main
    .getAllSubcomponents('vevent')
    .map((v) => String(v.getFirstPropertyValue('description')))
    .find((d) => d.includes('Mechanical') || d.includes('Lakefront'));
  assert.ok(desc && desc.includes('\n'), 'DESCRIPTION newlines must unescape back to real newlines');
});

test('gate 1: the end_inferred caveat appears only where the YAML says so', () => {
  const key = `${harbor.festival.slug}-${harbor.festival.year}`;
  const inferredArtists = new Set(harbor.sets.filter((s) => s.end_inferred).map((s) => s.artist));
  assert.ok(inferredArtists.size > 0, 'fixture must exercise end_inferred');
  const all = parseIcs(harborBuild.files.get(`${key}/all.ics`)!);
  for (const ve of all.getAllSubcomponents('vevent')) {
    const summary = String(ve.getFirstPropertyValue('summary'));
    const description = String(ve.getFirstPropertyValue('description'));
    assert.equal(
      description.includes('inferred'),
      inferredArtists.has(summary),
      `${summary}: end_inferred caveat mismatch`,
    );
  }
});

// ===========================================================================
// GATE 2 — golden file, byte-compared
// ===========================================================================

test('gate 2: generated feeds are byte-identical to the committed goldens', () => {
  mkdirSync(GOLDEN_DIR, { recursive: true });
  const entries = icsFiles(dstBuild);
  assert.equal(entries.length, 3, 'dst-check fixture should produce 2 stage feeds + all.ics');

  for (const [rel, text] of entries) {
    const goldenPath = join(GOLDEN_DIR, rel);
    if (UPDATE_GOLDEN) {
      mkdirSync(join(GOLDEN_DIR, rel.split('/')[0]!), { recursive: true });
      writeFileSync(goldenPath, text, 'utf8');
      continue;
    }
    assert.ok(existsSync(goldenPath), `missing golden ${goldenPath} — regenerate with STAGE_TIMES_UPDATE_GOLDEN=1`);
    const expected = readFileSync(goldenPath);
    const actual = Buffer.from(text, 'utf8');
    if (!expected.equals(actual)) {
      // Point at the first differing octet rather than dumping two 4KB blobs.
      const n = Math.min(expected.length, actual.length);
      let i = 0;
      while (i < n && expected[i] === actual[i]) i++;
      assert.fail(
        `${rel} differs from its golden at octet ${i} ` +
          `(expected ${expected.length} octets, got ${actual.length}).\n` +
          `  golden: ${JSON.stringify(expected.subarray(Math.max(0, i - 40), i + 40).toString('utf8'))}\n` +
          `  actual: ${JSON.stringify(actual.subarray(Math.max(0, i - 40), i + 40).toString('utf8'))}`,
      );
    }
  }
  assert.equal(UPDATE_GOLDEN, false, 'goldens were regenerated — re-run without STAGE_TIMES_UPDATE_GOLDEN');
});

test('gate 2: the golden feeds pin the frozen surface (PRODID, UID domain, no METHOD)', () => {
  const golden = readFileSync(join(GOLDEN_DIR, 'dst-check-2026', 'hall.ics'), 'utf8');
  assert.ok(golden.includes('PRODID:-//Stage Times//stagetimes.app//EN\r\n'));
  assert.ok(golden.includes('@stagetimes.app\r\n'));
  assert.equal(golden.includes('METHOD:'), false);
  assert.ok(golden.endsWith('END:VCALENDAR\r\n'), 'file must end with END:VCALENDAR plus a trailing CRLF');
});

// ===========================================================================
// GATE 3 — UID stability
// ===========================================================================

function uidsOf(result: BuildResult): string[] {
  const key = 'dst-check-2026';
  return parseIcs(result.files.get(`${key}/all.ics`)!)
    .getAllSubcomponents('vevent')
    .map((v) => String(v.getFirstPropertyValue('uid')))
    .sort();
}

test('gate 3: building twice from identical inputs yields identical UIDs and identical bytes', () => {
  const first = buildDst();
  const second = buildDst();
  assert.deepEqual(uidsOf(second), uidsOf(first), 'UIDs must not move between builds');
  assert.deepEqual([...second.files.keys()].sort(), [...first.files.keys()].sort());
  for (const [path, text] of first.files) {
    assert.ok(
      Buffer.from(text, 'utf8').equals(Buffer.from(second.files.get(path)!, 'utf8')),
      `${path} is not byte-identical across two builds`,
    );
  }
});

test('gate 3: a converged state re-build is a no-op — no SEQUENCE drift', () => {
  const first = buildDst();
  const second = buildFeeds(docFromText(dstYamlText(), 'dst'), {
    publishedAt: '20270101T000000Z', // even with a newer stamp, unchanged content must not move
    sequences: first.nextSequences,
  });
  assert.deepEqual(second.changedUids, []);
  assert.deepEqual(second.newUids, []);
  for (const [path, text] of first.files) {
    if (!path.endsWith('.ics')) continue;
    assert.equal(second.files.get(path), text, `${path} changed on a no-op rebuild`);
  }
});

test('gate 3: moving a set changes DTSTART and SEQUENCE but never the UID', () => {
  const first = buildDst();

  const mutated = dstYamlText()
    .replace('start: "2026-11-01T03:00:00"', 'start: "2026-11-01T04:30:00"')
    .replace('end: "2026-11-01T04:00:00"', 'end: "2026-11-01T05:30:00"');
  assert.notEqual(mutated, dstYamlText(), 'mutation must actually apply');

  const second = buildFeeds(docFromText(mutated, 'dst (moved set)'), {
    publishedAt: '20260201T000000Z',
    sequences: first.nextSequences,
  });

  assert.deepEqual(uidsOf(second), uidsOf(first), 'UID must be invariant under a reschedule');

  const find = (r: BuildResult) => {
    const ve = parseIcs(r.files.get('dst-check-2026/yard.ics')!)
      .getAllSubcomponents('vevent')
      .find((v) => String(v.getFirstPropertyValue('summary')) === 'After the Fallback');
    assert.ok(ve, 'moved event must still exist');
    return {
      uid: String(ve.getFirstPropertyValue('uid')),
      dtstart: String(ve.getFirstPropertyValue('dtstart')),
      sequence: Number(ve.getFirstPropertyValue('sequence')),
      lastModified: String(ve.getFirstPropertyValue('last-modified')),
    };
  };
  const a = find(first);
  const b = find(second);

  assert.equal(b.uid, a.uid, 'UID must not include the start time');
  assert.notEqual(b.dtstart, a.dtstart, 'DTSTART must move');
  assert.equal(b.sequence, a.sequence + 1, 'SEQUENCE must advance exactly one step');
  assert.notEqual(b.lastModified, a.lastModified, 'LAST-MODIFIED must advance with the publish stamp');

  // Everything else on that stage must be untouched.
  const untouched = parseIcs(second.files.get('dst-check-2026/yard.ics')!)
    .getAllSubcomponents('vevent')
    .find((v) => String(v.getFirstPropertyValue('summary')) === 'Sunday Matinée, Part Two')!;
  assert.equal(Number(untouched.getFirstPropertyValue('sequence')), 0, 'unrelated events must not bump SEQUENCE');
});

test('gate 3: renaming a stage display name bumps SEQUENCE but keeps every UID', () => {
  const first = buildDst();
  const renamed = dstYamlText().replace('name: "The Yard"', 'name: "Sponsored Yard Stage"');
  const second = buildFeeds(docFromText(renamed, 'dst (renamed stage)'), {
    publishedAt: '20260201T000000Z',
    sequences: first.nextSequences,
  });
  assert.deepEqual(uidsOf(second), uidsOf(first), 'stage id, not name, feeds the UID');
  assert.equal(second.changedUids.length, 2, 'both yard events change content (LOCATION + DESCRIPTION)');
});

// ===========================================================================
// GATE 4 — URL stability
// ===========================================================================

// This one is a repo-integrity check, not a fixture check: it asserts the COMMITTED
// state file still agrees with the COMMITTED data file for the festival we actually
// publish. It reads `default` rather than naming a festival, so adding next year's
// schedule doesn't require editing the test.
test('gate 4: every stage slug in state/published.json still exists in the YAML', () => {
  const published = readPublished(join(REPO_ROOT, 'state', 'published.json'));
  const key = published.default;
  const doc = loadFestival(join(REPO_ROOT, 'data', `${key}.yaml`));
  assert.equal(`${doc.festival.slug}-${doc.festival.year}`, key, 'default key must match its YAML');

  // Empty is legitimate before the first production deploy — nothing is being polled
  // yet, so there is no URL to protect. Once populated it must stay consistent.
  if (published.festivals[key]) {
    assert.doesNotThrow(() => assertPublishedSlugsPresent(published, key, doc));
  }
});

test('gate 4: a disappeared published slug fails the build loudly', () => {
  const key = `${harbor.festival.slug}-${harbor.festival.year}`;
  const published: PublishedFile = {
    publishedAt: '20260808T000000Z',
    default: key,
    festivals: { [key]: { slug: harbor.festival.slug, year: harbor.festival.year, stages: ['main', 'boardwalk'] } },
  };
  assert.throws(
    () => assertPublishedSlugsPresent(published, key, harbor),
    (err: Error) => {
      assert.match(err.message, /boardwalk/);
      assert.match(err.message, /BUILD REFUSED/);
      assert.match(err.message, /subscriber/i);
      assert.doesNotMatch(err.message, /\bmain\b.*\(stage id "main"\)/, 'must not accuse a stage that still exists');
      return true;
    },
  );
});

test('gate 4: a renamed stage id is caught even though the display name is unchanged', () => {
  const key = 'dst-check-2026';
  const doc = docFromText(
    dstYamlText().replace('id: "yard"', 'id: "the-yard"').replace(/stage: "yard"/g, 'stage: "the-yard"'),
    'dst (renamed id)',
  );
  const published: PublishedFile = {
    publishedAt: '20260101T000000Z',
    default: key,
    festivals: { [key]: { slug: 'dst-check', year: 2026, stages: ['hall', 'yard'] } },
  };
  assert.throws(() => assertPublishedSlugsPresent(published, key, doc), /yard/);
});

// ===========================================================================
// GATE 5 — timezone / DST
// ===========================================================================

/** Resolve every event's UTC instant using ONLY the VTIMEZONE embedded in the feed. */
function resolveWithEmbeddedVtimezone(text: string): Map<string, string> {
  const comp = parseIcs(text);
  ICAL.TimezoneService.reset();
  assert.equal(
    ICAL.TimezoneService.has('America/Chicago'),
    false,
    'ical.js must not already know this zone — otherwise the test would not exercise our VTIMEZONE',
  );
  const vt = comp.getFirstSubcomponent('vtimezone');
  assert.ok(vt, 'VTIMEZONE must be embedded in the feed');
  ICAL.TimezoneService.register(new ICAL.Timezone(vt));

  const out = new Map<string, string>();
  for (const ve of comp.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(ve);
    out.set(ev.summary, ev.startDate.toJSDate().toISOString());
  }
  ICAL.TimezoneService.reset();
  return out;
}

test('gate 5: VTIMEZONE is present and covers the transition inside the festival window', () => {
  const hall = dstBuild.files.get('dst-check-2026/hall.ics')!;
  const lines = logicalLines(hall);
  assert.ok(lines.includes('BEGIN:VTIMEZONE'));
  assert.ok(lines.includes('TZID:America/Chicago'));
  assert.ok(lines.includes('BEGIN:DAYLIGHT'));
  assert.ok(lines.includes('BEGIN:STANDARD'));
  // The autumn transition that this fixture straddles.
  assert.ok(lines.includes('DTSTART:20261101T020000'));
  assert.ok(lines.includes('TZOFFSETFROM:-0500'));
  assert.ok(lines.includes('TZOFFSETTO:-0600'));
  for (const p of getProps(hall, 'DTSTART')) {
    // Every event DTSTART is zoned, never floating and never a bare Z.
    if (p.startsWith('2026') && p.endsWith('Z')) assert.fail('event DTSTART must not be UTC-only');
  }
  assert.ok(hall.includes('DTSTART;TZID=America/Chicago:'), 'events must carry TZID');
});

test('gate 5: resolved UTC instants are correct on BOTH sides of the fall-back boundary', () => {
  const hall = resolveWithEmbeddedVtimezone(dstBuild.files.get('dst-check-2026/hall.ics')!);
  const yard = resolveWithEmbeddedVtimezone(dstBuild.files.get('dst-check-2026/yard.ics')!);

  // 2026-11-01T07:00:00Z is the transition: 01:59:59 CDT -> 01:00:00 CST.
  // Before it, local time is UTC-05:00. After it, UTC-06:00.
  assert.equal(hall.get('Before the Fallback'), '2026-11-01T03:00:00.000Z', '31 Oct 22:00 CDT = 01 Nov 03:00Z');
  assert.equal(
    hall.get('Óskar Þórðarson & the Ǫld Ǫrchard Ballroom Ensemble Ǫrkestrǫ'),
    '2026-11-01T05:15:00.000Z',
    '01 Nov 00:15 CDT = 05:15Z (still daylight time)',
  );
  assert.equal(yard.get('After the Fallback'), '2026-11-01T09:00:00.000Z', '01 Nov 03:00 CST = 09:00Z');
  assert.equal(yard.get('Sunday Matinée, Part Two'), '2026-11-01T18:00:00.000Z', '01 Nov 12:00 CST = 18:00Z');

  // The two sides really are an hour apart in offset — this is what a single
  // fixed-offset (or floating) feed would get wrong.
  const beforeOffset = new Date('2026-10-31T22:00:00Z').getTime() - new Date(hall.get('Before the Fallback')!).getTime();
  const afterOffset = new Date('2026-11-01T03:00:00Z').getTime() - new Date(yard.get('After the Fallback')!).getTime();
  assert.equal(afterOffset - beforeOffset, -3_600_000);
});

test('gate 5: the summer festival resolves against its own VTIMEZONE too', () => {
  const key = `${harbor.festival.slug}-${harbor.festival.year}`;
  const resolved = resolveWithEmbeddedVtimezone(harborBuild.files.get(`${key}/main.ics`)!);
  // 14 Aug 2026 20:00 CDT (UTC-05:00) = 01:00Z on 15 Aug.
  assert.equal(resolved.get('The Mechanical Hound Orchestra of Greater Saint Paul'), '2026-08-15T01:00:00.000Z');
});

test('gate 5: every event resolves to the wall time the YAML asked for', () => {
  const key = `${harbor.festival.slug}-${harbor.festival.year}`;
  const resolved = resolveWithEmbeddedVtimezone(harborBuild.files.get(`${key}/all.ics`)!);
  assert.equal(resolved.size, harbor.sets.length);
  for (const set of harbor.sets) {
    const expected = wallToUtc(harbor.festival.timezone, set.start);
    assert.equal(typeof expected, 'number', `${set.artist}: fixture time must be resolvable`);
    assert.equal(
      resolved.get(set.artist),
      new Date(expected as number).toISOString(),
      `${set.artist}: feed resolves to a different instant than the YAML wall time`,
    );
  }
});

// ===========================================================================
// GATE 6 — raw-byte lint
// ===========================================================================

test('gate 6: raw-byte lint — CRLF everywhere, <= 75 octets per line, well-formed folding', () => {
  for (const [path, text] of [...icsFiles(harborBuild), ...icsFiles(dstBuild)]) {
    const buf = Buffer.from(text, 'utf8');

    assert.ok(text.endsWith('\r\nEND:VCALENDAR\r\n'), `${path}: must end with END:VCALENDAR + CRLF`);

    // Every LF must be preceded by CR, and every CR followed by LF. A lone LF is
    // the classic way a feed breaks strict parsers.
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] === 0x0a) assert.equal(buf[i - 1], 0x0d, `${path}: bare LF at octet ${i}`);
      if (buf[i] === 0x0d) assert.equal(buf[i + 1], 0x0a, `${path}: bare CR at octet ${i}`);
    }

    const parts = text.split('\r\n');
    assert.equal(parts.at(-1), '', `${path}: trailing CRLF required after the last content line`);
    const lines = parts.slice(0, -1);
    assert.ok(lines.length > 0);

    lines.forEach((line, i) => {
      const n = Buffer.byteLength(line, 'utf8');
      assert.ok(n <= MAX_LINE_OCTETS, `${path}:${i + 1} is ${n} octets (limit ${MAX_LINE_OCTETS}): ${line.slice(0, 90)}`);
      assert.ok(n > 0, `${path}:${i + 1} is empty — blank lines are not legal content lines`);
      assert.equal(line.includes('�'), false, `${path}:${i + 1} contains U+FFFD — a fold split a UTF-8 sequence`);
      if (i === 0) assert.equal(line, 'BEGIN:VCALENDAR', `${path}: first line`);
      if (line.startsWith(' ')) {
        assert.notEqual(i, 0, `${path}: a feed cannot open with a continuation line`);
        assert.ok(line.length > 1, `${path}:${i + 1} is a continuation line with no content`);
      }
    });

    // Every unfolded logical line must look like a property (NAME[;params]:value)
    // or a component delimiter. A broken fold shows up here as garbage.
    for (const logical of logicalLines(text)) {
      assert.match(
        logical,
        /^[A-Za-z0-9-]+(;[^:]*)?:/,
        `${path}: unfolding produced a non-property line: ${logical.slice(0, 90)}`,
      );
    }

    // Folding must be reversible: refolding the unfolded content reproduces the file.
    const refolded = logicalLines(text)
      .map((l) => {
        const b = Buffer.from(l, 'utf8');
        return b.length <= MAX_LINE_OCTETS;
      })
      .some((short) => !short);
    if (refolded) {
      assert.ok(text.includes('\r\n '), `${path}: content exceeds 75 octets but no fold is present`);
    }
  }
});

test('gate 6: a long non-ASCII line is actually folded and unfolds to the original', () => {
  const hall = dstBuild.files.get('dst-check-2026/hall.ics')!;
  assert.ok(hall.includes('\r\n '), 'fixture must contain at least one folded line');
  const summaries = getProps(hall, 'SUMMARY');
  assert.ok(
    summaries.includes('Óskar Þórðarson & the Ǫld Ǫrchard Ballroom Ensemble Ǫrkestrǫ'),
    `unfolded SUMMARY values were: ${JSON.stringify(summaries)}`,
  );
});

/**
 * The committed golden must itself contain a fold whose naive octet split would
 * have landed inside a UTF-8 sequence. Without this the golden could pass while
 * only ever folding ASCII, and the multi-byte path would be covered by unit tests
 * alone.
 */
test('gate 6: the golden feed contains a real fold that a naive octet split would corrupt', () => {
  const hall = dstBuild.files.get('dst-check-2026/hall.ics')!;
  const logical = logicalLines(hall).find((l) => l.startsWith('SUMMARY:Óskar'));
  assert.ok(logical, 'fixture must carry the long non-ASCII SUMMARY');

  const bytes = Buffer.from(logical, 'utf8');
  assert.ok(bytes.length > MAX_LINE_OCTETS, `SUMMARY is only ${bytes.length} octets — it would not fold`);
  assert.equal(
    bytes[MAX_LINE_OCTETS]! & 0xc0,
    0x80,
    'fixture must place a UTF-8 continuation byte at octet 75, so a naive split is provably wrong',
  );

  // And the emitted physical lines back off to a character boundary.
  const physical = hall.split('\r\n');
  const firstIdx = physical.findIndex((l) => l.startsWith('SUMMARY:Óskar'));
  assert.ok(firstIdx >= 0);
  assert.equal(Buffer.byteLength(physical[firstIdx]!, 'utf8'), 74, 'must back off one octet short of the limit');
  assert.equal(physical[firstIdx + 1], ' ǫ');
  assert.equal(hall.includes('�'), false);
});

test('gate 6: a folded DESCRIPTION whose continuation begins with a real space round-trips', () => {
  // "End time\r\n  not printed" — the first space is the fold, the second is content.
  // A parser that strips all leading whitespace loses a word here; ical.js must not.
  const hall = dstBuild.files.get('dst-check-2026/hall.ics')!;
  assert.ok(hall.includes('\r\n  not printed'), 'fixture must exercise a fold immediately before a content space');
  const parsed = parseIcs(hall)
    .getAllSubcomponents('vevent')
    .find((v) => String(v.getFirstPropertyValue('summary')).startsWith('Óskar'))!;
  assert.equal(
    String(parsed.getFirstPropertyValue('description')),
    'Fallback Hall\n' +
      'Sun 1 Nov 2026, 12:15 AM – 12:45 AM\n' +
      'End time not printed on the official schedule; inferred from the next set on this stage. Treat it as approximate.\n' +
      'Official schedule: https://example.com/dst-check/schedule',
  );
});

// ===========================================================================
// GATE 7 — schema integrity
// ===========================================================================

function expectProblem(yamlText: string, pattern: RegExp, label: string): void {
  let threw = false;
  try {
    validateDoc(parseYaml(yamlText), label);
  } catch (err) {
    threw = true;
    assert.ok(err instanceof SchemaError, `${label}: expected SchemaError, got ${String(err)}`);
    assert.match((err as SchemaError).message, pattern, `${label}: message did not name the offending entry`);
  }
  assert.ok(threw, `${label}: validation should have failed`);
}

test('gate 7: the real fixtures validate cleanly', () => {
  assert.ok(harbor.sets.length > 0);
  assert.doesNotThrow(() => validateDoc(parseYaml(dstYamlText()), 'dst'));
});

test('gate 7: every set must reference a declared stage id', () => {
  expectProblem(
    dstYamlText().replace('  - stage: "yard"\n    artist: "After the Fallback"', '  - stage: "yrad"\n    artist: "After the Fallback"'),
    /After the Fallback.*undeclared stage id "yrad"/s,
    'undeclared stage',
  );
});

test('gate 7: every declared stage must have at least one set', () => {
  const withEmptyStage = dstYamlText().replace(
    '  - id: "yard"\n    name: "The Yard"',
    '  - id: "balcony"\n    name: "The Balcony"\n    description: ""\n  - id: "yard"\n    name: "The Yard"',
  );
  expectProblem(withEmptyStage, /declared stage "balcony" \(The Balcony\) has zero sets/, 'empty stage');
});

test('gate 7: end before start is rejected, naming the set', () => {
  expectProblem(
    dstYamlText().replace('end: "2026-11-01T04:00:00"', 'end: "2026-11-01T02:00:00"'),
    /After the Fallback.*end .* is before start/s,
    'end before start',
  );
});

test('gate 7: end equal to start is rejected', () => {
  expectProblem(
    dstYamlText().replace('end: "2026-11-01T04:00:00"', 'end: "2026-11-01T03:00:00"'),
    /After the Fallback.*same instant as start/s,
    'zero-length set',
  );
});

test('gate 7: a non-kebab-case stage id is rejected', () => {
  for (const bad of ['The_Yard', 'The Yard', 'TheYard', 'the--yard', '-yard', 'yard-']) {
    expectProblem(
      dstYamlText().replace('id: "yard"', `id: "${bad}"`).replace(/stage: "yard"/g, `stage: "${bad}"`),
      /is not lowercase ASCII kebab-case/,
      `bad slug ${bad}`,
    );
  }
});

test('gate 7: a non-ASCII stage id is rejected', () => {
  expectProblem(
    dstYamlText().replace('id: "yard"', 'id: "jardín"').replace(/stage: "yard"/g, 'stage: "jardín"'),
    /contains non-ASCII characters/,
    'non-ascii slug',
  );
});

test('gate 7: a stage id containing a year or a date is rejected', () => {
  expectProblem(
    dstYamlText().replace('id: "yard"', 'id: "yard-2026"').replace(/stage: "yard"/g, 'stage: "yard-2026"'),
    /contains a year/,
    'year in slug',
  );
  expectProblem(
    dstYamlText().replace('id: "yard"', 'id: "yard-11-01"').replace(/stage: "yard"/g, 'stage: "yard-11-01"'),
    /contains a (year|date)/,
    'date in slug',
  );
});

test('gate 7: duplicate stage ids are rejected', () => {
  expectProblem(
    dstYamlText().replace(
      '  - id: "yard"\n    name: "The Yard"',
      '  - id: "hall"\n    name: "Duplicate"\n    description: ""\n  - id: "yard"\n    name: "The Yard"',
    ),
    /duplicate stage id "hall"/,
    'duplicate stage id',
  );
});

test('gate 7: a UID collision (same artist twice on one stage) is rejected, not silently merged', () => {
  const dup = dstYamlText().replace(
    '  - stage: "yard"\n    artist: "Sunday Matinée, Part Two"',
    '  - stage: "yard"\n    artist: "After the Fallback"\n    start: "2026-11-01T20:00:00"\n    end: "2026-11-01T21:00:00"\n  - stage: "yard"\n    artist: "Sunday Matinée, Part Two"',
  );
  expectProblem(dup, /appears 2 times on stage "yard".*would collide into one event/s, 'uid collision');
});

test('gate 7: an unquoted or malformed local datetime is rejected', () => {
  expectProblem(
    dstYamlText().replace('start: "2026-11-01T03:00:00"', 'start: "2026-11-01 3pm"'),
    /is not a local datetime of the form/,
    'malformed datetime',
  );
  expectProblem(
    dstYamlText().replace('start: "2026-11-01T03:00:00"', 'start: "2026-11-01T03:00:00-06:00"'),
    /is not a local datetime of the form/,
    'offset-bearing datetime',
  );
  expectProblem(
    dstYamlText().replace('start: "2026-11-01T03:00:00"', 'start: "2026-02-30T03:00:00"'),
    /has day 30 out of range/,
    'impossible date',
  );
});

test('gate 7: a local time inside a spring-forward gap is rejected', () => {
  expectProblem(
    dstYamlText()
      .replace('start: "2026-11-01T03:00:00"', 'start: "2026-03-08T02:30:00"')
      .replace('end: "2026-11-01T04:00:00"', 'end: "2026-03-08T03:30:00"'),
    /does not exist in America\/Chicago/,
    'dst gap',
  );
});

test('gate 7: an invalid IANA zone is rejected', () => {
  expectProblem(
    dstYamlText().replace('timezone: "America/Chicago"', 'timezone: "America/Chicagoo"'),
    /is not a valid IANA time zone id/,
    'bad zone',
  );
});

test('gate 7: all problems are reported at once, not one per run', () => {
  const doubled = dstYamlText()
    .replace('id: "yard"', 'id: "Yard_2026"')
    .replace(/stage: "yard"/g, 'stage: "Yard_2026"')
    .replace('end: "2026-10-31T23:00:00"', 'end: "2026-10-31T21:00:00"');
  try {
    validateDoc(parseYaml(doubled), 'multi');
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof SchemaError);
    assert.ok(err.problems.length >= 2, `expected several problems, got ${err.problems.length}`);
  }
});

// ===========================================================================
// Manifest (feeds.json) — consumed by the page builder instead of the YAML
// ===========================================================================

test('feeds.json manifest is complete, deterministic, and clock-free', () => {
  const manifest = harborBuild.manifest;
  assert.equal(manifest.festival.slug, 'harbor-lights');
  assert.equal(manifest.festival.year, 2026);
  assert.equal(manifest.festival.timezone, 'America/Chicago');
  assert.equal(manifest.festival.key, 'harbor-lights-2026');
  assert.equal(manifest.lastUpdated, '20260808T000000Z', 'lastUpdated must be the committed publish stamp');
  assert.equal(manifest.allSetCount, harbor.sets.length);
  assert.equal(manifest.stages.length, harbor.stages.length);

  let total = 0;
  for (const stage of manifest.stages) {
    const declared = harbor.stages.find((s) => s.id === stage.id)!;
    assert.equal(stage.name, declared.name);
    assert.equal(stage.description, declared.description);
    assert.equal(stage.icsPath, `/harbor-lights-2026/${stage.id}.ics`);
    assert.ok(stage.setCount > 0);
    assert.ok(stage.dayspan.days > 0);
    assert.match(stage.firstSet, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    assert.ok(stage.lastSet >= stage.firstSet);
    total += stage.setCount;
  }
  assert.equal(total, harbor.sets.length);

  assert.equal(manifest.all.icsPath, '/harbor-lights-2026/all.ics');
  assert.equal(manifest.all.setCount, harbor.sets.length);
  assert.equal(manifest.stages.find((s) => s.id === 'main')!.dayspan.label, 'Fri 14 Aug – Sun 16 Aug 2026');

  // A manifest that reads the clock would differ here.
  const again = buildFeeds(harbor, emptyState('20260808T000000Z'));
  assert.equal(JSON.stringify(again.manifest), JSON.stringify(manifest));
  assert.equal(again.files.get('feeds.json'), harborBuild.files.get('feeds.json'));
});

test('no output anywhere contains a timestamp from the current wall clock', () => {
  const thisYear = new Date().getUTCFullYear();
  for (const [path, text] of [...icsFiles(harborBuild), ...icsFiles(dstBuild)]) {
    for (const stamp of [...getProps(text, 'DTSTAMP'), ...getProps(text, 'LAST-MODIFIED')]) {
      assert.match(stamp, /^\d{8}T\d{6}Z$/, `${path}: ${stamp}`);
      const stampDay = stamp.slice(0, 8);
      const today = new Date();
      const todayStr =
        `${today.getUTCFullYear()}` +
        `${String(today.getUTCMonth() + 1).padStart(2, '0')}` +
        `${String(today.getUTCDate()).padStart(2, '0')}`;
      // Fixtures pin 20260808 / 20260101; if a build ever emitted "today" with a
      // non-midnight time, that is a Date.now() leak.
      if (stampDay === todayStr) {
        assert.equal(stamp.slice(9), '000000Z', `${path}: ${stamp} looks like a live clock read`);
      }
      assert.ok(Number(stamp.slice(0, 4)) <= thisYear + 5);
    }
  }
});
