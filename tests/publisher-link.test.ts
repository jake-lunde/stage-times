/**
 * The publisher's link intent: the festival's schedule page instead of
 * screenshots (ticket 19).
 *
 * Same fakes as the upload tests, plus a web that replays recorded pages. The
 * claims are about what crosses the seam — which addresses were resolved or
 * asked for, which images reached the model, what was committed — so every
 * one is an output of the fakes, not a peek inside the publisher.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  confirm,
  link,
  LINK_COPY,
  MAX_UPLOAD_IMAGES,
  publish,
  SCREENED_PATH,
  sha256,
  upload,
  UPLOADS_PATH,
  UPLOADS_PER_ADDRESS_PER_HOUR,
  UPLOADS_PER_DAY,
  type ConfirmIntent,
  type LinkIntent,
  type LinkResult,
  type SourceImage,
  type UploadLedger,
} from '../src/publisher.js';
import { loadFestivalFromString } from '../src/schema.js';
import {
  fakeLinkPorts,
  fakeRepository,
  fakeVision,
  fakeWeb,
  FIXED_NOW,
  jpegBytes,
  ledgerOf,
  pngBytes,
  recordedReply,
  webpBytes,
  weekendVision,
  type FakeWeb,
  type LinkFakes,
} from './publisher-fakes.js';

const UPLOADER = 'sam@example.com';
const SCHEDULE = 'https://lowtide.example/schedule';
const IMG = 'https://lowtide.example/img';

/** The three day posters as a festival's site serves them: real headers, one per format. */
function weekendOnTheWeb(): Record<string, { bytes: Uint8Array; contentType: string }> {
  return {
    [`${IMG}/friday.webp`]: { bytes: webpBytes(1080, 1920, 'the friday schedule'), contentType: 'image/webp' },
    [`${IMG}/saturday.png`]: { bytes: pngBytes(1080, 1920, 'the saturday schedule'), contentType: 'image/png' },
    [`${IMG}/sunday.jpg`]: { bytes: jpegBytes(1080, 1920, 'the sunday schedule'), contentType: 'image/jpeg' },
  };
}

/** A page with the site's logo, the three posters, and whatever else a test adds. */
function pageOf(urls: string[]): string {
  return [
    '<!DOCTYPE html><html><head><title>Schedule</title>',
    `<meta property="og:image" content="${IMG}/share.png">`,
    '</head><body>',
    `<img src="${IMG}/logo.png" alt="Low Tide">`,
    ...urls.map((u) => `<img src="${u}">`),
    '</body></html>',
  ].join('\n');
}

/** The web as a festival that posted its weekend: the page, the posters, the logo and the share card. */
function weekendWeb(extra: { pages?: FakeWeb['pages']; images?: FakeWeb['images']; dns?: FakeWeb['dns'] } = {}): FakeWeb {
  const posters = weekendOnTheWeb();
  return fakeWeb({
    pages: { [SCHEDULE]: pageOf(Object.keys(posters)), ...extra.pages },
    images: {
      ...posters,
      // Neither can be a schedule by its size alone: a logo, and a wide share card too short to read.
      [`${IMG}/logo.png`]: { bytes: pngBytes(240, 80, 'logo'), contentType: 'image/png' },
      [`${IMG}/share.png`]: { bytes: pngBytes(1200, 300, 'share'), contentType: 'image/png' },
      ...extra.images,
    },
    ...(extra.dns ? { dns: extra.dns } : {}),
  });
}

function linkPorts(overrides: Partial<LinkFakes> = {}): LinkFakes {
  return fakeLinkPorts({ vision: weekendVision(), web: weekendWeb(), ...overrides });
}

function linkIntent(overrides: Partial<LinkIntent> = {}): LinkIntent {
  return { kind: 'link', url: SCHEDULE, email: UPLOADER, ...overrides };
}

