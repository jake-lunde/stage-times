/**
 * The watcher: the intent that notices a drop, or a change after a drop, on a
 * festival's official schedule page and hands the owner a review (CONTEXT:
 * watcher). Fake ports throughout, as in tests/publisher.test.ts, plus a page
 * port that replays recorded schedule pages. What each test asserts on is what
 * crossed the seam — the commit, the pull request, the notification, the
 * vision spend — never how the check is done inside.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { cadenceOf, imageDimensions, imageUrlsIn, isDue, loadWatchList, watch, type WatchEntry, type WatchIntent } from '../src/watcher.js';
import { sha256, type PullRequest } from '../src/publisher.js';
import { loadFestivalFromString } from '../src/schema.js';
import type { PublishedFile } from '../src/build.js';
import { REPO_ROOT } from './helpers.js';
import { fakePages, fakeRepository, fakeVision, fakeWatcherPorts, gifBytes, jpegBytes, pngBytes, recordedReply, schedulePage, webpBytes, type WatcherFakes } from './publisher-fakes.js';

function entry(overrides: Partial<WatchEntry> = {}): WatchEntry {
  return {
    festival: 'Low Tide',
    slug: 'low-tide',
    year: 2026,
    source: 'https://lowtide.example/schedule',
    timezone: 'America/Los_Angeles',
    dates: { first: '2026-10-09', last: '2026-10-11' },
    window: { from: '2026-09-25', to: '2026-10-11' },
    ...overrides,
  };
}

const at = (iso: string) => Date.parse(iso);

// ---------------------------------------------------------------------------
// Cadence
// ---------------------------------------------------------------------------

test('watcher: the cadence follows the drop window — daily before it, hourly inside it, dormant after the last day', () => {
  assert.equal(cadenceOf(entry(), at('2026-09-01T12:00:00Z')), 'daily');
  assert.equal(cadenceOf(entry(), at('2026-09-25T00:00:00Z')), 'hourly', 'the first day of the window counts');
  assert.equal(cadenceOf(entry(), at('2026-10-11T23:59:00Z')), 'hourly', 'the last festival day still counts');
  assert.equal(cadenceOf(entry(), at('2026-10-12T00:00:00Z')), 'dormant');
  assert.equal(cadenceOf(entry({ window: { from: '2026-09-25', to: '2026-10-01' } }), at('2026-10-05T12:00:00Z')), 'daily', 'past the window but before the last day is daily again');
});

test('watcher: an hourly entry is due on every run, a daily one on the daily run only, a dormant one never', () => {
  assert.equal(isDue(entry(), at('2026-10-01T03:00:00Z')), true);
  assert.equal(isDue(entry(), at('2026-09-01T03:00:00Z')), false);
  assert.equal(isDue(entry(), at('2026-09-01T15:20:00Z')), true, 'the daily slot is the 15:00 UTC run');
  assert.equal(isDue(entry(), at('2026-10-20T15:20:00Z')), false, 'dormant after the festival');
});

// ---------------------------------------------------------------------------
// The watch list
// ---------------------------------------------------------------------------

test('watcher: the watch list loads from YAML, one entry per edition, slug and window end filled in', () => {
  const list = loadWatchList(`
- festival: Austin City Limits
  year: 2026
  source: https://www.aclfestival.com/schedule
  timezone: America/Chicago
  dates: { first: 2026-10-02, last: 2026-10-11 }
  window: { from: 2026-08-14 }
  match: Wk2
- festival: III Points
  slug: iii-points
  year: 2026
  source: https://www.iiipoints.com/lineup-2026/
  timezone: America/New_York
  dates: { first: 2026-10-16, last: 2026-10-17 }
  window: { from: 2026-10-01, to: 2026-10-16 }
`);
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], {
    festival: 'Austin City Limits',
    slug: 'austin-city-limits',
    year: 2026,
    source: 'https://www.aclfestival.com/schedule',
    timezone: 'America/Chicago',
    dates: { first: '2026-10-02', last: '2026-10-11' },
    window: { from: '2026-08-14', to: '2026-10-11' },
    match: 'Wk2',
  });
  assert.equal(list[1]!.slug, 'iii-points');
  assert.equal(list[1]!.window.to, '2026-10-16');
});

test('watcher: a watch entry missing what the machine cannot know is refused by name', () => {
  const base = { festival: 'Low Tide', year: 2026, source: 'https://lowtide.example/schedule', timezone: 'America/Los_Angeles', dates: { first: '2026-10-09', last: '2026-10-11' }, window: { from: '2026-09-25' } };
  const without = (field: string) => {
    const copy: Record<string, unknown> = { ...base };
    delete copy[field];
    return JSON.stringify([copy]);
  };
  for (const field of ['festival', 'year', 'source', 'timezone', 'dates', 'window']) {
    assert.throws(() => loadWatchList(without(field)), new RegExp(field), `${field} is required`);
  }
  assert.throws(() => loadWatchList(JSON.stringify([{ ...base, timezone: 'Mars/Olympus' }])), /timezone/);
  assert.throws(() => loadWatchList(JSON.stringify([{ ...base, source: 'ftp://lowtide.example/x' }])), /source/);
  assert.throws(() => loadWatchList(JSON.stringify([{ ...base, match: '(' }])), /match/);
  assert.throws(() => loadWatchList(JSON.stringify([base, base])), /twice/);
});

// ---------------------------------------------------------------------------
// Reading a schedule page
// ---------------------------------------------------------------------------

test('watcher: every image a schedule page shows, in page order, largest candidate, resolved, once', () => {
  const html = readFileSync(join(REPO_ROOT, 'tests', 'fixtures', 'watch', 'schedule-page.html'), 'utf8');
  assert.deepEqual(imageUrlsIn(html, 'https://lowtide.example/schedule'), [
    'https://cdn.example.net/share/low-tide-og.jpg',
    'https://lowtide.example/img/hero-bg.jpg',
    'https://lowtide.example/img/logo.png',
    'https://cdn.example.net/files/friday-full.png',
    'https://cdn.example.net/files/friday-1600.png',
    'https://cdn.example.net/files/friday-800.png',
    'https://cdn.example.net/files/saturday.webp',
    'https://cdn.example.net/files/sponsor-2x.jpg',
    'https://cdn.example.net/files/sponsor.jpg',
  ]);
});

test('watcher: the dimensions of an image are read off its header, for the free gate', () => {
  assert.deepEqual(imageDimensions(pngBytes(1170, 2532)), { width: 1170, height: 2532, contentType: 'image/png' });
  assert.deepEqual(imageDimensions(jpegBytes(1600, 900)), { width: 1600, height: 900, contentType: 'image/jpeg' });
  assert.deepEqual(imageDimensions(gifBytes(200, 60)), { width: 200, height: 60, contentType: 'image/gif' });
  assert.deepEqual(imageDimensions(webpBytes(1080, 1920)), { width: 1080, height: 1920, contentType: 'image/webp' });
  assert.equal(imageDimensions(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
});

// ---------------------------------------------------------------------------
// A drop
// ---------------------------------------------------------------------------

const SOURCE = 'https://lowtide.example/schedule';
const LOGO = 'https://lowtide.example/img/logo.png';
const BANNER = 'https://cdn.example.net/files/sponsor.jpg';
const FRIDAY = 'https://cdn.example.net/files/friday.png';

/** A page showing a small logo, a sponsor banner that is not a schedule, and Friday's schedule. */
function firstDay(): WatcherFakes {
  const pages = fakePages({
    pages: { [SOURCE]: schedulePage([BANNER, FRIDAY]) },
    images: {
      [LOGO]: { bytes: pngBytes(200, 60, 'logo') },
      [BANNER]: { bytes: jpegBytes(1200, 400, 'banner'), contentType: 'image/jpeg' },
      [FRIDAY]: { bytes: pngBytes(1170, 2532, 'friday'), contentType: 'image/png' },
    },
  });
  const vision = fakeVision({ notSchedules: ['sponsor.jpg'] });
  return fakeWatcherPorts({ pages, vision });
}

