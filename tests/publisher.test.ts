/**
 * The publisher seam: an intent plus fake ports in, writes out.
 *
 * Everything here runs with no network, no model and no clock: the vision port
 * replays a recorded reply and counts what it was asked for, the repository is
 * in memory, and time and randomness are fixtures. What each test asserts on is
 * what crossed the seam — the commit, the review payload, the
 * reason a gate gave — never how the module is arranged inside.
 *
 * The two intents covered are the two that make an edition exist: upload and
 * confirm, both carrying the owner's secret. What happens without it is
 * tests/publisher-owner.test.ts; the link intent is tests/publisher-link.test.ts.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GATE_COPY,
  confirm,
  icalStamp,
  publish,
  sha256,
  upload,
  type ConfirmIntent,
  type Review,
  type UploadIntent,
} from '../src/publisher.js';
import { buildSite, type PublishedFile } from '../src/build.js';
import { loadFestivalFromString } from '../src/schema.js';
import {
  fakeClock,
  fakePorts,
  fakeRepository,
  fakeVision,
  FIXED_NOW_STAMP,
  image,
  OWNER_SECRET,
  recordedReply,
  type Fakes,
} from './publisher-fakes.js';

function uploadIntent(overrides: Partial<UploadIntent> = {}): UploadIntent {
  return {
    kind: 'upload',
    festival: 'Low Tide',
    dates: { first: '2026-10-09', last: '2026-10-09' },
    image: image(),
    owner: OWNER_SECRET,
    ...overrides,
  };
}

function confirmIntent(review: Review, overrides: Partial<ConfirmIntent> = {}): ConfirmIntent {
  return {
    kind: 'confirm',
    image: image(),
    festival: 'Low Tide',
    owner: OWNER_SECRET,
    timezone: review.timezone,
    timezoneAssumed: review.timezoneAssumed,
    edits: [],
    unverifiable: [],
    ...overrides,
  };
}

/** Upload, assert it got through, hand back the review and the ports. */
async function reviewOf(ports: Fakes = fakePorts(), intent = uploadIntent()): Promise<{ review: Review; ports: Fakes }> {
  const result = await upload(intent, ports);
  assert.ok(result.ok, `upload was rejected: ${result.rejection?.reason}`);
  return { review: result.review!, ports };
}

// ---------------------------------------------------------------------------
// The pre-spend gates
// ---------------------------------------------------------------------------

test('gate: a file that is not an image is refused, with a plain reason and no vision spend', async () => {
  const ports = fakePorts();
  const result = await upload(uploadIntent({ image: image({ contentType: 'application/pdf' }) }), ports);
  assert.equal(result.ok, false);
  assert.equal(result.rejection!.gate, 'type');
  assert.equal(result.rejection!.reason, "That file isn't an image. A screenshot or a photo of the schedule works.");
  assert.equal(ports.vision.checks, 0, 'no model was asked anything');
  assert.equal(ports.vision.transcriptions, 0, 'nothing was spent');
  assert.deepEqual(ports.repo.commits, [], 'nothing was written');
});

test('gate: an image over the size limit is refused, with a plain reason and no vision spend', async () => {
  const ports = fakePorts();
  const big = image({ bytes: new Uint8Array(11 * 1024 * 1024) });
  const result = await upload(uploadIntent({ image: big }), ports);
  assert.equal(result.ok, false);
  assert.equal(result.rejection!.gate, 'size');
  assert.match(result.rejection!.reason, /^That image is 11 MB\. 10 MB is the most I can take/);
  assert.equal(ports.vision.checks + ports.vision.transcriptions, 0, 'nothing was spent');
});

test('gate: an image too small to read the times off is refused, with no vision spend', async () => {
  const ports = fakePorts();
  const result = await upload(uploadIntent({ image: image({ width: 320, height: 240 }) }), ports);
  assert.equal(result.ok, false);
  assert.equal(result.rejection!.gate, 'dimensions');
  assert.match(result.rejection!.reason, /240 pixels on its short side\. Under 400 there is nothing legible/);
  assert.equal(ports.vision.checks + ports.vision.transcriptions, 0, 'nothing was spent');
});

test('gate: an image that is not a schedule is refused after the cheap check and before the spend', async () => {
  const ports = fakePorts({ vision: fakeVision({ isSchedule: false }) });
  const result = await upload(uploadIntent(), ports);
  assert.equal(result.ok, false);
  assert.equal(result.rejection!.gate, 'schedule');
  assert.equal(
    result.rejection!.reason,
    "I can't find set times on that image. It needs the schedule with the times on it, not the lineup.",
  );
  assert.equal(ports.vision.checks, 1, 'the cheap check ran');
  assert.equal(ports.vision.transcriptions, 0, 'the expensive call did not');
  assert.deepEqual(ports.repo.commits, [], 'a rejected image writes nothing');
});