/** The same posters as an uploader holding them would upload them, in the same order. */
function asUploaded(): SourceImage[] {
  return Object.entries(weekendOnTheWeb()).map(([url, { bytes, contentType }]) => ({
    filename: url.split('/').at(-1)!,
    contentType,
    bytes,
    width: 1080,
    height: 1920,
  }));
}

function confirmOf(result: LinkResult, overrides: Partial<ConfirmIntent> = {}): ConfirmIntent {
  const review = result.review!;
  return {
    kind: 'confirm',
    images: result.images,
    reviewed: review.images,
    festival: review.festival,
    email: UPLOADER,
    timezone: review.timezone,
    timezoneAssumed: review.timezoneAssumed,
    officialUrl: result.officialUrl!,
    edits: [],
    unverifiable: [],
    ...overrides,
  };
}

async function okLink(ports: LinkFakes, intent: LinkIntent = linkIntent()): Promise<LinkResult> {
  const result = await link(intent, ports);
  assert.equal(result.ok, true, `the link was refused: ${result.rejection?.reason}`);
  return result;
}

// ---------------------------------------------------------------------------
// One review across every day, read off the page
// ---------------------------------------------------------------------------

test('a link to a page of per-day schedule images returns one review across every day, the same review an upload of those images gives', async () => {
  const ports = linkPorts();
  const result = await okLink(ports);
  const review = result.review!;

  assert.equal(review.festival, 'Low Tide', 'the name is read off the images');
  assert.equal(review.year, 2026, 'the year is read off the images');
  assert.deepEqual(result.days, ['2026-10-09', '2026-10-10', '2026-10-11'], 'the days are read off the images');
  assert.equal(result.officialUrl, SCHEDULE, 'the link is the official schedule');
  assert.deepEqual(review.images, asUploaded().map((i) => sha256(i.bytes)), 'every day, in page order');
  assert.deepEqual(
    [...new Set(review.sets.map((s) => s.image))].sort(),
    [...review.images].sort(),
    'the sets span all three images',
  );

  // The same images uploaded, by someone who typed what the page said.
  const uploaded = await upload(
    {
      kind: 'upload',
      festival: 'Low Tide',
      dates: { first: '2026-10-09', last: '2026-10-11' },
      email: UPLOADER,
      officialUrl: SCHEDULE,
      images: asUploaded(),
    },
    fakeLinkPorts({ vision: weekendVision() }),
  );
  assert.equal(uploaded.ok, true, `the upload was refused: ${uploaded.rejection?.reason}`);
  assert.deepEqual(review, uploaded.review, 'a link and an upload of the same images give the same review');
});

test("a link's review confirms through the existing confirm: the link is the official schedule and the stored images are the fetched bytes", async () => {
  const ports = linkPorts();
  const result = await okLink(ports);

  const confirmed = await confirm(confirmOf(result), ports);
  assert.equal(confirmed.ok, true, `confirm was refused: ${confirmed.rejection?.reason}`);
  assert.equal(confirmed.editionPath, 'fan/low-tide-2026');

  const yaml = confirmed.commit!.files.find((f) => f.path === 'data/fan/low-tide-2026.yaml')!.contents;
  const doc = loadFestivalFromString(yaml, 'low-tide-2026.yaml');
  assert.equal(doc.festival.official_url, SCHEDULE, 'the official schedule is the link');
  assert.equal(doc.festival.name, 'Low Tide');

  const posters = Object.values(weekendOnTheWeb());
  assert.deepEqual(
    confirmed.commit!.images.map((i) => i.bytes),
    posters.map((p) => p.bytes),
    'the stored source images are the bytes the page served',
  );
  assert.deepEqual(
    confirmed.commit!.images.map((i) => i.path),
    ['source/images/' + sha256(posters[0]!.bytes) + '.webp', 'source/images/' + sha256(posters[1]!.bytes) + '.png', 'source/images/' + sha256(posters[2]!.bytes) + '.jpg'],
    'each stored under its content hash',
  );
});

