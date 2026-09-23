/**
 * Weekends (ticket 22). A festival whose days fall in more than one run —
 * ACL, Coachella — is one edition, and a stage that plays both weekends is
 * two stages in it: one id, one feed, one calendar per weekend, because the
 * UID is per stage and the same act plays both. This file pins the whole
 * path: how the transcription decides the weekends and the ids, what the
 * schema accepts, what the build and the calendar names say, what the page
 * shows, and the real ACL 2026 read that started it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { transcribe, type ModelOutput } from '../src/transcription.js';
import { disambiguateRepeats, weekendsOf, type BuiltSet, type RawTranscription } from '../src/transcribe.js';
import { loadFestivalFromString, normalizeArtist, SchemaError } from '../src/schema.js';
import { buildFeeds, feedLabel, stageCountOf } from '../src/build.js';
import { editionDates, renderLandingPage, renderSubscribePage } from '../src/pages.js';
import { GOLDEN_PUBLISHED_AT, REPO_ROOT, buildFixtureSite, docFromText, harborDoc, visibleText } from './helpers.js';

const OPTS = { namespace: 'fan' as const, timezone: 'America/Chicago' };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** One weekend of a small festival, as the model would read it, on the given Friday and Saturday. */
function weekendRaw(friday: string, saturday: string, header: string): RawTranscription {
  return {
    festival_name: 'TIDEWATER',
    official_url: 'TIDEWATER.EXAMPLE',
    days: [
      {
        date: friday,
        header: `FRIDAY ${header}`,
        stages: [
          {
            name: 'MAIN STAGE',
            sets: [
              { artist: 'AVERY COCHRANE', time: '3:00-4:00PM' },
              { artist: 'MUNA', time: '8:00-9:00PM' },
            ],
          },
          { name: 'CELLAR STAGE', sets: [{ artist: 'DARK CHISME', time: '9:00-10:00PM' }] },
        ],
      },
      {
        date: saturday,
        header: `SATURDAY ${header}`,
        stages: [
          {
            name: 'MAIN STAGE',
            sets: [
              { artist: 'AVERY COCHRANE', time: '3:00-4:00PM' },
              { artist: 'DISCO LINES', time: '8:00-9:00PM' },
            ],
          },
          { name: 'CELLAR STAGE', sets: [{ artist: 'BAZAAR', time: '9:00-10:00PM' }] },
        ],
      },
    ],
  };
}

function outputs(...raws: RawTranscription[]): ModelOutput[] {
  return raws.map((raw, i) => ({ source: `week-${i + 1}.png`, output: raw }));
}

/** The same festival over two weekends a week apart, one image per weekend. */
function twoWeekends(): ModelOutput[] {
  return outputs(weekendRaw('2026-08-07', '2026-08-08', 'AUGUST 7-8'), weekendRaw('2026-08-14', '2026-08-15', 'AUGUST 14-15'));
}

/** A hand-written two-weekend edition, the way the transcription would commit it. */
const TIDEWATER_YAML = `
namespace: owner
festival:
  name: "Tidewater"
  slug: "tidewater"
  year: 2026
  timezone: "America/Chicago"
  official_url: "https://tidewater.example/"
stages:
  - id: "main-weekend-1"
    name: "Main Stage"
    weekend: "Weekend 1"
  - id: "cellar-weekend-1"
    name: "Cellar Stage"
    weekend: "Weekend 1"
  - id: "main-weekend-2"
    name: "Main Stage"
    weekend: "Weekend 2"
  - id: "cellar-weekend-2"
    name: "Cellar Stage"
    weekend: "Weekend 2"
sets:
  - { stage: "main-weekend-1", artist: "MUNA", start: "2026-08-07T20:00:00", end: "2026-08-07T21:00:00" }
  - { stage: "cellar-weekend-1", artist: "DARK CHISME", start: "2026-08-07T21:00:00", end: "2026-08-07T22:00:00" }
  - { stage: "main-weekend-1", artist: "DISCO LINES", start: "2026-08-08T20:00:00", end: "2026-08-08T21:00:00" }
  - { stage: "main-weekend-2", artist: "MUNA", start: "2026-08-14T20:00:00", end: "2026-08-14T21:00:00" }
  - { stage: "cellar-weekend-2", artist: "DARK CHISME", start: "2026-08-14T21:00:00", end: "2026-08-14T22:00:00" }
  - { stage: "main-weekend-2", artist: "DISCO LINES", start: "2026-08-15T20:00:00", end: "2026-08-15T21:00:00" }
`;