function intent(overrides: Partial<WatchIntent> = {}): WatchIntent {
  return { kind: 'watch', list: [entry()], ...overrides };
}

function publishedOf(ports: WatcherFakes): PublishedFile {
  return ports.repo.published;
}

test('watcher: a first schedule image is a drop — screened once, read once, recorded on main, and offered as a review pull request', async () => {
  const ports = firstDay();
  const result = await watch(intent(), ports);

  const [report] = result.reports;
  assert.equal(report!.outcome, 'drop');
  assert.equal(report!.cadence, 'hourly');
  const hash = sha256(pngBytes(1170, 2532, 'friday'));
  assert.deepEqual(report!.images, [hash], 'the schedule images, by content hash');

  // The spend: the logo fails the free gate and is never asked about; the
  // banner and the schedule are screened; only the schedule is read.
  assert.equal(ports.vision.checks, 2, `screened: ${ports.vision.checked.join(', ')}`);
  assert.deepEqual(ports.vision.transcribed, ['friday.png']);

  // One commit to main: the reply, and the watcher's own state.
  assert.equal(ports.repo.commits.length, 1);
  const paths = ports.repo.commits[0]!.files.map((f) => f.path);
  assert.ok(paths.includes(`state/transcriptions/${hash}.json`), 'the reply is stored under the image hash, as an upload would');
  assert.ok(paths.includes('state/watch.json'), 'the watcher records what it saw');
  assert.equal(ports.repo.commits[0]!.images.length, 0, 'the image itself waits for the review');
  assert.equal(publishedOf(ports).editions['low-tide-2026'], undefined, 'nothing is published by a poll');

  // The review: a pull request off that commit, carrying the edition exactly
  // as the owner's confirm would commit it.
  assert.equal(result.pullRequests.length, 1);
  const pr = result.pullRequests[0]!;
  assert.equal(pr, report!.pullRequest);
  assert.deepEqual(ports.repo.pullRequests, [pr]);
  assert.equal(pr.from, 'commit-1');
  assert.match(pr.branch, /^watch\/low-tide-2026\/[0-9a-f]{12}$/);
  assert.equal(pr.title, 'Set times dropped: Low Tide 2026');

  const files = pr.commit.files.map((f) => f.path);
  assert.deepEqual(files.sort(), ['data/low-tide-2026.yaml', 'source/low-tide-2026/TRANSCRIPTION.md', 'state/published.json']);
  assert.deepEqual(pr.commit.images.map((i) => i.path), [`source/images/${hash}.png`]);
  const doc = loadFestivalFromString(pr.commit.files.find((f) => f.path === 'data/low-tide-2026.yaml')!.contents, 'data/low-tide-2026.yaml');
  assert.equal(doc.namespace, 'owner');
  assert.equal(doc.verified, true, 'merging is the check');
  assert.equal(doc.festival.timezone, 'America/Los_Angeles');
  assert.equal(doc.festival.official_url, SOURCE, 'the schedule page is the official link');
  assert.equal(doc.sets.length, 5);

  // The body is what he verifies from his phone: the sets, the notes, the image.
  assert.match(pr.body, /MAGDALENA BAY/);
  assert.match(pr.body, /9:00.*10:00/);
  assert.match(pr.body, /three R's are printed/);
  assert.ok(pr.body.includes(`![friday.png](https://raw.githubusercontent.com/jake-lunde/stage-times/${pr.branch}/source/images/${hash}.png)`), pr.body);
  assert.ok(pr.body.includes(FRIDAY), 'the image where it was found');
  assert.ok(pr.body.includes(SOURCE), 'the schedule page');
  assert.ok(pr.body.includes('https://stagetimes.app/low-tide-2026/'), 'where merging puts it');
  assert.ok(pr.body.includes('TRANSCRIPTION.md'), 'the log rides in the branch');
  assert.doesNotMatch(pr.body, /\bwe\b/i);

  assert.deepEqual(result.notifications, [], 'the pull request is the notice');

  // Merging publishes and lists it through the owner path.
  await ports.repo.merge(pr);
  const record = publishedOf(ports).editions['low-tide-2026']!;
  assert.equal(record.namespace, 'owner');
  assert.equal(record.listed, true);
  assert.equal(record.blocked, false);
  assert.deepEqual(record.stages, ['cellar', 'main']);
  assert.equal(ports.repo.file('data/low-tide-2026.yaml'), pr.commit.files.find((f) => f.path === 'data/low-tide-2026.yaml')!.contents);

  // And the next poll of the same page is nothing: no spend, no write.
  const again = await watch(intent(), ports);
  assert.equal(again.reports[0]!.outcome, 'nothing');
  assert.equal(again.commit, null);
  assert.equal(ports.vision.checks, 2);
  assert.equal(ports.vision.transcriptions, 1);
  assert.equal(ports.repo.commits.length, 2, 'the merge, and nothing since');
});

// ---------------------------------------------------------------------------
// A change
// ---------------------------------------------------------------------------

const FRIDAY_V2 = 'https://cdn.example.net/files/friday-v2.png';

/** The Friday reply with one set moved half an hour later. */
function movedReply(): string {
  return recordedReply().replace('"9:00-10:00PM"', '"9:30-10:30PM"');
}

/** First poll, review merged, then the page swaps Friday's image for one whose reading moved a set. */
async function liveThenChanged(): Promise<{ ports: WatcherFakes; first: PullRequest }> {
  const ports = firstDay();
  ports.vision = fakeVision({ notSchedules: ['sponsor.jpg'], replies: { 'friday-v2.png': movedReply() } });
  const first = (await watch(intent(), ports)).pullRequests[0]!;
  await ports.repo.merge(first);
  ports.pages.pages[SOURCE] = schedulePage([BANNER, FRIDAY_V2]);
  ports.pages.images[FRIDAY_V2] = { bytes: pngBytes(1170, 2532, 'friday, second version'), contentType: 'image/png' };
  return { ports, first };
}

test('watcher: a modified image on a live edition is a change — titled with the set that moved, its diff in the body, the edition replaced in place', async () => {
  const { ports } = await liveThenChanged();
  const commitsBefore = ports.repo.commits.length;
  const checksBefore = ports.vision.checks;
  const result = await watch(intent(), ports);

  const [report] = result.reports;
  assert.equal(report!.outcome, 'change');
  assert.deepEqual(report!.images, [sha256(pngBytes(1170, 2532, 'friday, second version'))]);
  assert.equal(ports.vision.checks - checksBefore, 1, 'the new image is screened; the banner and the logo were decided already');
  assert.deepEqual(ports.vision.transcribed, ['friday.png', 'friday-v2.png']);

  assert.equal(report!.changes.length, 1);
  assert.equal(report!.changes[0]!.kind, 'changed');
  assert.equal(report!.changes[0]!.before!.artist, 'MAGDALENA BAY');

  const pr = result.pullRequests[0]!;
  assert.equal(pr.title, 'Low Tide 2026: MAGDALENA BAY moved');
  assert.ok(pr.body.includes('- MAGDALENA BAY (Main Stage): Oct 9 21:00–22:00 → Oct 9 21:30–22:30'), pr.body);
  assert.ok(pr.body.includes('what is live at https://stagetimes.app/low-tide-2026/'), pr.body);
  assert.ok(pr.body.includes('friday-v2.png'), 'the new image is in the body');
  assert.equal(pr.from, `commit-${commitsBefore + 1}`, 'branched off the state commit');

  const yaml = pr.commit.files.find((f) => f.path === 'data/low-tide-2026.yaml')!.contents;
  const doc = loadFestivalFromString(yaml, 'data/low-tide-2026.yaml');
  assert.equal(doc.sets.find((s) => s.artist === 'MAGDALENA BAY')!.start.raw, '2026-10-09T21:30:00');
  const published = JSON.parse(pr.commit.files.find((f) => f.path === 'state/published.json')!.contents) as PublishedFile;
  assert.equal(published.publishedAt, '20261009T183000Z', 'the publish stamp moves, so only changed events advance');
  assert.equal(published.editions['low-tide-2026']!.listed, true);
  assert.deepEqual(pr.commit.images.map((i) => i.path), [`source/images/${sha256(pngBytes(1170, 2532, 'friday, second version'))}.png`]);

  await ports.repo.merge(pr);
  const again = await watch(intent(), ports);
  assert.equal(again.reports[0]!.outcome, 'nothing');
});

test('watcher: a modified image before the first review is merged replaces it — the whole schedule again, titled with what moved since the earlier reading', async () => {
  const ports = firstDay();
  ports.vision = fakeVision({ notSchedules: ['sponsor.jpg'], replies: { 'friday-v2.png': movedReply() } });
  const first = (await watch(intent(), ports)).pullRequests[0]!;
  ports.pages.pages[SOURCE] = schedulePage([BANNER, FRIDAY_V2]);
  ports.pages.images[FRIDAY_V2] = { bytes: pngBytes(1170, 2532, 'friday, second version'), contentType: 'image/png' };

  const result = await watch(intent(), ports);
  assert.equal(result.reports[0]!.outcome, 'change');
  const pr = result.pullRequests[0]!;
  assert.notEqual(pr.branch, first.branch, 'a new branch; the earlier one is left to close');
  assert.equal(pr.title, 'Low Tide 2026: MAGDALENA BAY moved');
  assert.ok(pr.body.includes('This replaces it.'), pr.body);
  assert.ok(pr.body.includes('## Since the earlier reading\n- MAGDALENA BAY (Main Stage): Oct 9 21:00–22:00 → Oct 9 21:30–22:30'), pr.body);
  assert.match(pr.body, /## Main Stage/, 'the whole schedule is there to check — nothing is live to diff against');
  assert.equal(pr.commit.message, 'Publish and list Low Tide 2026 (low-tide-2026) from the watched schedule page');
});

test('watcher: a new image that reads the same is a change with nothing to review, and is not asked about again', async () => {
  const { ports } = await liveThenChanged();
  ports.vision = fakeVision({ notSchedules: ['sponsor.jpg'] }); // friday-v2.png now reads exactly as friday.png did
  const result = await watch(intent(), ports);
  assert.equal(result.reports[0]!.outcome, 'change');
  assert.deepEqual(result.pullRequests, []);
  assert.deepEqual(result.notifications, []);
  assert.match(result.reports[0]!.problem!, /read the same as what is live/);
  assert.ok(result.commit, 'the reading and the new schedule set are recorded');

  const again = await watch(intent(), ports);
  assert.equal(again.reports[0]!.outcome, 'nothing');
  assert.equal(ports.vision.transcriptions, 1);
});

/** Rename the live Cellar Stage by hand, as the owner would before first publish: id, name, and the id a reading derives. */
async function ownerPickedCellar(ports: WatcherFakes): Promise<void> {
  const path = 'data/low-tide-2026.yaml';
  const yaml = ports.repo.file(path)!
    .split('"cellar"     #').join('"downstairs"     #')
    .split('name: "Cellar Stage"').join('name: "The Cellar"\n    read_as: "cellar"')
    .split('stage: "cellar"').join('stage: "downstairs"')
    .split('  official_url:').join('  city: "Tacoma"\n  official_url:');
  const published = structuredClone(ports.repo.published);
  published.editions['low-tide-2026']!.stages = ['downstairs', 'main'];
  await ports.repo.commit({ message: 'Owner picks the Cellar id', files: [{ path, contents: yaml }, { path: 'state/published.json', contents: JSON.stringify(published) }], images: [] });
}

test('watcher: a new reading of a live edition keeps the stage ids and names the owner picked — the same times are nothing to review', async () => {
  const { ports } = await liveThenChanged();
  await ownerPickedCellar(ports);
  ports.vision = fakeVision({ notSchedules: ['sponsor.jpg'] }); // friday-v2.png reads exactly as friday.png did
  const result = await watch(intent(), ports);
  assert.equal(result.reports[0]!.outcome, 'change', result.reports[0]!.problem ?? '');
  assert.deepEqual(result.pullRequests, []);
  assert.deepEqual(result.notifications, [], 'no stage reads as dropped');
  assert.match(result.reports[0]!.problem!, /read the same as what is live/);
});

test('watcher: a change to a live edition with hand-picked stages commits them as picked', async () => {
  const { ports } = await liveThenChanged();
  await ownerPickedCellar(ports);
  const result = await watch(intent(), ports);
  const pr = result.pullRequests[0]!;
  assert.equal(pr.title, 'Low Tide 2026: MAGDALENA BAY moved');
  const doc = loadFestivalFromString(pr.commit.files.find((f) => f.path === 'data/low-tide-2026.yaml')!.contents, 'data/low-tide-2026.yaml');
  assert.deepEqual(doc.stages.map((s) => [s.id, s.name]), [['main', 'Main Stage'], ['downstairs', 'The Cellar']]);
  assert.equal(doc.stages[1]!.read_as, 'cellar');
  assert.equal(doc.festival.city, 'Tacoma');
});

// ---------------------------------------------------------------------------
// What stops a review
// ---------------------------------------------------------------------------

test('watcher: images that read as another year are a failure the owner hears about once, and nothing is opened', async () => {
  const ports = firstDay();
  const result = await watch(intent({ list: [entry({ year: 2027, dates: { first: '2027-10-08', last: '2027-10-10' }, window: { from: '2026-09-01', to: '2027-10-10' } })] }), ports);
  assert.equal(result.reports[0]!.outcome, 'failed');
  assert.deepEqual(result.pullRequests, []);
  assert.equal(result.notifications.length, 1);
  const [n] = result.notifications;
  assert.equal(n!.kind, 'watch-failed');
  assert.equal(n!.editionPath, 'low-tide-2027');
  assert.match(n!.body, /read as 2026, and this entry watches 2027/);
  assert.ok(n!.body.includes(FRIDAY), 'the image, so he can go look');
  assert.deepEqual(ports.notify.sent, [n]);
  assert.ok(ports.repo.paths().some((p) => p.startsWith('state/transcriptions/')), 'the reply is kept: the fix-and-retry is free');

  const again = await watch(intent({ list: [entry({ year: 2027, dates: { first: '2027-10-08', last: '2027-10-10' }, window: { from: '2026-09-01', to: '2027-10-10' } })] }), ports);
  assert.equal(again.reports[0]!.outcome, 'nothing', 'the same images are not a new failure');
  assert.equal(ports.notify.sent.length, 1);
});

test('watcher: a reply the library refuses is a failure with the problem named', async () => {
  const ports = firstDay();
  ports.vision = fakeVision({ notSchedules: ['sponsor.jpg'], reply: '{"festival_name": "LOW TIDE", "days": []}' });
  const result = await watch(intent(), ports);
  assert.equal(result.reports[0]!.outcome, 'failed');
  assert.equal(result.notifications.length, 1);
  assert.match(result.notifications[0]!.body, /couldn't read that into a schedule|don't hold together/);
});

test('watcher: a change that drops a published stage is refused in words, never offered', async () => {
  const { ports } = await liveThenChanged();
  const withoutCellar = JSON.parse(recordedReply()) as { days: { stages: { name: string }[] }[] };
  withoutCellar.days[0]!.stages = withoutCellar.days[0]!.stages.filter((s) => s.name !== 'CELLAR STAGE');
  ports.vision = fakeVision({ notSchedules: ['sponsor.jpg'], replies: { 'friday-v2.png': JSON.stringify(withoutCellar) } });
  const result = await watch(intent(), ports);
  assert.equal(result.reports[0]!.outcome, 'failed');
  assert.deepEqual(result.pullRequests, []);
  assert.match(result.notifications[0]!.body, /Cellar Stage is not in the new images, and people have already added it/);
});

test('watcher: a blocked edition gets no review, whatever the page does', async () => {
  const { ports } = await liveThenChanged();
  ports.repo.published.editions['low-tide-2026']!.blocked = true;
  const result = await watch(intent(), ports);
  assert.equal(result.reports[0]!.outcome, 'change');
  assert.deepEqual(result.pullRequests, []);
  assert.deepEqual(result.notifications, []);
  assert.match(result.reports[0]!.problem!, /blocked/);
});

test('watcher: a review that will not open becomes a notice carrying what it would have said', async () => {
  const ports = firstDay();
  const failing = fakeRepository({ pullRequestsFail: true });
  ports.repo = failing;
  const result = await watch(intent(), ports);
  assert.equal(result.reports[0]!.outcome, 'drop');
  assert.deepEqual(result.pullRequests, []);
  assert.equal(result.notifications.length, 1);
  assert.equal(result.notifications[0]!.title, 'Review could not be opened: Set times dropped: Low Tide 2026');
  assert.match(result.notifications[0]!.body, /HTTP 403/);
  assert.match(result.notifications[0]!.body, /## Main Stage/);
  assert.ok(result.commit, 'the reply and the state are on main regardless');
});

// ---------------------------------------------------------------------------
// The poll
// ---------------------------------------------------------------------------

test('watcher: an unreachable page is reported and nothing is written', async () => {
  const ports = firstDay();
  ports.pages.pages[SOURCE] = null;
  const result = await watch(intent(), ports);
  assert.equal(result.reports[0]!.outcome, 'unreachable');
  assert.equal(result.commit, null);
  assert.equal(ports.vision.checks, 0);
  assert.equal(ports.pages.imageFetches.length, 0);
});

test('watcher: a page with no schedule on it yet is nothing — the verdicts are kept so nothing is screened twice', async () => {
  const ports = firstDay();
  ports.pages.pages[SOURCE] = schedulePage([BANNER]);
  const result = await watch(intent(), ports);
  assert.equal(result.reports[0]!.outcome, 'nothing');
  assert.equal(ports.vision.checks, 1, 'the banner');
  assert.ok(result.commit, 'the verdict is recorded');
  assert.deepEqual(result.commit!.files.map((f) => f.path), ['state/watch.json']);

  const again = await watch(intent(), ports);
  assert.equal(again.commit, null, 'an unchanged page writes nothing');
  assert.equal(ports.vision.checks, 1);
});

test('watcher: entries not due on this run are skipped, and force polls them anyway', async () => {
  const ports = firstDay();
  ports.clock.set(Date.parse('2026-09-01T03:00:00Z'));
  const skipped = await watch(intent(), ports);
  assert.equal(skipped.reports[0]!.outcome, 'not-due');
  assert.equal(skipped.reports[0]!.cadence, 'daily');
  assert.equal(ports.pages.pageFetches.length, 0);

  const forced = await watch(intent({ force: true }), ports);
  assert.equal(forced.reports[0]!.outcome, 'drop');

  ports.clock.set(Date.parse('2026-12-01T15:00:00Z'));
  const over = await watch(intent({ force: true }), ports);
  assert.equal(over.reports[0]!.outcome, 'dormant', 'force never wakes a finished festival');
});

test('watcher: match narrows the page to the images it names', async () => {
  const ports = firstDay();
  const result = await watch(intent({ list: [entry({ match: 'sponsor' })] }), ports);
  assert.equal(result.reports[0]!.outcome, 'nothing');
  assert.deepEqual(ports.pages.imageFetches, [BANNER]);
  assert.deepEqual(ports.vision.checked, ['sponsor.jpg']);
});

test('watcher: two entries in one run share one state commit, and each review branches off it', async () => {
  const ports = firstDay();
  const OTHER = 'https://othertide.example/schedule';
  const OTHER_IMAGE = 'https://cdn.example.net/files/other-friday.png';
  ports.pages.pages[OTHER] = schedulePage([OTHER_IMAGE]);
  ports.pages.images[OTHER_IMAGE] = { bytes: pngBytes(1170, 2532, 'other friday'), contentType: 'image/png' };
  const result = await watch(intent({ list: [entry(), entry({ festival: 'Other Tide', slug: 'other-tide', source: OTHER })] }), ports);
  assert.deepEqual(result.reports.map((r) => r.outcome), ['drop', 'drop']);
  assert.equal(ports.repo.commits.length, 1);
  assert.equal(result.commit!.message, 'Watch: Low Tide 2026: drop; Other Tide 2026: drop');
  assert.equal(result.pullRequests.length, 2);
  assert.ok(result.pullRequests.every((pr) => pr.from === 'commit-1'), 'both reviews branch off the one state commit');
  assert.notEqual(result.pullRequests[0]!.branch, result.pullRequests[1]!.branch);
});

// ---------------------------------------------------------------------------
// The committed watch list and the schedule it runs from
// ---------------------------------------------------------------------------

test('watcher: the committed watch list names ACL, III Points, Camp Flog Gnaw, EDC Orlando, Corona Capital, Portola, Oceans Calling and Ohana for 2026, each with a schedule page and a drop window', () => {
  const list = loadWatchList(readFileSync(join(REPO_ROOT, 'config', 'watch.yaml'), 'utf8'));
  const keys = list.map((e) => `${e.slug}-${e.year}`);
  assert.deepEqual(keys, ['austin-city-limits-2026', 'iii-points-2026', 'camp-flog-gnaw-2026', 'edc-orlando-2026', 'corona-capital-2026', 'portola-2026', 'oceans-calling-2026', 'ohana-2026']);
  for (const e of list) {
    assert.match(e.source, /^https:\/\//, `${e.festival}: the schedule page is an https link`);
    assert.ok(e.window.from < e.dates.first, `${e.festival}: the drop window opens before the festival`);
    assert.equal(e.window.to, e.dates.last, `${e.festival}: hourly through the last day`);
  }
  assert.equal(cadenceOf(list[0]!, Date.UTC(2026, 8, 21)), 'hourly', 'ACL is inside its window today');
  assert.equal(cadenceOf(list[2]!, Date.UTC(2026, 8, 21)), 'daily', 'Camp Flog Gnaw is not yet');
  assert.equal(list[0]!.match, 'ACL26-Schedule', 'ACL: both weekends are one edition — the six schedule images and nothing else on the page');
  assert.equal(list[0]!.dates.first, '2026-10-02', 'ACL: from weekend one');
  const subreddits = Object.fromEntries(list.map((e) => [e.slug, e.subreddit]));
  assert.deepEqual(subreddits, {
    'austin-city-limits': undefined,
    'iii-points': 'IIIPoints',
    'camp-flog-gnaw': 'CampFlogGnaw',
    'edc-orlando': 'EDCOrlando',
    'corona-capital': 'coronacapital',
    portola: undefined,
    'oceans-calling': undefined,
    ohana: undefined,
  }, 'the signal watches the four subreddits the owner found on 2026-09-21; ACL and this weekend\'s three have none on record');
  assert.equal(list[7]!.match, 'SetTimes', 'Ohana: the three set-times images, not the partner logos beside them');
  assert.equal(list[5]!.match, 'SetTimes', 'Portola: the two set-times images, not the per-stage lineup posters beside them');
});

test('watcher: the job runs hourly from a schedule with the permissions a review needs, and no server', () => {
  const workflow = parseYaml(readFileSync(join(REPO_ROOT, '.github', 'workflows', 'watch.yml'), 'utf8')) as {
    on: { schedule: { cron: string }[]; workflow_dispatch: unknown };
    permissions: Record<string, string>;
    concurrency: { group: string };
    jobs: { watch: { steps: { run?: string; env?: Record<string, string> }[] } };
  };
  assert.match(workflow.on.schedule[0]!.cron, /^\d{1,2} \* \* \* \*$/, 'every hour; the cadence is the watcher\'s');
  assert.ok(workflow.on.workflow_dispatch, 'and by hand');
  assert.equal(workflow.permissions['contents'], 'write');
  assert.equal(workflow.permissions['pull-requests'], 'write');
  assert.equal(workflow.permissions['issues'], 'write');
  assert.equal(workflow.concurrency.group, 'watch', 'two runs never poll at once');
  const run = workflow.jobs.watch.steps.find((s) => s.run?.includes('npm run watch'))!;
  assert.ok(run, 'the entrypoint is npm run watch');
  assert.ok(run.env!['ANTHROPIC_API_KEY'] && run.env!['GITHUB_TOKEN'], 'the two secrets the ports need');
});

test('watcher: the scheduled entrypoint imports the watcher, the signal and the ports and nothing else', () => {
  const source = readFileSync(join(REPO_ROOT, 'src', 'watch.ts'), 'utf8');
  const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['./ports.js', './signal.js', './watcher.js', 'node:fs']);
});