test('the owner secret rides on a link: the review is for the root, as an upload through the bookmark would be', async () => {
  const result = await okLink(linkPorts(), linkIntent({ owner: 'the-owner-bookmark-secret' }));
  assert.equal(result.review!.namespace, 'owner');
  assert.equal(result.review!.editionPath, 'low-tide-2026');
});

test('publish() routes a link intent to the link intent', async () => {
  const result = await publish(linkIntent(), linkPorts());
  assert.equal(result.ok, true, `publish refused the link: ${result.rejection?.reason}`);
  assert.equal(result.officialUrl, SCHEDULE);
});

// ---------------------------------------------------------------------------
// Dropped by size, before any model call; at most the upload limit
// ---------------------------------------------------------------------------

test('images that cannot be a schedule are dropped by the size in their header before any model call', async () => {
  const web = weekendWeb({
    pages: {
      [SCHEDULE]: pageOf([
        `${IMG}/banner.gif`,
        `${IMG}/huge.png`,
        `${IMG}/icon.svg`,
        ...Object.keys(weekendOnTheWeb()),
      ]),
    },
    images: {
      [`${IMG}/banner.gif`]: { bytes: pngBytes(1600, 200, 'banner'), contentType: 'image/png' },
      [`${IMG}/huge.png`]: { bytes: pngBytes(9000, 12000, 'huge'), contentType: 'image/png' },
      [`${IMG}/icon.svg`]: { bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), contentType: 'image/svg+xml' },
    },
  });
  const ports = linkPorts({ web });
  const result = await okLink(ports);

  assert.deepEqual(ports.vision.checked, ['friday.webp', 'saturday.png', 'sunday.jpg'], 'only the three that could be a schedule were asked about');
  assert.deepEqual(ports.vision.transcribed, ['friday.webp', 'saturday.png', 'sunday.jpg']);
  assert.equal(result.review!.images.length, 3);
  assert.ok(web.imageFetches.includes(`${IMG}/huge.png`), 'the oversized image was fetched, and its header dropped it');
});

test('a page that lists thirty images reads the seven largest and says so in the review notes', async () => {
  const posters = weekendOnTheWeb();
  const images: FakeWeb['images'] = {};
  const urls: string[] = [];
  // Twenty-three photos big enough to pass the free gates but smaller than any poster…
  for (let i = 0; i < 23; i += 1) {
    const url = `${IMG}/photo-${i}.jpg`;
    urls.push(url);
    images[url] = { bytes: jpegBytes(800, 600 + i, `photo ${i}`), contentType: 'image/jpeg' };
  }
  // …four banners bigger than the posters, which the check says are not a schedule…
  for (let i = 0; i < 4; i += 1) {
    const url = `${IMG}/banner-${i}.jpg`;
    urls.splice(i * 5, 0, url);
    images[url] = { bytes: jpegBytes(2400, 1600, `banner ${i}`), contentType: 'image/jpeg' };
  }
  // …and the three posters, somewhere in the middle.
  urls.splice(10, 0, ...Object.keys(posters));
  assert.equal(urls.length, 30, 'the page lists thirty images');

  const web = fakeWeb({ pages: { [SCHEDULE]: pageOf(urls).replace(/<img src="[^"]*logo[^>]*>/, '').replace(/<meta[^>]*>/, '') }, images: { ...posters, ...images } });
  const vision = weekendVision({ notSchedules: ['banner-0.jpg', 'banner-1.jpg', 'banner-2.jpg', 'banner-3.jpg'] });
  const ports = linkPorts({ web, vision });
  const result = await okLink(ports);

  assert.equal(web.imageFetches.length, 30, 'every image on the page was fetched once');
  assert.equal(vision.checks, MAX_UPLOAD_IMAGES, 'no more than one upload can carry was asked about');
  assert.deepEqual(
    [...vision.checked].sort(),
    ['banner-0.jpg', 'banner-1.jpg', 'banner-2.jpg', 'banner-3.jpg', 'friday.webp', 'saturday.png', 'sunday.jpg'],
    'the seven largest',
  );
  assert.deepEqual(vision.transcribed, ['friday.webp', 'saturday.png', 'sunday.jpg'], 'the banners dropped out at the check, not the link');
  assert.equal(result.review!.images.length, 3);
  assert.ok(
    result.review!.observations.includes('The page had 30 images big enough to be the schedule, and only the 7 largest were read.'),
    `the notes say so: ${JSON.stringify(result.review!.observations)}`,
  );
});