test('gate: what was typed is checked before anything is spent', async () => {
  const ports = fakePorts();
  for (const [intent, expected] of [
    [uploadIntent({ festival: '   ' }), "Type the festival's name first."],
    [uploadIntent({ dates: { first: '9 Oct', last: '2026-10-09' } }), "Those dates don't look right. Give the day it starts and the day it ends."],
    [uploadIntent({ timezone: 'Mars/Olympus' }), "That time zone isn't one I know."],
  ] as const) {
    const result = await upload(intent, ports);
    assert.equal(result.ok, false, `${expected} should have been refused`);
    assert.equal(result.rejection!.gate, 'details');
    assert.equal(result.rejection!.reason, expected);
  }
  assert.equal(ports.vision.checks + ports.vision.transcriptions, 0, 'nothing was spent');
});

// ---------------------------------------------------------------------------
// The content-hash cache
// ---------------------------------------------------------------------------

test('cache: an image transcribed before comes back without calling the model', async () => {
  const ports = fakePorts();
  const first = await reviewOf(ports);
  assert.equal(ports.vision.transcriptions, 1);
  assert.equal(first.review.reused, false);

  const again = await upload(uploadIntent(), ports);
  assert.ok(again.ok, again.rejection?.reason);
  assert.equal(ports.vision.transcriptions, 1, 'the second upload cost no vision call');
  assert.equal(ports.vision.checks, 1, 'and not even the cheap check');
  assert.equal(again.reused, true);
  assert.equal(again.review!.reused, true);
  assert.equal(again.commit, null, 'a free retry writes nothing');
  assert.deepEqual(again.review!.sets, first.review.sets, 'the saved reading, set for set');
});

test('cache: the model reply is saved verbatim under the image content hash', async () => {
  const ports = fakePorts();
  await reviewOf(ports);
  const hash = sha256(image().bytes);
  const saved = JSON.parse(ports.repo.file(`state/transcriptions/${hash}.json`)!) as {
    image: string;
    output: string;
    transcribedAt: string;
    filename: string;
  };
  assert.equal(saved.image, hash);
  assert.equal(saved.output, recordedReply(), 'verbatim — the reply is the audit trail');
  assert.equal(saved.transcribedAt, FIXED_NOW_STAMP);
  assert.equal(saved.filename, 'schedule.webp');
});

test('cache: a reading the library refuses is still saved, so fixing it and retrying is free', async () => {
  // A source with no web address on it: the schema needs one, so the upload is
  // refused — but the model has already been paid for, and the retry with the
  // link supplied must not pay again.
  const noUrl = JSON.parse(recordedReply()) as { official_url: string | null };
  noUrl.official_url = null;
  const ports = fakePorts({ vision: fakeVision({ reply: JSON.stringify(noUrl) }) });

  const refused = await upload(uploadIntent(), ports);
  assert.equal(refused.ok, false);
  assert.equal(refused.rejection!.gate, 'link', 'lands on the form, where the link can be typed');
  assert.equal(refused.rejection!.reason, GATE_COPY.noLink, "the page's sentence, not the CLI's flag");
  assert.doesNotMatch(refused.rejection!.reason, /--official-url|schema|URL/);
  assert.equal(ports.vision.transcriptions, 1);
  assert.ok(refused.commit, 'the reply that was paid for is on the record either way');

  const retry = await upload(uploadIntent({ officialUrl: 'https://lowtide.example' }), ports);
  assert.ok(retry.ok, retry.rejection?.reason);
  assert.equal(ports.vision.transcriptions, 1, 'the fix cost nothing');
  assert.equal(retry.reused, true);
});

// ---------------------------------------------------------------------------
// The review payload
// ---------------------------------------------------------------------------

