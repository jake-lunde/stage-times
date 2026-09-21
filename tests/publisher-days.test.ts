/**
 * The publisher seam with more than one source image: an edition read off one
 * image per day.
 *
 * Same fakes as tests/publisher.test.ts, which stays as it is — one image is a
 * list of one, and nothing that worked with one image changes. What these
 * tests add is what a list brings: each image gated, hashed and cached on its
 * own, a rejection that says which one, caps that count the upload rather than
 * the images, one review across every day, and a confirm that stores and logs
 * every image.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  confirm,
  GATE_COPY,
  MAX_UPLOAD_IMAGES,
  sha256,
  upload,
  UPLOADS_PER_ADDRESS_PER_HOUR,
  type ConfirmIntent,
  type Review,
  type SourceImage,
  type UploadIntent,
} from '../src/publisher.js';
import type { PublishedFile } from '../src/build.js';
import { loadFestivalFromString } from '../src/schema.js';
import {
  fakePorts,
  fakeRepository,
  FIXED_NOW,
  image,
  ledgerOf,
  recordedReply,
  weekendImages,
  weekendVision,
  type Fakes,
} from './publisher-fakes.js';

const UPLOADER = 'sam@example.com';

function daysIntent(images: SourceImage[], overrides: Partial<UploadIntent> = {}): UploadIntent {
  return {
    kind: 'upload',
    festival: 'Low Tide',
    dates: { first: '2026-10-09', last: '2026-10-11' },
    email: UPLOADER,
    images,
    ...overrides,
  };
}

function confirmDays(review: Review, images: SourceImage[], overrides: Partial<ConfirmIntent> = {}): ConfirmIntent {
  return {
    kind: 'confirm',
    images,
    reviewed: review.images,
    festival: 'Low Tide',
    email: UPLOADER,
    timezone: review.timezone,
    timezoneAssumed: review.timezoneAssumed,
    edits: [],
    unverifiable: [],
    ...overrides,
  };
}

function weekendPorts(overrides: Partial<Fakes> = {}): Fakes {
  return fakePorts({ vision: weekendVision(), ...overrides });
}

async function weekendReview(ports: Fakes = weekendPorts()): Promise<{ review: Review; ports: Fakes }> {
  const result = await upload(daysIntent(weekendImages()), ports);
  assert.ok(result.ok, `upload was rejected: ${result.rejection?.reason}`);
  return { review: result.review!, ports };
}

const hashes = (images: SourceImage[]) => images.map((i) => sha256(i.bytes));

// ---------------------------------------------------------------------------
// One review across every day
// ---------------------------------------------------------------------------

test('days: three day images come back as one review whose sets span all three days, grouped by stage, each naming its image', async () => {
  const { review, ports } = await weekendReview();
  const [fri, sat, sun] = hashes(weekendImages());

  assert.deepEqual(review.images, [fri, sat, sun], 'the images, in the order they were given');
  assert.equal(review.image, fri, 'the first image, where one image used to be');
  assert.deepEqual(ports.vision.transcribed, ['friday.webp', 'saturday.png', 'sunday.jpg'], 'each image read once');

  const days = [...new Set(review.sets.map((s) => s.start.slice(0, 10)))];
  assert.deepEqual(days, ['2026-10-09', '2026-10-10', '2026-10-11'], 'one set list, in day order');
  assert.equal(review.sets.length, 11);
  assert.deepEqual(
    review.sets.map((s) => s.index),
    review.sets.map((_, i) => i),
    'one index space across every day — what an edit addresses',
  );

  // Grouped by stage: every stage any day printed, once, and every set under one.
  assert.deepEqual(review.stages, [
    { id: 'main', name: 'Main Stage' },
    { id: 'cellar', name: 'Cellar Stage' },
    { id: 'harbor', name: 'Harbor Stage' },
  ]);
  const grouped = review.stages.map((stage) => review.sets.filter((s) => s.stage === stage.id));
  assert.equal(grouped.flat().length, review.sets.length, 'no set falls outside a stage');
  assert.deepEqual(
    grouped[0]!.map((s) => s.artist),
    ['AVERY COCHRANE', 'MAGDALENA BAY', 'MUNA', 'SUNNY WAR', 'JAPANESE BREAKFAST', 'BLEACHERS'],
    'the main stage runs across all three days',
  );

  const from = (artist: string) => review.sets.find((s) => s.artist === artist)!.image;
  assert.equal(from('MUNA'), fri);
  assert.equal(from('TOMBERLIN'), sat);
  assert.equal(from('WAXAHATCHEE'), sun);
  assert.ok(review.sets.every((s) => [fri, sat, sun].includes(s.image)), 'every set names an image in the list');

  assert.deepEqual(
    review.observations,
    [...(JSON.parse(recordedReply()) as { observations: string[] }).observations, 'The HARBOR STAGE column is new on Sunday.'],
    "every day's notes, in day order",
  );
});

test('days: the review follows the days, not the order the images arrived in', async () => {
  const [fri, sat, sun] = weekendImages();
  const result = await upload(daysIntent([sun!, fri!, sat!]), weekendPorts());
  assert.ok(result.ok, result.rejection?.reason);
  const review = result.review!;
  assert.deepEqual(review.images, hashes([sun!, fri!, sat!]), 'the list is echoed as given');
  assert.deepEqual(
    [...new Set(review.sets.map((s) => s.start.slice(0, 10)))],
    ['2026-10-09', '2026-10-10', '2026-10-11'],
    'sets still run Friday to Sunday',
  );
  assert.equal(review.sets[0]!.image, sha256(fri!.bytes));
});

// ---------------------------------------------------------------------------
// Gated and cached per image
// ---------------------------------------------------------------------------

test('days: each image is cached on its own — a retry with two of three read before costs one transcription and no schedule check for the two', async () => {
  const ports = weekendPorts();
  const [fri, sat, sun] = weekendImages();

  const first = await upload(daysIntent([fri!, sat!]), ports);
  assert.ok(first.ok, first.rejection?.reason);
  assert.deepEqual(ports.vision.checked, ['friday.webp', 'saturday.png']);
  assert.deepEqual(ports.vision.transcribed, ['friday.webp', 'saturday.png']);

  const retry = await upload(daysIntent([fri!, sat!, sun!]), ports);
  assert.ok(retry.ok, retry.rejection?.reason);
  assert.deepEqual(ports.vision.checked, ['friday.webp', 'saturday.png', 'sunday.jpg'], 'one new schedule check, for Sunday only');
  assert.deepEqual(ports.vision.transcribed, ['friday.webp', 'saturday.png', 'sunday.jpg'], 'exactly one new transcription');
  assert.equal(retry.reused, false, 'Sunday cost something');

  const written = retry.commit!.files.map((f) => f.path);
  assert.deepEqual(written, [`state/transcriptions/${sha256(sun!.bytes)}.json`, 'state/uploads.json'], 'only the new reading is saved');
  assert.equal(retry.review!.sets.length, 11, 'and the review still covers all three days');

  const again = await upload(daysIntent([fri!, sat!, sun!]), ports);
  assert.ok(again.ok, again.rejection?.reason);
  assert.equal(ports.vision.checks + ports.vision.transcriptions, 6, 'every image read before: nothing at all');
  assert.equal(again.reused, true);
  assert.equal(again.commit, null);
});

test('days: every reading is saved under its own image hash', async () => {
  const { ports } = await weekendReview();
  for (const [img, reply] of weekendImages().map((img, i) => [img, ['low-tide.json', 'low-tide-saturday.json', 'low-tide-sunday.json'][i]!] as const)) {
    const saved = JSON.parse(ports.repo.file(`state/transcriptions/${sha256(img.bytes)}.json`)!) as { output: string; filename: string };
    assert.equal(saved.output, recordedReply(reply), `${img.filename} saved verbatim`);
    assert.equal(saved.filename, img.filename);
  }
  assert.equal(ports.repo.commits.length, 1, 'one upload, one commit');
});

test('days: a rejection of one image says which one, and no image is read before it is fixed', async () => {
  const [fri, sat, sun] = weekendImages();

  // A free gate: Saturday is too small. Nothing is asked of any model.
  const small = weekendPorts();
  const tiny = await upload(daysIntent([fri!, { ...sat!, width: 320, height: 240 }, sun!]), small);
  assert.equal(tiny.ok, false);
  assert.equal(tiny.rejection!.gate, 'dimensions');
  assert.equal(tiny.rejection!.image, 1, 'the second image, counting from zero');
  assert.equal(
    tiny.rejection!.reason,
    'Day 2: That image is 240 pixels on its short side. Under 400 there is nothing legible to read the times off.',
  );
  assert.equal(small.vision.checks + small.vision.transcriptions, 0, 'nothing was read');
  assert.deepEqual(small.repo.commits, []);

  // The cheap check: Sunday is a lineup. Friday and Saturday passed their
  // check, but none of the three is transcribed until Sunday is fixed.
  const lineup = fakePorts({ vision: weekendVision({ notSchedules: ['sunday.jpg'] }) });
  const refused = await upload(daysIntent([fri!, sat!, sun!]), lineup);
  assert.equal(refused.ok, false);
  assert.equal(refused.rejection!.gate, 'schedule');
  assert.equal(refused.rejection!.image, 2);
  assert.equal(
    refused.rejection!.reason,
    "Day 3: I can't find set times on that image. It needs the schedule with the times on it, not the lineup.",
  );
  assert.equal(lineup.vision.transcriptions, 0, 'the other images are not read before it is fixed');
  assert.deepEqual(lineup.repo.commits, [], 'and nothing counts against a cap');
});

test('days: a one-image rejection reads exactly as it always has', async () => {
  const ports = weekendPorts();
  const result = await upload(daysIntent([image({ width: 320, height: 240 })]), ports);
  assert.equal(result.rejection!.reason, 'That image is 240 pixels on its short side. Under 400 there is nothing legible to read the times off.');
  assert.equal(result.rejection!.image, 0);
});

test('days: a duplicate image in the list is refused, named, before anything is read', async () => {
  const [fri, sat] = weekendImages();
  const ports = weekendPorts();
  const result = await upload(daysIntent([fri!, sat!, { ...fri!, filename: 'friday-again.webp' }]), ports);
  assert.equal(result.ok, false);
  assert.equal(result.rejection!.gate, 'images');
  assert.equal(result.rejection!.image, 2);
  assert.equal(result.rejection!.reason, 'Day 3 is the same image as day 1. Each day needs its own.');
  assert.equal(ports.vision.checks + ports.vision.transcriptions, 0);
  assert.deepEqual(ports.repo.commits, []);
});

// ---------------------------------------------------------------------------
// The caps count the upload
// ---------------------------------------------------------------------------

test('days: the caps count one upload per request, however many images it carries', async () => {
  // Two uploads this hour already; the limit is three. A three-image upload is
  // one more, not three more.
  const ports = weekendPorts({
    repo: fakeRepository({
      uploads: ledgerOf(
        Array.from({ length: UPLOADS_PER_ADDRESS_PER_HOUR - 1 }, (_, i) => ({ email: UPLOADER, at: FIXED_NOW - (i + 1) * 60_000 })),
      ),
    }),
  });
  const result = await upload(daysIntent(weekendImages()), ports);
  assert.ok(result.ok, result.rejection?.reason);

  const ledger = JSON.parse(ports.repo.file('state/uploads.json')!) as { uploads: { at: number; image: string; images?: string[] }[] };
  assert.equal(ledger.uploads.length, UPLOADS_PER_ADDRESS_PER_HOUR, 'one entry for the whole upload');
  const entry = ledger.uploads.at(-1)!;
  assert.equal(entry.at, FIXED_NOW);
  assert.equal(entry.image, sha256(weekendImages()[0]!.bytes));
  assert.deepEqual(entry.images, hashes(weekendImages()), 'every image it paid to read');

  // And now the address is at its limit.
  const [, , sun] = weekendImages();
  const next = await upload(daysIntent([{ ...sun!, bytes: new TextEncoder().encode('a fourth poster') }]), ports);
  assert.equal(next.rejection!.gate, 'address-cap');
});

test(`days: a request over ${MAX_UPLOAD_IMAGES} images is refused in a plain sentence before anything is read`, async () => {
  const ports = weekendPorts();
  const many = Array.from({ length: MAX_UPLOAD_IMAGES + 1 }, (_, i) =>
    image({ filename: `day-${i + 1}.webp`, bytes: new TextEncoder().encode(`day ${i + 1}`) }),
  );
  const result = await upload(daysIntent(many), ports);
  assert.equal(result.ok, false);
  assert.equal(result.rejection!.gate, 'images');
  assert.equal(
    result.rejection!.reason,
    `That's ${MAX_UPLOAD_IMAGES + 1} images. ${MAX_UPLOAD_IMAGES} is the most one upload can take — one per day.`,
  );
  assert.equal(result.rejection!.image, undefined, 'about the upload, not one image');
  assert.equal(ports.vision.checks + ports.vision.transcriptions, 0);
  assert.deepEqual(ports.repo.commits, []);

  const exactly = await upload(daysIntent(many.slice(0, MAX_UPLOAD_IMAGES)), fakePorts());
  assert.notEqual(exactly.rejection?.gate, 'images', `${MAX_UPLOAD_IMAGES} is allowed`);
});

test('days: an upload with no image is refused in a plain sentence', async () => {
  const ports = weekendPorts();
  const result = await upload(daysIntent([]), ports);
  assert.equal(result.rejection!.gate, 'images');
  assert.equal(result.rejection!.reason, 'Add an image of the schedule first.');
  assert.equal(ports.vision.checks, 0);
});

// ---------------------------------------------------------------------------
// confirm
// ---------------------------------------------------------------------------

test('days: confirm refuses a list that does not match the review', async () => {
  const { review, ports } = await weekendReview();
  const [fri, sat, sun] = weekendImages();
  const commits = ports.repo.commits.length;

  for (const [label, images] of [
    ['a day left out', [fri!, sat!]],
    ['the days reordered', [sat!, fri!, sun!]],
    ['a day swapped for another image', [fri!, sat!, { ...sun!, bytes: new TextEncoder().encode('a different sunday') }]],
  ] as const) {
    const result = await confirm(confirmDays(review, [...images]), ports);
    assert.equal(result.ok, false, `${label} should be refused`);
    assert.equal(result.rejection!.gate, 'expired', label);
    assert.equal(result.rejection!.reason, "Those aren't the images you checked. Upload them again and check the times.", label);
  }

  const unechoed = await confirm(confirmDays(review, weekendImages(), { reviewed: undefined }), ports);
  assert.equal(unechoed.rejection!.gate, 'expired', 'more than one image and no review to match it against');
  assert.equal(ports.repo.commits.length, commits, 'nothing was committed');
});

test('days: confirm stores every image under its content hash, and the log and the YAML name every source', async () => {
  const { review, ports } = await weekendReview();
  const result = await confirm(confirmDays(review, weekendImages()), ports);
  assert.ok(result.ok, result.rejection?.reason);
  assert.equal(result.editionPath, 'fan/low-tide-2026');

  const [fri, sat, sun] = hashes(weekendImages());
  const stored = result.commit!.images;
  assert.deepEqual(
    stored.map((i) => [i.path, i.contentType]),
    [
      [`source/images/${fri}.webp`, 'image/webp'],
      [`source/images/${sat}.png`, 'image/png'],
      [`source/images/${sun}.jpg`, 'image/jpeg'],
    ],
  );
  stored.forEach((s, i) => assert.deepEqual(s.bytes, weekendImages()[i]!.bytes, `${s.path} is that image's bytes`));

  const log = ports.repo.file('source/fan/low-tide-2026/TRANSCRIPTION.md')!;
  assert.match(log, new RegExp(`Source images: \`${fri}\\.webp\`, \`${sat}\\.png\`, \`${sun}\\.jpg\`\\.`));

  const yaml = ports.repo.file('data/fan/low-tide-2026.yaml')!;
  for (const name of [`${fri}.webp`, `${sat}.png`, `${sun}.jpg`]) assert.match(yaml, new RegExp(`# {3}${name}`));
  const doc = loadFestivalFromString(yaml, 'data/fan/low-tide-2026.yaml');
  assert.equal(doc.sets.length, 11);
  assert.deepEqual(doc.stages.map((s) => s.id), ['main', 'cellar', 'harbor']);

  const published = JSON.parse(ports.repo.file('state/published.json')!) as PublishedFile;
  const uploader = published.editions['fan/low-tide-2026']!.uploader!;
  assert.equal(uploader.image, fri);
  assert.deepEqual(uploader.images, [fri, sat, sun], 'every image the edition was read from');

  assert.match(result.notifications[0]!.body, /^11 sets across 3 stages, read off friday\.webp, saturday\.png and sunday\.jpg and checked/);
});

test('days: an edit addresses a set on any day by its review index', async () => {
  const { review, ports } = await weekendReview();
  const waxahatchee = review.sets.find((s) => s.artist === 'WAXAHATCHEE')!;
  const result = await confirm(
    confirmDays(review, weekendImages(), { edits: [{ index: waxahatchee.index, start: '2026-10-11T19:20:00' }] }),
    ports,
  );
  assert.ok(result.ok, result.rejection?.reason);
  const doc = loadFestivalFromString(ports.repo.file('data/fan/low-tide-2026.yaml')!, 'committed');
  assert.equal(doc.sets.find((s) => s.artist === 'WAXAHATCHEE')!.start.raw, '2026-10-11T19:20:00');
});

test('days: confirm names which image it no longer has', async () => {
  const { review, ports } = await weekendReview();
  ports.repo.transcriptions.delete(sha256(weekendImages()[1]!.bytes));
  const result = await confirm(confirmDays(review, weekendImages()), ports);
  assert.equal(result.rejection!.gate, 'expired');
  assert.equal(result.rejection!.image, 1);
  assert.equal(result.rejection!.reason, "Day 2: I don't have that image any more. Upload it again and check the times.");
});

// ---------------------------------------------------------------------------
// One image is a list of one
// ---------------------------------------------------------------------------

test('days: an edition uploaded as a list of one is byte-identical to one uploaded as a single image', async () => {
  const single = fakePorts();
  const one = await upload({ ...daysIntent([]), images: undefined, dates: { first: '2026-10-09', last: '2026-10-09' }, image: image() }, single);
  assert.ok(one.ok, one.rejection?.reason);
  await confirm(
    {
      kind: 'confirm', image: image(), festival: 'Low Tide', email: UPLOADER,
      timezone: one.review!.timezone, timezoneAssumed: one.review!.timezoneAssumed, edits: [], unverifiable: [],
    },
    single,
  );

  const listed = fakePorts();
  const list = await upload(daysIntent([image()], { dates: { first: '2026-10-09', last: '2026-10-09' } }), listed);
  assert.ok(list.ok, list.rejection?.reason);
  await confirm(confirmDays(list.review!, [image()]), listed);

  assert.deepEqual(list.review, one.review, 'the same review');
  const everything = (p: Fakes) => p.repo.commits.map((c) => ({ ...c, images: c.images.map((i) => ({ ...i, bytes: [...i.bytes] })) }));
  assert.deepEqual(everything(listed), everything(single), 'the same commits, byte for byte');
  assert.deepEqual(listed.notify.sent, single.notify.sent);

  const published = JSON.parse(listed.repo.file('state/published.json')!) as PublishedFile;
  assert.equal('images' in published.editions['fan/low-tide-2026']!.uploader!, false, 'no list recorded for one image');
  const ledger = JSON.parse(listed.repo.file('state/uploads.json')!) as { uploads: object[] };
  assert.equal('images' in ledger.uploads[0]!, false);
});

// ---------------------------------------------------------------------------
// The days as checked (ticket 20)
// ---------------------------------------------------------------------------

test('days: confirm with the days as read changes nothing — the same edition, byte for byte', async () => {
  const plain = await weekendReview();
  const asIs = await confirm(confirmDays(plain.review, weekendImages()), plain.ports);
  const listed = await weekendReview();
  const same = await confirm(confirmDays(listed.review, weekendImages(), { days: ['2026-10-09', '2026-10-10', '2026-10-11'] }), listed.ports);
  assert.ok(asIs.ok && same.ok, `${asIs.rejection?.reason ?? ''}${same.rejection?.reason ?? ''}`);
  assert.equal(listed.ports.repo.file('data/fan/low-tide-2026.yaml'), plain.ports.repo.file('data/fan/low-tide-2026.yaml'));
  assert.equal(listed.ports.repo.file('source/fan/low-tide-2026/TRANSCRIPTION.md'), plain.ports.repo.file('source/fan/low-tide-2026/TRANSCRIPTION.md'), 'nothing moved, so the log says nothing about it');
});

test('days: a day moved on review moves every set printed under it, the year and the address with it, and the log says so', async () => {
  const { review, ports } = await weekendReview();
  const result = await confirm(confirmDays(review, weekendImages(), { days: ['2027-10-08', '2027-10-09', '2027-10-10'] }), ports);
  assert.ok(result.ok, result.rejection?.reason);
  assert.equal(result.editionPath, 'fan/low-tide-2027', 'the year is read from the first day, so it moved');
  const doc = loadFestivalFromString(ports.repo.file('data/fan/low-tide-2027.yaml')!, 'committed');
  assert.equal(doc.festival.year, 2027);
  const muna = doc.sets.find((s) => s.artist === 'MUNA')!;
  assert.equal(muna.start.raw, '2027-10-08T22:40:00', 'Friday\'s sets are on the new Friday');
  const late = doc.sets.find((s) => s.artist === 'MGNA CRRRTA')!;
  assert.equal(late.start.raw, '2027-10-08T23:45:00');
  assert.ok(doc.sets.every((s) => s.start.raw.startsWith('2027-10-')), 'every set moved');
  const log = ports.repo.file('source/fan/low-tide-2027/TRANSCRIPTION.md')!;
  assert.match(log, /Days moved on review: 2026-10-09 → 2027-10-08\./, 'the Friday reply notes its move');
  assert.match(log, /Days moved on review: 2026-10-11 → 2027-10-10\./, 'and the Sunday reply its own');
});

test('days: a list that does not fit the reading is refused in a plain sentence, and nothing is published', async () => {
  for (const days of [['2026-10-09', '2026-10-10'], ['2026-10-09', '2026-10-10', 'Sunday'], ['2026-10-09', '2026-10-09', '2026-10-11'], ['2026-10-09', '2026-10-10', '']]) {
    const { review, ports } = await weekendReview();
    const result = await confirm(confirmDays(review, weekendImages(), { days }), ports);
    assert.equal(result.ok, false, `${JSON.stringify(days)} should be refused`);
    assert.equal(result.rejection?.gate, 'review');
    assert.equal(result.rejection?.reason, GATE_COPY.days);
    assert.equal(ports.repo.file('data/fan/low-tide-2026.yaml'), undefined);
  }
});