// ---------------------------------------------------------------------------
// Gated, hashed and cached exactly as an upload
// ---------------------------------------------------------------------------

test('a link tried twice costs nothing the second time', async () => {
  const ports = linkPorts();
  const first = await okLink(ports);
  assert.equal(first.reused, false);
  const commits = ports.repo.commits.length;
  const { checks, transcriptions } = ports.vision;

  const second = await okLink(ports);
  assert.equal(ports.vision.checks, checks, 'no schedule check the second time');
  assert.equal(ports.vision.transcriptions, transcriptions, 'no transcription the second time');
  assert.equal(ports.repo.commits.length, commits, 'nothing written the second time');
  assert.equal(second.reused, true);
  assert.equal(second.commit, null);
  assert.deepEqual(second.review, { ...first.review!, reused: true }, 'the same review');
});

test('a banner the check said no to is remembered, so a page with one still costs nothing the second time', async () => {
  const web = weekendWeb({
    pages: { [SCHEDULE]: pageOf([`${IMG}/crowd.jpg`, ...Object.keys(weekendOnTheWeb())]) },
    images: { [`${IMG}/crowd.jpg`]: { bytes: jpegBytes(2400, 1600, 'a crowd'), contentType: 'image/jpeg' } },
  });
  const vision = weekendVision({ notSchedules: ['crowd.jpg'] });
  const ports = linkPorts({ web, vision });

  const first = await okLink(ports);
  assert.deepEqual(first.review!.images.length, 3, 'the crowd is not a day');
  const crowd = sha256(jpegBytes(2400, 1600, 'a crowd'));
  assert.ok(JSON.parse(ports.repo.file(SCREENED_PATH)!).notSchedules[crowd], 'the no is committed');

  const checks = vision.checks;
  await okLink(ports);
  assert.equal(vision.checks, checks, 'the crowd was not asked about again');
});

test('a page whose images are already in the transcription store costs nothing and counts against nothing', async () => {
  const repo = fakeRepository();
  const uploader = fakeLinkPorts({ vision: weekendVision(), repo });
  const uploaded = await upload(
    { kind: 'upload', festival: 'Low Tide', dates: { first: '2026-10-09', last: '2026-10-11' }, email: 'kai@example.com', officialUrl: SCHEDULE, images: asUploaded() },
    uploader,
  );
  assert.equal(uploaded.ok, true, `the upload was refused: ${uploaded.rejection?.reason}`);

  const vision = weekendVision();
  const ports = linkPorts({ repo, vision });
  const commits = repo.commits.length;
  const result = await okLink(ports);
  assert.equal(vision.checks, 0, 'a saved reply is a schedule: no check');
  assert.equal(vision.transcriptions, 0, 'a saved reply is not read again');
  assert.equal(repo.commits.length, commits, 'nothing written');
  assert.equal(result.reused, true);
  assert.equal(repo.uploads.uploads.length, 1, 'only the upload is on the ledger');
});

