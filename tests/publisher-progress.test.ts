/**
 * The publisher's progress port (ticket 21): what it says while it works.
 *
 * Reading three posters takes minutes, and the page can only be honest about
 * what the publisher tells it. So the publisher reports, through an injected
 * port, each image that clears the schedule check and each one whose reading
 * is in hand — its position, the total, how many are done, the sets read so
 * far, and that image's headliners — and confirm reports checking, saving and
 * done. Nothing is reported before it has happened, and a rejection reports
 * nothing past the gate that refused.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { confirm, upload, type ConfirmIntent, type Progress, type Review, type SourceImage, type UploadIntent } from '../src/publisher.js';
import { fakePorts, fakeProgress, weekendImages, weekendVision, type Fakes } from './publisher-fakes.js';

const UPLOADER = 'sam@example.com';

function daysIntent(images: SourceImage[], overrides: Partial<UploadIntent> = {}): UploadIntent {
  return { kind: 'upload', festival: 'Low Tide', dates: { first: '2026-10-09', last: '2026-10-11' }, email: UPLOADER, images, ...overrides };
}

function confirmOf(review: Review, images: SourceImage[]): ConfirmIntent {
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
  };
}

const FRIDAY = [
  { artist: 'MUNA', stage: 'Main Stage', night: '2026-10-09', start: '2026-10-09T22:40:00' },
  { artist: 'DARK CHISME', stage: 'Cellar Stage', night: '2026-10-09', start: '2026-10-09T22:45:00' },
];
const SATURDAY = [
  { artist: 'JAPANESE BREAKFAST', stage: 'Main Stage', night: '2026-10-10', start: '2026-10-10T21:30:00' },
  { artist: 'TOMBERLIN', stage: 'Cellar Stage', night: '2026-10-10', start: '2026-10-10T23:00:00' },
];
const SUNDAY = [
  { artist: 'BLEACHERS', stage: 'Main Stage', night: '2026-10-11', start: '2026-10-11T21:00:00' },
  { artist: 'WAXAHATCHEE', stage: 'Harbor Stage', night: '2026-10-11', start: '2026-10-11T19:15:00' },
];

/** Friday already read by an earlier upload, so its reading costs nothing this time. */
async function fridayCached(): Promise<Fakes> {
  const ports = fakePorts({ vision: weekendVision() });
  const first = await upload(daysIntent([weekendImages()[0]!], { email: 'first@example.com' }), ports);
  assert.equal(first.ok, true, `the Friday upload was refused: ${first.rejection?.reason}`);
  ports.vision.checked.length = 0;
  ports.vision.transcribed.length = 0;
  return ports;
}

test('progress: a three-image upload with one image cached reports the cached one, each check, then each reading, in order', async () => {
  const ports = await fridayCached();
  const progress = fakeProgress();
  const result = await upload(daysIntent(weekendImages()), { ...ports, progress });
  assert.equal(result.ok, true, `the upload was refused: ${result.rejection?.reason}`);

  const expected: Progress[] = [
    { kind: 'read', step: 'reused', image: 0, total: 3, done: 1, sets: 5, headliners: FRIDAY },
    { kind: 'read', step: 'checked', image: 1, total: 3, done: 1, sets: 5, headliners: [] },
    { kind: 'read', step: 'checked', image: 2, total: 3, done: 1, sets: 5, headliners: [] },
    { kind: 'read', step: 'read', image: 1, total: 3, done: 2, sets: 8, headliners: SATURDAY },
    { kind: 'read', step: 'read', image: 2, total: 3, done: 3, sets: 11, headliners: SUNDAY },
  ];
  assert.deepEqual(progress.reports, expected, 'the sequence the page turns into a percentage and the headliners');
  assert.deepEqual(ports.vision.transcribed, ['saturday.png', 'sunday.jpg'], 'the cached image was not read again');
});