test('review: every set carries its confidence flag, its inferred-end flag and the printed time', async () => {
  const { review } = await reviewOf();
  const muna = review.sets.find((s) => s.artist === 'MUNA')!;
  assert.equal(muna.endInferred, true, 'the source printed CLOSE, so the end is a guess');
  assert.equal(muna.printedTime, '10:40-CLOSE');
  assert.equal(muna.start, '2026-10-09T22:40:00');
  assert.equal(muna.end, '2026-10-10T00:10:00', 'the closer of its stage: an hour and a half, as a guess');
  assert.equal(muna.lowConfidence, false, 'the model was sure of this line');
  assert.equal(muna.unsure, '');

  const mgna = review.sets.find((s) => s.artist === 'MGNA CRRRTA')!;
  assert.equal(mgna.lowConfidence, true, 'the model said it was unsure of this line — look here');
  assert.equal(mgna.unsure, "three R's are printed, re-read twice", 'in its own few words');

  const avery = review.sets.find((s) => s.artist === 'AVERY COCHRANE')!;
  assert.equal(avery.endInferred, false);
  assert.equal(avery.lowConfidence, false);

  assert.deepEqual(
    review.sets.map((s) => s.index),
    [0, 1, 2, 3, 4],
    'index is printed order — what an edit and an unverifiable flag address',
  );
  assert.deepEqual(review.stages, [
    { id: 'main', name: 'Main Stage' },
    { id: 'cellar', name: 'Cellar Stage' },
  ]);
  assert.equal(review.sets.find((s) => s.artist === 'DARK CHISME')!.stageName, 'Cellar Stage');
});

test('review: the time zone is marked assumed until someone says otherwise', async () => {
  const { review } = await reviewOf();
  assert.equal(review.timezone, 'America/Los_Angeles');
  assert.equal(review.timezoneAssumed, true, 'no source image can carry this');

  const told = await upload(uploadIntent({ timezone: 'America/New_York' }), fakePorts());
  assert.equal(told.review!.timezone, 'America/New_York');
  assert.equal(told.review!.timezoneAssumed, false);
});

test("review: an upload of a festival on record reads in that festival's own zone, by the typed name or the printed one", async () => {
  const almanac = `
- festival: Low Tide
  source: https://lowtide.example/schedule
  timezone: America/New_York
  form: poster
  editions:
    - year: 2026
      dates: { first: 2026-10-09, last: 2026-10-11 }
`;
  const typed = await reviewOf(fakePorts({ repo: fakeRepository({ files: { 'config/festivals.yaml': almanac } }) }));
  assert.equal(typed.review.timezone, 'America/New_York', 'the typed name is on record');
  assert.equal(typed.review.timezoneOnRecord, true);
  assert.equal(typed.review.timezoneAssumed, false);

  const printed = await reviewOf(fakePorts({ repo: fakeRepository({ files: { 'config/festivals.yaml': almanac } }) }), uploadIntent({ festival: 'Tide Fest' }));
  assert.equal(printed.review.timezone, 'America/New_York', 'the name printed on the poster is on record even when the typed one is not');
  assert.equal(printed.review.timezoneOnRecord, true);

  const told = await reviewOf(fakePorts({ repo: fakeRepository({ files: { 'config/festivals.yaml': almanac } }) }), uploadIntent({ timezone: 'America/Denver' }));
  assert.equal(told.review.timezone, 'America/Denver', 'a zone someone gave wins over the record');
  assert.equal(told.review.timezoneOnRecord, false);

  const { review } = await reviewOf();
  assert.equal(review.timezoneOnRecord, false, 'no almanac, no record');
});

test('review: it says where the edition would live, and flags a year the source disagrees with', async () => {
  const { review } = await reviewOf();
  assert.equal(review.slug, 'low-tide');
  assert.equal(review.year, 2026);
  assert.equal(review.editionPath, 'low-tide-2026', 'at the root, the festival\'s own name');
  assert.equal(review.yearMismatch, false);

  const wrongYear = await upload(
    uploadIntent({ dates: { first: '2027-10-09', last: '2027-10-11' } }),
    fakePorts(),
  );
  assert.equal(wrongYear.review!.yearMismatch, true);
  assert.equal(wrongYear.review!.year, 2026, 'the source is what decides the year');
});

// ---------------------------------------------------------------------------
// confirm
// ---------------------------------------------------------------------------