function tidewaterBuild() {
  return buildFeeds(docFromText(TIDEWATER_YAML, 'tidewater'), { publishedAt: GOLDEN_PUBLISHED_AT, sequences: {} });
}

function builtSet(stage: string, artist: string, start: string): BuiltSet {
  return {
    stage,
    artist,
    raw: artist,
    start,
    end: start.slice(0, 11) + '23:00:00',
    end_inferred: false,
    notes: '',
    posterDate: start.slice(0, 10),
    source: 'x.png',
    printedTime: '',
    crossesMidnight: false,
  };
}

// ---------------------------------------------------------------------------
// Deciding the weekends
// ---------------------------------------------------------------------------

test('weekendsOf: one run of days is one weekend, whatever the order they come in', () => {
  assert.deepEqual(weekendsOf(['2026-08-08', '2026-08-07', '2026-08-09']), [['2026-08-07', '2026-08-08', '2026-08-09']]);
  assert.deepEqual(weekendsOf(['2026-08-07']), [['2026-08-07']]);
  assert.deepEqual(weekendsOf([]), []);
});

test('weekendsOf: a week apart is two weekends; up to two dark days is still one', () => {
  assert.deepEqual(weekendsOf(['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-09', '2026-10-10', '2026-10-11']), [
    ['2026-10-02', '2026-10-03', '2026-10-04'],
    ['2026-10-09', '2026-10-10', '2026-10-11'],
  ]);
  assert.deepEqual(weekendsOf(['2026-10-02', '2026-10-05']), [['2026-10-02', '2026-10-05']], 'two dark days between');
  assert.deepEqual(weekendsOf(['2026-10-02', '2026-10-06']), [['2026-10-02'], ['2026-10-06']], 'three dark days is a gap');
});

// ---------------------------------------------------------------------------
// Transcription: the ids carry the weekend
// ---------------------------------------------------------------------------