test('a screenshot upload of the same poster after a link is free', async () => {
  const ports = linkPorts();
  await okLink(ports);
  const { checks, transcriptions } = ports.vision;
  const commits = ports.repo.commits.length;

  const uploaded = await upload(
    { kind: 'upload', festival: 'Low Tide', dates: { first: '2026-10-09', last: '2026-10-11' }, email: 'kai@example.com', images: asUploaded().slice(1, 2) },
    ports,
  );
  assert.equal(uploaded.ok, true, `the upload was refused: ${uploaded.rejection?.reason}`);
  assert.equal(uploaded.reused, true, 'the reply the link paid for is reused');
  assert.equal(ports.vision.checks, checks, 'no check');
  assert.equal(ports.vision.transcriptions, transcriptions, 'no transcription');
  assert.equal(ports.repo.commits.length, commits, 'nothing written');
});

test("a link's paid readings are stored under each image's content hash, exactly as an upload's", async () => {
  const ports = linkPorts();
  const result = await okLink(ports);
  for (const hash of result.review!.images) {
    const stored = ports.repo.transcriptions.get(hash);
    assert.ok(stored, `a reply is stored for ${hash}`);
    assert.equal(stored.image, hash);
  }
  const friday = ports.repo.transcriptions.get(result.review!.images[0]!)!;
  assert.equal(friday.output, recordedReply('low-tide.json'), 'the reply, verbatim');
  assert.equal(friday.filename, 'friday.webp', 'named after the image on the page');
  assert.ok(result.commit!.files.some((f) => f.path === `state/transcriptions/${friday.image}.json`));
});

// ---------------------------------------------------------------------------
// What cannot be read comes back as one sentence naming screenshots
// ---------------------------------------------------------------------------

function assertScreenshotSentence(result: LinkResult, gate: string, sentence: string, what: string): void {
  assert.equal(result.ok, false, `${what} should be refused`);
  assert.equal(result.rejection!.gate, gate, `${what}: gate`);
  assert.equal(result.rejection!.reason, sentence, `${what}: sentence`);
  assert.match(result.rejection!.reason, /screenshots/, `${what}: names screenshots`);
  assert.equal(result.rejection!.reason.split(/[.?!](\s|$)/).filter((s) => s && s.trim()).length, 1, `${what}: one sentence`);
  assert.equal(result.review, null);
}

test('an unreachable page returns one plain sentence naming screenshots', async () => {
  const down = linkPorts({ web: fakeWeb() });
  assertScreenshotSentence(await link(linkIntent(), down), 'unreachable', LINK_COPY.unreachable, 'a page that did not answer');

  const missing = linkPorts({ web: fakeWeb({ pages: { [SCHEDULE]: { status: 404, url: SCHEDULE, contentType: 'text/html', html: 'Not found' } } }) });
  assertScreenshotSentence(await link(linkIntent(), missing), 'unreachable', LINK_COPY.unreachable, 'a 404');

  const nowhere = linkPorts({ web: fakeWeb({ dns: { 'lowtide.example': [] } }) });
  assertScreenshotSentence(await link(linkIntent(), nowhere), 'unreachable', LINK_COPY.unreachable, 'a name that resolves to nothing');
  assert.deepEqual(nowhere.web.pageFetches, [], 'a name that resolves to nothing is not asked for');
  assert.equal(down.vision.checks + missing.vision.checks + nowhere.vision.checks, 0, 'no model call');
});

test('a login-walled page returns one plain sentence naming screenshots', async () => {
  const redirected = linkPorts({
    web: fakeWeb({
      pages: {
        'https://www.instagram.com/lowtidefest/': {
          status: 200,
          url: 'https://www.instagram.com/accounts/login/?next=%2Flowtidefest%2F',
          contentType: 'text/html',
          html: '<form><input name="username"><input type="password" name="password"></form>',
        },
      },
    }),
  });
  assertScreenshotSentence(await link(linkIntent({ url: 'https://www.instagram.com/lowtidefest/' }), redirected), 'login', LINK_COPY.login, 'a redirect to a sign-in page');

  const walled = linkPorts({ web: fakeWeb({ pages: { [SCHEDULE]: { status: 401, url: SCHEDULE, contentType: 'text/html', html: '' } } }) });
  assertScreenshotSentence(await link(linkIntent(), walled), 'login', LINK_COPY.login, 'a 401');
  assert.equal(walled.web.imageFetches.length + redirected.web.imageFetches.length, 0, 'no image fetched behind a login');
});