test('confirm: a set marked as unverifiable blocks the publish', async () => {
  const { review, ports } = await reviewOf();
  const one = await confirm(confirmIntent(review, { unverifiable: [3] }), ports);
  assert.equal(one.ok, false);
  assert.equal(one.rejection!.gate, 'review');
  assert.equal(
    one.rejection!.reason,
    "One set is still marked as one you can't read. Check it against your image, then confirm.",
  );

  const two = await confirm(confirmIntent(review, { unverifiable: [1, 3] }), ports);
  assert.match(two.rejection!.reason, /^2 sets are still marked as ones you can't read\./);
  assert.equal(ports.repo.commits.length, 1, 'only the upload wrote anything');
});

test('confirm: an edited artist, start or end is published and each edit is recorded in the log', async () => {
  const { review, ports } = await reviewOf();
  const muna = review.sets.find((s) => s.artist === 'MUNA')!;
  const avery = review.sets.find((s) => s.artist === 'AVERY COCHRANE')!;
  const result = await confirm(
    confirmIntent(review, {
      edits: [
        { index: avery.index, artist: 'Avery Cochrane', start: '2026-10-09T15:20:00' },
        { index: muna.index, end: '2026-10-09T23:55:00' },
      ],
    }),
    ports,
  );
  assert.ok(result.ok, result.rejection?.reason);

  const yaml = ports.repo.file('data/low-tide-2026.yaml')!;
  const doc = loadFestivalFromString(yaml, 'committed');
  const edited = doc.sets.find((s) => s.artist === 'Avery Cochrane')!;
  assert.equal(edited.start.raw, '2026-10-09T15:20:00');
  assert.equal(doc.sets.find((s) => s.artist === 'MUNA')!.end.raw, '2026-10-09T23:55:00');
  assert.equal(doc.sets.find((s) => s.artist === 'MUNA')!.end_inferred, false, 'a typed-in end is no longer a guess');

  const log = ports.repo.file('source/low-tide-2026/TRANSCRIPTION.md')!;
  assert.match(log, /## Corrections made on review/);
  assert.match(log, /\| main \| AVERY COCHRANE \| artist \| AVERY COCHRANE \| Avery Cochrane \|/);
  assert.match(log, /\| main \| AVERY COCHRANE \| start \| 2026-10-09T15:15:00 \| 2026-10-09T15:20:00 \|/);
  assert.match(log, /\| main \| MUNA \| end \| 2026-10-10T00:10:00 \| 2026-10-09T23:55:00 \|/);
});

test('confirm: an edit that breaks the schedule is refused, and nothing is committed', async () => {
  const { review, ports } = await reviewOf();
  const avery = review.sets.find((s) => s.artist === 'AVERY COCHRANE')!;
  const result = await confirm(
    confirmIntent(review, { edits: [{ index: avery.index, end: '2026-10-09T15:00:00' }] }),
    ports,
  );
  assert.equal(result.ok, false);
  assert.equal(result.rejection!.gate, 'schema');
  assert.match(result.rejection!.reason, /end 2026-10-09T15:00:00 is before start/);
  assert.equal(ports.repo.commits.length, 1, 'the upload only');
});

test('confirm: every committed YAML passes the real schema loader, verified and at the root', async () => {
  const { review, ports } = await reviewOf();
  const result = await confirm(confirmIntent(review), ports);
  assert.ok(result.ok, result.rejection?.reason);

  const yaml = ports.repo.file('data/low-tide-2026.yaml')!;
  const doc = loadFestivalFromString(yaml, 'data/low-tide-2026.yaml');
  assert.equal(doc.verified, true, 'the owner checking every set is the human check');
  assert.equal(doc.namespace, 'owner');
  assert.equal(doc.festival.slug, 'low-tide');
  assert.equal(doc.festival.year, 2026);
  assert.equal(doc.sets.length, 5);
  assert.deepEqual(doc.stages.map((s) => s.id), ['main', 'cellar']);
});

test('confirm: the publish stamp is the injected clock, and the build takes it from there', async () => {
  const clock = fakeClock(Date.UTC(2026, 9, 9, 21, 5, 30));
  const { review, ports } = await reviewOf(fakePorts({ clock }));
  const result = await confirm(confirmIntent(review), ports);
  assert.ok(result.ok, result.rejection?.reason);

  const published = JSON.parse(ports.repo.file('state/published.json')!) as PublishedFile;
  assert.equal(published.publishedAt, '20261009T210530Z');
  assert.equal(published.publishedAt, icalStamp(clock.now()));

  // And the deterministic build reads that stamp rather than any clock.
  const doc = loadFestivalFromString(ports.repo.file('data/low-tide-2026.yaml')!, 'committed');
  const site = buildSite([doc], published, { editions: {} }, published.publishedAt);
  assert.equal(site.site.editions[0]!.lastUpdated, '20261009T210530Z');
  assert.equal(site.site.editions[0]!.festival.basePath, '/low-tide-2026');
});

test('confirm: the state update records the edition at the root, listed in the same commit', async () => {
  const { review, ports } = await reviewOf();
  const result = await confirm(confirmIntent(review), ports);
  assert.ok(result.ok, result.rejection?.reason);
  assert.equal(result.editionPath, 'low-tide-2026');

  const publish = ports.repo.commits.at(-1)!;
  assert.deepEqual(publish.files.map((f) => f.path), ['data/low-tide-2026.yaml', 'source/low-tide-2026/TRANSCRIPTION.md', 'state/published.json']);
  const published = JSON.parse(ports.repo.file('state/published.json')!) as PublishedFile;
  assert.deepEqual(published.editions['low-tide-2026'], {
    slug: 'low-tide',
    year: 2026,
    namespace: 'owner',
    listed: true,
    blocked: false,
    stages: ['cellar', 'main'],
  }, 'the owner tapping confirm is the listing; no record of who, because it is always the owner');
  assert.ok(!ports.repo.paths().some((p) => p.startsWith('data/fan/') || p.includes('/fan/')), 'nothing is ever written under fan/');
});

test('confirm: a root edition already published is refused, never overwritten and never suffixed', async () => {
  const repo = fakeRepository({
    published: {
      publishedAt: '20260101T000000Z',
      editions: {
        'low-tide-2026': { slug: 'low-tide', year: 2026, namespace: 'owner', listed: true, blocked: false, stages: ['main'] },
      },
    },
  });
  const ports = fakePorts({ repo });
  const up = await upload(uploadIntent(), ports);
  assert.equal(up.ok, false, 'the review would show a page that already exists');
  assert.equal(up.rejection!.gate, 'details');
  assert.match(up.rejection!.reason, /already has a page/);

  const { review } = await reviewOf(fakePorts());
  const commitsBefore = repo.commits.length;
  const result = await confirm(confirmIntent(review), ports);
  assert.equal(result.ok, false);
  assert.equal(result.rejection!.gate, 'details');
  assert.equal(repo.commits.length, commitsBefore, 'nothing committed');
  assert.deepEqual(Object.keys(repo.published.editions), ['low-tide-2026'], 'no low-tide-2-2026');
});

test('confirm: the source image is committed named by its content hash', async () => {
  const { review, ports } = await reviewOf();
  await confirm(confirmIntent(review), ports);
  const hash = sha256(image().bytes);
  const stored = ports.repo.commits.flatMap((c) => c.images);
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.path, `source/images/${hash}.webp`);
  assert.equal(stored[0]!.contentType, 'image/webp');
  assert.deepEqual(stored[0]!.bytes, image().bytes);
  assert.match(ports.repo.file('data/low-tide-2026.yaml')!, new RegExp(`# {3}${hash}\\.webp`));
});

test('confirm: a blank festival name is refused in plain words, not by the schema', async () => {
  const { review, ports } = await reviewOf();
  const blank = await confirm(confirmIntent(review, { festival: '  ' }), ports);
  assert.equal(blank.rejection!.gate, 'details');
  assert.equal(blank.rejection!.reason, "Type the festival's name first.");
  assert.equal(ports.repo.commits.length, 1, 'the upload only');
});

test('confirm: a review whose image is not in the store is refused, not guessed at', async () => {
  const { review, ports } = await reviewOf();
  const other = confirmIntent(review, { image: image({ bytes: new TextEncoder().encode('a different poster') }) });
  const result = await confirm(other, ports);
  assert.equal(result.ok, false);
  assert.equal(result.rejection!.gate, 'expired');
  assert.equal(result.rejection!.reason, "I don't have that image any more. Upload it again and check the times.");
});

// ---------------------------------------------------------------------------
// The seam itself
// ---------------------------------------------------------------------------

test('seam: publish() dispatches on the intent and returns the same result the intent does', async () => {
  const ports = fakePorts();
  const uploaded = await publish(uploadIntent(), ports);
  assert.ok(uploaded.ok, uploaded.rejection?.reason);
  const confirmed = await publish(confirmIntent(uploaded.review!), ports);
  assert.ok(confirmed.ok, confirmed.rejection?.reason);
  assert.equal(confirmed.editionPath, 'low-tide-2026');
  assert.deepEqual(
    ports.repo.commits.map((c) => c.files.map((f) => f.path)),
    [
      ['state/transcriptions/' + sha256(image().bytes) + '.json'],
      ['data/low-tide-2026.yaml', 'source/low-tide-2026/TRANSCRIPTION.md', 'state/published.json'],
    ],
    'an upload writes the reading it paid for and nothing about who asked',
  );
});