test('transcribe: two weekends make one edition whose stage ids carry the weekend, so the same act on the same stage both weekends is two events', () => {
  const t = transcribe(twoWeekends(), OPTS);
  assert.deepEqual(
    t.edition.stages.map((s) => [s.id, s.name, s.weekend]),
    [
      ['main-weekend-1', 'Main Stage', 'Weekend 1'],
      ['cellar-weekend-1', 'Cellar Stage', 'Weekend 1'],
      ['main-weekend-2', 'Main Stage', 'Weekend 2'],
      ['cellar-weekend-2', 'Cellar Stage', 'Weekend 2'],
    ],
    'the first weekend\'s stages come first, in printed order, then the second\'s',
  );
  const muna = t.sets.filter((s) => s.artist === 'MUNA');
  assert.deepEqual(muna.map((s) => [s.stage, s.start]), [
    ['main-weekend-1', '2026-08-07T20:00:00'],
    ['main-weekend-2', '2026-08-14T20:00:00'],
  ]);
  assert.equal(new Set(t.sets.map((s) => `${s.stage}\0${normalizeArtist(s.artist)}`)).size, t.sets.length, 'every set has its own UID key');
  assert.match(t.yaml, /- id: "main-weekend-1"[^\n]*\n\s+name: "Main Stage"\n\s+weekend: "Weekend 1"/);
  assert.match(t.yaml, /# Two weekends \(or more\)/, 'the YAML says why a stage appears twice');
  assert.doesNotThrow(() => loadFestivalFromString(t.yaml, 'two weekends'));
});

test('transcribe: a repeat within one weekend is still told apart by the day, and the other weekend does not count as a repeat', () => {
  const t = transcribe(twoWeekends(), OPTS);
  const avery = t.sets.filter((s) => s.printedArtist === 'AVERY COCHRANE');
  assert.deepEqual(
    avery.map((s) => [s.stage, s.artist]),
    [
      ['main-weekend-1', 'AVERY COCHRANE (Friday)'],
      ['main-weekend-1', 'AVERY COCHRANE (Saturday)'],
      ['main-weekend-2', 'AVERY COCHRANE (Friday)'],
      ['main-weekend-2', 'AVERY COCHRANE (Saturday)'],
    ],
    'the weekday is enough inside a weekend: the weekend is in the stage',
  );
  assert.match(t.log, /### \d+\. 2 weekends\n\n[\s\S]*- Weekend 1: 2026-08-07 → 2026-08-08 \(2 stages: main-weekend-1, cellar-weekend-1\)\n- Weekend 2: 2026-08-14 → 2026-08-15/);
  assert.doesNotMatch(t.log, /### \d+\. Artists billed more than once/, 'the same stage on the other weekend is the norm, not an ambiguity');
});

test('transcribe: an act on different stages across the weekends is still listed as billed more than once', () => {
  const [w1, w2] = twoWeekends() as [ModelOutput, ModelOutput];
  (w2.output as RawTranscription).days[0]!.stages[1]!.sets.push({ artist: 'MUNA', time: '10:00-11:00PM' });
  const t = transcribe([w1, w2], OPTS);
  assert.match(t.log, /### \d+\. Artists billed more than once[\s\S]*- MUNA: main-weekend-1 2026-08-07T20:00:00, main-weekend-2 2026-08-14T20:00:00, cellar-weekend-2 2026-08-14T22:00:00/);
});

test('transcribe: one run of days is the ordinary festival — plain ids, no weekend anywhere', () => {
  const t = transcribe(outputs(weekendRaw('2026-08-07', '2026-08-08', 'AUGUST 7-8')), OPTS);
  assert.deepEqual(t.edition.stages.map((s) => s.id), ['main', 'cellar']);
  assert.ok(t.edition.stages.every((s) => s.weekend === undefined));
  assert.doesNotMatch(t.yaml, /weekend/i);
  assert.doesNotMatch(t.log, /weekends/);
});

// ---------------------------------------------------------------------------
// Telling repeats apart: the least a reader needs
// ---------------------------------------------------------------------------

test('disambiguateRepeats: the weekday when the days differ; the date too when two days share a weekday', () => {
  const byDay = [builtSet('main', 'SILENT DISCO', '2026-10-02T20:00:00'), builtSet('main', 'SILENT DISCO', '2026-10-03T20:00:00')];
  disambiguateRepeats(byDay);
  assert.deepEqual(byDay.map((s) => s.artist), ['SILENT DISCO (Friday)', 'SILENT DISCO (Saturday)']);

  const twoFridays = [builtSet('main', 'JESSE WELLES', '2026-10-02T16:15:00'), builtSet('main', 'JESSE WELLES', '2026-10-09T16:15:00')];
  disambiguateRepeats(twoFridays);
  assert.deepEqual(twoFridays.map((s) => s.artist), ['JESSE WELLES (Friday Oct 2)', 'JESSE WELLES (Friday Oct 9)'], 'a weekday alone would collide');
  assert.match(twoFridays[0]!.notes, /"\(Friday Oct 2\)" tells the events apart/);
});

test('disambiguateRepeats: two on one day carry the start as well, and the whole group reads one way', () => {
  const sameDay = [
    builtSet('kids', 'SCHOOL OF ROCK', '2026-10-03T13:30:00'),
    builtSet('kids', 'SCHOOL OF ROCK', '2026-10-03T16:30:00'),
    builtSet('kids', 'SCHOOL OF ROCK', '2026-10-04T13:30:00'),
  ];
  disambiguateRepeats(sameDay);
  assert.deepEqual(sameDay.map((s) => s.artist), [
    'SCHOOL OF ROCK (Saturday 1:30 PM)',
    'SCHOOL OF ROCK (Saturday 4:30 PM)',
    'SCHOOL OF ROCK (Sunday 1:30 PM)',
  ]);

  const sameDayTwoFridays = [
    builtSet('kids', 'SCHOOL OF ROCK', '2026-10-02T13:30:00'),
    builtSet('kids', 'SCHOOL OF ROCK', '2026-10-02T16:30:00'),
    builtSet('kids', 'SCHOOL OF ROCK', '2026-10-09T13:30:00'),
  ];
  disambiguateRepeats(sameDayTwoFridays);
  assert.deepEqual(sameDayTwoFridays.map((s) => s.artist), [
    'SCHOOL OF ROCK (Friday Oct 2 1:30 PM)',
    'SCHOOL OF ROCK (Friday Oct 2 4:30 PM)',
    'SCHOOL OF ROCK (Friday Oct 9 1:30 PM)',
  ]);
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

test('schema: `weekend` is display only and either every stage names one or none does', () => {
  const doc = docFromText(TIDEWATER_YAML, 'tidewater');
  assert.equal(doc.stages[0]!.weekend, 'Weekend 1');
  assert.equal(doc.stages[3]!.weekend, 'Weekend 2');

  const half = TIDEWATER_YAML.replace('    weekend: "Weekend 2"\n  - id: "cellar-weekend-2"', '  - id: "cellar-weekend-2"');
  assert.throws(
    () => docFromText(half, 'half'),
    (err: unknown) => err instanceof SchemaError && /3 of 4 stages name a `weekend`/.test(err.message),
  );
});

// ---------------------------------------------------------------------------
// Build: calendar names and the manifest
// ---------------------------------------------------------------------------

test('build: a weekend stage\'s calendar is named with its weekend, so two calendars for one stage read apart', () => {
  assert.equal(feedLabel({ name: 'T-Mobile', weekend: 'Weekend 1' }), 'T-Mobile (Weekend 1)');
  assert.equal(feedLabel({ name: 'T-Mobile' }), 'T-Mobile');
  const { files } = tidewaterBuild();
  assert.match(files.get('tidewater-2026/main-weekend-1.ics')!, /X-WR-CALNAME:Main Stage \(Weekend 1\) — Tidewater 26/);
  assert.match(files.get('tidewater-2026/main-weekend-2.ics')!, /X-WR-CALNAME:Main Stage \(Weekend 2\) — Tidewater 26/);
  assert.match(files.get('tidewater-2026/main-weekend-1.ics')!, /LOCATION:Main Stage\r\n/, 'the event\'s place is still the stage');
});

test('build: the manifest lists the weekends in order with their own days and counts', () => {
  const { manifest } = tidewaterBuild();
  assert.deepEqual(
    manifest.weekends!.map((w) => [w.name, w.dayspan.first, w.dayspan.last, w.stageCount, w.setCount]),
    [
      ['Weekend 1', '2026-08-07', '2026-08-08', 2, 3],
      ['Weekend 2', '2026-08-14', '2026-08-15', 2, 3],
    ],
  );
  assert.equal(manifest.stages.find((s) => s.id === 'cellar-weekend-2')!.weekend, 'Weekend 2');
  assert.equal(stageCountOf(manifest.stages), 2, 'a stage on both weekends counts once');
  assert.equal(buildFeeds(harborDoc(), { publishedAt: GOLDEN_PUBLISHED_AT, sequences: {} }).manifest.weekends, undefined, 'one run of days has none');
});

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

test('subscribe page: with two weekends the reader picks the weekend first, then its stages', () => {
  const html = renderSubscribePage(tidewaterBuild().manifest);
  const text = visibleText(html);
  assert.match(text, /Pick your weekend/);
  const pills = html.match(/<a class="btn btn--tonal btn--sm" href="#weekend-\d" data-weekend="\d" aria-pressed="(true|false)">[^<]+<\/a>/g) ?? [];
  assert.deepEqual(
    pills.map((p) => p.replace(/<[^>]+>/g, '')),
    ['Weekend 1', 'Weekend 2'],
  );
  assert.match(pills[0]!, /aria-pressed="true"/, 'the first weekend is up');
  assert.match(html, /<div id="weekend-1" data-weekend-panel="0">\s*<p class="eyebrow">Weekend 1 · Fri 7 Aug – Sat 8 Aug<\/p>/);
  assert.match(html, /<div id="weekend-2" data-weekend-panel="1">\s*<p class="eyebrow">Weekend 2 · Fri 14 Aug – Sat 15 Aug<\/p>/);
  const panel1 = html.slice(html.indexOf('id="weekend-1"'), html.indexOf('id="weekend-2"'));
  assert.match(panel1, /data-stage="main-weekend-1"/);
  assert.doesNotMatch(panel1, /data-stage="main-weekend-2"/, 'each weekend shows its own stages');
  assert.match(text, /Aug 7–8 &amp; Aug 14–15, 2026 · 6 sets · 2 stages/, 'the caption is the short form and counts a stage once');
  assert.match(text, /every stage, both weekends, in one calendar/);
  assert.match(text, /All two at once/);
});

test('subscribe page: a stage keeps its color across weekends — color is identity', () => {
  const html = renderSubscribePage(tidewaterBuild().manifest);
  const colorOf = (id: string) => new RegExp(`<li class="stage-card" style="background:(#[0-9a-f]{6})">(?:(?!</li>)[\\s\\S])*data-stage="${id}"`, 'i').exec(html)![1];
  assert.equal(colorOf('main-weekend-1'), colorOf('main-weekend-2'));
  assert.equal(colorOf('cellar-weekend-1'), colorOf('cellar-weekend-2'));
  assert.notEqual(colorOf('main-weekend-1'), colorOf('cellar-weekend-1'));
});

test('subscribe page: one run of days has no weekend to pick', () => {
  const html = renderSubscribePage(buildFeeds(harborDoc(), { publishedAt: GOLDEN_PUBLISHED_AT, sequences: {} }).manifest);
  assert.doesNotMatch(html, /data-weekend="/, 'no pills and no panels');
  assert.doesNotMatch(visibleText(html), /weekend/i);
  assert.match(visibleText(html), /Pick your stages/);
});

test('subscribe page: a phone swipes the stages, a wide screen stacks them two to a row', () => {
  for (const html of [renderSubscribePage(tidewaterBuild().manifest), renderSubscribePage(buildFeeds(harborDoc(), { publishedAt: GOLDEN_PUBLISHED_AT, sequences: {} }).manifest)]) {
    assert.match(html, /\.carousel\{[^}]*scroll-snap-type:x mandatory/, 'the phone keeps the carousel');
    assert.match(html, /<main class="wrap wrap--wide">/, 'the subscribe page opts into the wide column');
    const wide = /@media \(min-width:735px\)\{\s*\.wrap--wide\{[^@]*?\n\}/.exec(html)?.[0] ?? '';
    assert.match(wide, /\.wrap--wide\{max-width:calc\(980px \+ 2 \* var\(--margin\)\)\}/, 'from tablet up the column is the Store’s 980');
    assert.match(wide, /\.carousel,\.carousel-tail\{display:grid; grid-template-columns:repeat\(2, minmax\(0, 1fr\)\)/, 'two stages to a row, the all-stages card one column wide');
    assert.match(wide, /\.carousel\{[^}]*overflow:visible; scroll-snap-type:none\}/, 'no sideways scrolling on a wide screen');
    assert.match(wide, /\.wrap--wide \.weekends[^{]*\{max-width:calc\(var\(--measure\) - 2 \* var\(--margin\)\)\}/, 'the pills keep the phone measure');
  }
});

test('subscribe page: the stage name sits clear of the art', () => {
  const html = renderSubscribePage(tidewaterBuild().manifest);
  assert.match(html, /\.stage-body\{padding:var\(--gap-1\) var\(--pad-card\) var\(--pad-card\)\}/, '8px over the heading, 12px visible with its ascent');
});

test('directory card: the dates say both weekends and the stages are counted once', () => {
  const doc = docFromText(TIDEWATER_YAML, 'tidewater');
  const site = buildFixtureSite([doc], { 'tidewater-2026': { listed: true } }).site;
  assert.equal(editionDates(site.editions[0]!), 'Aug 7–8 & Aug 14–15, 2026');
  const text = visibleText(renderLandingPage(site, { images: { 'tidewater-2026': '/assets/festivals/tidewater-2026.webp' } }));
  assert.match(text, /Aug 7–8 &amp; Aug 14–15, 2026/);
  assert.match(text, /6 sets across 2 stages\./);
});

// ---------------------------------------------------------------------------
// The real thing: ACL 2026, both weekends, as the link read them
// ---------------------------------------------------------------------------

const ACL_IMAGES = {
  'weekend one, Friday': '0ab0af7388768eb85f2c27dc7df9e377d05e89576e636875a8cd4871f5fb7c76',
  'weekend one, Saturday': '46916bec47d9fd478b89b660682c3bd2d646d2879299f0769fce54a442d34f42',
  'weekend one, Sunday': 'c5acb7ea9ded8534f582218a0ee22e1ef2411d8d8b75ea574cb24453326d36c9',
  'weekend two, Friday': '74085829f9a3ab9e8e3896753c49b0942b34428406a9d76783b96cf73673f7d3',
  'weekend two, Saturday': '1393eab849860378263657bae1362226059cf0eddbb66979a657a26e09d513e2',
  'weekend two, Sunday': '01edeabfdd8da54bbd8f0822d3486c40b3f504a5bbff03dcc68f4943fb3bab4b',
};

function aclOutputs(): ModelOutput[] | null {
  const outputs: ModelOutput[] = [];
  for (const [label, hash] of Object.entries(ACL_IMAGES)) {
    const path = join(REPO_ROOT, 'state', 'transcriptions', `${hash}.json`);
    if (!existsSync(path)) return null;
    const saved = JSON.parse(readFileSync(path, 'utf8')) as { output: unknown };
    outputs.push({ source: label, output: saved.output });
  }
  return outputs;
}

test('ACL 2026: the six stored replies — both weekends off one schedule page — publish as one edition with a stage per weekend', () => {
  const outputs = aclOutputs();
  if (!outputs) return; // the stored replies are committed state; nothing to pin without them
  const t = transcribe(outputs, { namespace: 'owner', timezone: 'America/Chicago', officialUrl: 'https://www.aclfestival.com/' });
  assert.equal(t.sets.length, 207);
  assert.equal(t.edition.stages.length, 16, 'eight stages, twice');
  assert.equal(stageCountOf(t.edition.stages), 8);
  assert.ok(t.edition.stages.every((s) => s.weekend === 'Weekend 1' || s.weekend === 'Weekend 2'));
  assert.deepEqual(
    t.edition.stages.filter((s) => s.id.startsWith('t-mobile')).map((s) => [s.id, s.weekend]),
    [
      ['t-mobile-weekend-1', 'Weekend 1'],
      ['t-mobile-weekend-2', 'Weekend 2'],
    ],
  );
  const welles = t.sets.filter((s) => s.artist === 'JESSE WELLES');
  assert.deepEqual(welles.map((s) => [s.stage, s.start]), [
    ['t-mobile-weekend-1', '2026-10-02T16:15:00'],
    ['t-mobile-weekend-2', '2026-10-09T16:15:00'],
  ]);
  const discos = t.sets.filter((s) => s.printedArtist === 'SILENT DISCO');
  assert.deepEqual(
    discos.map((s) => `${s.stage} ${s.artist}`),
    [
      'tito-s-handmade-vodka-weekend-1 SILENT DISCO (Friday)',
      'tito-s-handmade-vodka-weekend-1 SILENT DISCO (Saturday)',
      'tito-s-handmade-vodka-weekend-1 SILENT DISCO (Sunday)',
      'tito-s-handmade-vodka-weekend-2 SILENT DISCO (Friday)',
      'tito-s-handmade-vodka-weekend-2 SILENT DISCO (Saturday)',
      'tito-s-handmade-vodka-weekend-2 SILENT DISCO (Sunday)',
    ],
  );

  const { manifest, files } = buildFeeds(t.edition, { publishedAt: GOLDEN_PUBLISHED_AT, sequences: {} });
  assert.deepEqual(
    manifest.weekends!.map((w) => [w.name, w.dayspan.first, w.dayspan.last]),
    [
      ['Weekend 1', '2026-10-02', '2026-10-04'],
      ['Weekend 2', '2026-10-09', '2026-10-11'],
    ],
  );
  assert.match(files.get('austin-city-limits-music-festival-25-years-2026/t-mobile-weekend-2.ics')!, /X-WR-CALNAME:T-mobile \(Weekend 2\)/);
  const text = visibleText(renderSubscribePage(manifest));
  assert.match(text, /Pick your weekend Weekend 1 Weekend 2 Weekend 1 · Fri 2 Oct – Sun 4 Oct/);
  assert.match(text, /207 sets · 8 stages/);
});