test('a page with no schedule images returns one plain sentence naming screenshots, and records what it paid for', async () => {
  const bare = linkPorts({ web: fakeWeb({ pages: { [SCHEDULE]: '<html><body><p>Set times coming soon.</p></body></html>' } }) });
  assertScreenshotSentence(await link(linkIntent(), bare), 'no-schedule', LINK_COPY.noSchedule, 'a page with no images');
  assert.equal(bare.vision.checks, 0, 'nothing to ask about');
  assert.equal(bare.repo.commits.length, 0);

  const smalls = linkPorts({ web: weekendWeb({ pages: { [SCHEDULE]: pageOf([]) } }) });
  assertScreenshotSentence(await link(linkIntent(), smalls), 'no-schedule', LINK_COPY.noSchedule, 'a page of only a logo and a share card');
  assert.equal(smalls.vision.checks, 0, 'dropped by size, before any model call');

  const lineup = linkPorts({ vision: fakeVision({ isSchedule: false }) });
  const result = await link(linkIntent(), lineup);
  assertScreenshotSentence(result, 'no-schedule', LINK_COPY.noSchedule, 'a page whose images are not schedules');
  assert.equal(lineup.vision.checks, 3, 'each was asked about once');
  assert.equal(lineup.vision.transcriptions, 0);
  assert.equal(lineup.repo.uploads.uploads.length, 1, 'the checks it paid for count as one upload');
  assert.equal(Object.keys(JSON.parse(lineup.repo.file(SCREENED_PATH)!).notSchedules).length, 3, 'and every no is remembered');

  await link(linkIntent(), lineup);
  assert.equal(lineup.vision.checks, 3, 'so the same page costs nothing the second time');
});

test('an address that is not a public http(s) page returns one plain sentence naming screenshots, before any request', async () => {
  for (const url of ['ftp://lowtide.example/schedule', 'javascript:alert(1)', 'not a link', 'https://sam:pw@lowtide.example/', '']) {
    const ports = linkPorts();
    assertScreenshotSentence(await link(linkIntent({ url }), ports), 'address', LINK_COPY.address, JSON.stringify(url));
    assert.deepEqual([...ports.web.resolved, ...ports.web.pageFetches], [], `${JSON.stringify(url)}: nothing resolved or asked for`);
  }

  const pdf = linkPorts({ web: fakeWeb({ pages: { [SCHEDULE]: { status: 200, url: SCHEDULE, contentType: 'application/pdf', html: '%PDF-1.7' } } }) });
  assertScreenshotSentence(await link(linkIntent(), pdf), 'address', LINK_COPY.address, 'a PDF');
});

test('a private, loopback or link-local address is refused before any request is made', async () => {
  for (const url of [
    'http://127.0.0.1/schedule',
    'http://localhost:3000/',
    'http://10.0.0.8/schedule',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[fe80::1]/',
    'http://0x7f.1/',
  ]) {
    const ports = linkPorts();
    assertScreenshotSentence(await link(linkIntent({ url }), ports), 'address', LINK_COPY.address, url);
    assert.deepEqual([...ports.web.resolved, ...ports.web.pageFetches, ...ports.web.imageFetches], [], `${url}: no request`);
  }

  for (const [name, addresses] of [
    ['metadata.lowtide.example', ['169.254.169.254']],
    ['intranet.lowtide.example', ['10.1.2.3']],
    ['loop.lowtide.example', ['127.0.0.1']],
    ['mixed.lowtide.example', ['93.184.216.34', 'fd00::1']],
  ] as const) {
    const ports = linkPorts({ web: weekendWeb({ dns: { [name]: [...addresses] } }) });
    assertScreenshotSentence(await link(linkIntent({ url: `https://${name}/schedule` }), ports), 'address', LINK_COPY.address, name);
    assert.deepEqual(ports.web.resolved, [name], `${name}: resolved`);
    assert.deepEqual(ports.web.pageFetches, [], `${name}: never asked for`);
  }
});