test('progress: the sets so far add up to the review\'s sets, and done reaches the total exactly once', async () => {
  const progress = fakeProgress();
  const result = await upload(daysIntent(weekendImages()), fakePorts({ vision: weekendVision(), progress }));
  assert.equal(result.ok, true, `the upload was refused: ${result.rejection?.reason}`);
  const last = progress.reports.at(-1)!;
  assert.equal(last.kind === 'read' && last.sets, result.review!.sets.length, 'the last report counts every set the review shows');
  assert.equal(progress.reports.filter((p) => p.kind === 'read' && p.done === p.total).length, 1, 'one report says all done');
  assert.deepEqual(
    progress.reports.map((p) => (p.kind === 'read' ? p.step : p.step)),
    ['checked', 'checked', 'checked', 'read', 'read', 'read'],
    'every check before any reading, as the gates run',
  );
});

test('progress: every image cached reports each as reused and nothing else', async () => {
  const ports = fakePorts({ vision: weekendVision() });
  await upload(daysIntent(weekendImages()), ports);
  const progress = fakeProgress();
  await upload(daysIntent(weekendImages()), { ...ports, progress });
  assert.deepEqual(progress.reports.map((p) => p.kind === 'read' && [p.step, p.image, p.done]), [
    ['reused', 0, 1],
    ['reused', 1, 2],
    ['reused', 2, 3],
  ]);
});

test('progress: an image that is not a schedule stops the reports at the image before it', async () => {
  const progress = fakeProgress();
  const result = await upload(daysIntent(weekendImages()), fakePorts({ vision: weekendVision({ notSchedules: ['saturday.png'] }), progress }));
  assert.equal(result.rejection?.gate, 'schedule');
  assert.deepEqual(progress.reports.map((p) => p.kind === 'read' && [p.step, p.image]), [['checked', 0]], 'Saturday never cleared, so nothing past Friday\'s check is said');
});

test('progress: a gate that refuses before anything is read reports nothing', async () => {
  const progress = fakeProgress();
  const result = await upload(daysIntent(weekendImages(), { email: 'nope' }), fakePorts({ vision: weekendVision(), progress }));
  assert.equal(result.ok, false);
  assert.deepEqual(progress.reports, []);
});

test('progress: without a progress port the publisher works exactly as before', async () => {
  const result = await upload(daysIntent(weekendImages()), fakePorts({ vision: weekendVision() }));
  assert.equal(result.ok, true, `the upload was refused: ${result.rejection?.reason}`);
});

test('progress: confirm reports checking, then saving, then done — and done only after the commit landed', async () => {
  const ports = fakePorts({ vision: weekendVision() });
  const up = await upload(daysIntent(weekendImages()), ports);
  const commitsBefore = ports.repo.commits.length;
  const seen: { step: string; commits: number }[] = [];
  const result = await confirm(confirmOf(up.review!, weekendImages()), {
    ...ports,
    progress: { report: (p) => seen.push({ step: p.step, commits: ports.repo.commits.length - commitsBefore }) },
  });
  assert.equal(result.ok, true, `the confirm was refused: ${result.rejection?.reason}`);
  assert.deepEqual(seen, [
    { step: 'checking', commits: 0 },
    { step: 'saving', commits: 0 },
    { step: 'done', commits: 1 },
  ]);
});

test('progress: a confirm the checks refuse never says saving', async () => {
  const ports = fakePorts({ vision: weekendVision() });
  const up = await upload(daysIntent(weekendImages()), ports);
  const progress = fakeProgress();
  const result = await confirm({ ...confirmOf(up.review!, weekendImages()), unverifiable: [0] }, { ...ports, progress });
  assert.equal(result.rejection?.gate, 'review');
  assert.deepEqual(progress.reports.map((p) => p.step), ['checking']);
});

test('progress: a correction reports the same three steps', async () => {
  const ports = fakePorts({ vision: weekendVision() });
  const up = await upload(daysIntent(weekendImages()), ports);
  const done = await confirm(confirmOf(up.review!, weekendImages()), ports);
  const update = { editionPath: done.editionPath!, secret: done.updateSecret! };
  const again = await upload(daysIntent(weekendImages(), { update }), ports);
  const progress = fakeProgress();
  const corrected = await confirm({ ...confirmOf(again.review!, weekendImages()), update }, { ...ports, progress });
  assert.equal(corrected.corrected, true, `the correction was refused: ${corrected.rejection?.reason}`);
  assert.deepEqual(progress.reports.map((p) => p.step), ['checking', 'saving', 'done']);
});