test("an image on a public page that points somewhere private is never fetched", async () => {
  const web = weekendWeb({
    pages: {
      [SCHEDULE]: pageOf([
        'http://169.254.169.254/latest/meta-data/iam.png',
        'http://127.0.0.1:8080/day.png',
        'https://cdn.internal.lowtide.example/day.png',
        ...Object.keys(weekendOnTheWeb()),
      ]),
    },
    dns: { 'cdn.internal.lowtide.example': ['10.0.0.9'] },
  });
  const ports = linkPorts({ web });
  await okLink(ports);
  for (const fetched of web.imageFetches) {
    assert.ok(fetched.startsWith(IMG), `only the festival's own images are fetched, not ${fetched}`);
  }
});

// ---------------------------------------------------------------------------
// The caps: a link is one upload, checked before the page is fetched
// ---------------------------------------------------------------------------

test('the caps count a link as one upload per address per hour, checked before the page is fetched', async () => {
  const repo = fakeRepository({
    uploads: ledgerOf(Array.from({ length: UPLOADS_PER_ADDRESS_PER_HOUR }, (_, i) => ({ email: UPLOADER, at: FIXED_NOW - (i + 1) * 60_000 }))),
  });
  const ports = linkPorts({ repo });
  const result = await link(linkIntent(), ports);
  assert.equal(result.ok, false);
  assert.equal(result.rejection!.gate, 'address-cap');
  assert.deepEqual([...ports.web.resolved, ...ports.web.pageFetches, ...ports.web.imageFetches], [], 'nothing fetched');
  assert.equal(ports.vision.checks, 0);
});

test('the caps count a link as one upload per day across everyone, checked before the page is fetched', async () => {
  const repo = fakeRepository({
    uploads: ledgerOf(Array.from({ length: UPLOADS_PER_DAY }, (_, i) => ({ email: `fan${i}@example.com`, at: FIXED_NOW - (i + 1) * 60 * 60_000 }))),
  });
  const ports = linkPorts({ repo });
  const result = await link(linkIntent(), ports);
  assert.equal(result.ok, false);
  assert.equal(result.rejection!.gate, 'daily-cap');
  assert.deepEqual(ports.web.pageFetches, [], 'nothing fetched');
});

test('a link that paid for three images is one entry on the ledger, and the next upload counts it', async () => {
  const repo = fakeRepository({
    uploads: ledgerOf(Array.from({ length: UPLOADS_PER_ADDRESS_PER_HOUR - 1 }, (_, i) => ({ email: UPLOADER, at: FIXED_NOW - (i + 1) * 60_000 }))),
  });
  const ports = linkPorts({ repo });
  const result = await okLink(ports);

  const ledger = JSON.parse(result.commit!.files.find((f) => f.path === UPLOADS_PATH)!.contents) as UploadLedger;
  const mine = ledger.uploads.filter((u) => u.at === FIXED_NOW);
  assert.equal(mine.length, 1, 'one entry for the link');
  assert.deepEqual(mine[0]!.images, result.review!.images, 'naming every image it paid for');

  const next = await link(linkIntent({ url: 'https://other.example/schedule' }), ports);
  assert.equal(next.rejection?.gate, 'address-cap', 'the link counted');
});

test('an address that does not look right is refused before anything is fetched', async () => {
  const ports = linkPorts();
  const result = await link(linkIntent({ email: 'not an email' }), ports);
  assert.equal(result.rejection?.gate, 'details');
  assert.deepEqual(ports.web.pageFetches, []);
});
