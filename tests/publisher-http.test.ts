/**
 * The serverless adapters: HTTP in, the publisher's own answer out.
 *
 * They are driven here exactly as a deployment drives them — a real `Request`
 * object with a JSON body — but with the fake ports, so no network, no model
 * and no clock. What is asserted is that the response carries the publisher's
 * result unchanged, and that the files themselves hold no rule of their own.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { handle as handleUpload } from '../api/upload.js';
import { handle as handleConfirm } from '../api/confirm.js';
import { handle as handleLink } from '../api/link.js';
import { GATE_COPY, type Review, type SourceImage } from '../src/publisher.js';
import { STREAM_TYPE } from '../src/publisher-http.js';
import {
  fakeLinkPorts,
  fakeOwner,
  fakePorts,
  fakeWeb,
  image,
  OWNER_SECRET,
  pngBytes,
  weekendImages,
  weekendVision,
  type Fakes,
} from './publisher-fakes.js';
import { REPO_ROOT } from './helpers.js';

const IMAGE = image();

function imageBody(bytes: Uint8Array = IMAGE.bytes) {
  return {
    filename: IMAGE.filename,
    contentType: IMAGE.contentType,
    width: IMAGE.width,
    height: IMAGE.height,
    data: Buffer.from(bytes).toString('base64'),
  };
}

function post(body: unknown): Request {
  return new Request('https://stagetimes.app/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const UPLOAD_BODY = {
  festival: 'Low Tide',
  dates: { first: '2026-10-09', last: '2026-10-09' },
  image: imageBody(),
  owner: OWNER_SECRET,
};

async function uploadOk(ports: Fakes): Promise<Review> {
  const res = await handleUpload(post(UPLOAD_BODY), ports);
  assert.equal(res.status, 200, await res.clone().text());
  return ((await res.json()) as { review: Review }).review;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

test('adapter: a well-formed upload returns the review the publisher built', async () => {
  const ports = fakePorts();
  const review = await uploadOk(ports);
  assert.equal(review.editionPath, 'low-tide-2026');
  assert.equal(review.sets.length, 5);
  assert.equal(review.timezoneAssumed, true);
  assert.equal(ports.repo.commits.length, 1, 'the adapter added no writes of its own');
});

test("adapter: a gate comes back with the publisher's own words and a status that fits", async () => {
  const ports = fakePorts();
  const res = await handleUpload(post({ ...UPLOAD_BODY, festival: '  ' }), ports);
  assert.equal(res.status, 400);
  const body = (await res.json()) as { ok: boolean; gate: string; reason: string };
  assert.equal(body.ok, false);
  assert.equal(body.gate, 'details');
  assert.equal(body.reason, "Type the festival's name first.", 'passed through, not reworded');
});

test('adapter: an unreadable upload answers 422', async () => {
  const notASchedule = fakePorts();
  notASchedule.vision.looksLikeSchedule = async () => ({ isSchedule: false });
  const two = await handleUpload(post(UPLOAD_BODY), notASchedule);
  assert.equal(two.status, 422);
  assert.equal(((await two.json()) as { gate: string }).gate, 'schedule');
});

test('adapter: a body that is not an intent is a 400 that spends nothing', async () => {
  const ports = fakePorts();
  for (const body of ['not json at all', {}, { ...UPLOAD_BODY, image: undefined }, { ...UPLOAD_BODY, dates: 'soon' }]) {
    const res = await handleUpload(post(body), ports);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 40));
    assert.equal(((await res.json()) as { ok: boolean }).ok, false);
  }
  assert.equal(ports.vision.checks + ports.vision.transcriptions, 0);
});

// ---------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------

test('adapter: confirm publishes and hands back where the edition lives', async () => {
  const ports = fakePorts();
  const review = await uploadOk(ports);
  const res = await handleConfirm(
    post({
      festival: 'Low Tide',
      owner: OWNER_SECRET,
      timezone: review.timezone,
      timezoneAssumed: review.timezoneAssumed,
      edits: [{ index: 0, artist: 'Avery Cochrane' }],
      unverifiable: [],
      image: imageBody(),
    }),
    ports,
  );
  assert.equal(res.status, 200, await res.clone().text());
  const body = (await res.json()) as { ok: boolean; editionPath: string };
  assert.deepEqual(body, { ok: true, editionPath: 'low-tide-2026' });
  assert.match(ports.repo.file('data/low-tide-2026.yaml')!, /artist: "Avery Cochrane"/);
});

test('adapter: an unverifiable set answers 409 and publishes nothing', async () => {
  const ports = fakePorts();
  const review = await uploadOk(ports);
  const res = await handleConfirm(
    post({
      festival: 'Low Tide',
      owner: OWNER_SECRET,
      timezone: review.timezone,
      timezoneAssumed: review.timezoneAssumed,
      edits: [],
      unverifiable: [2],
      image: imageBody(),
    }),
    ports,
  );
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { gate: string }).gate, 'review');
  assert.equal(ports.repo.file('data/low-tide-2026.yaml'), undefined);
});

// ---------------------------------------------------------------------------
// More than one image
// ---------------------------------------------------------------------------

function dayBody(img: SourceImage) {
  return { filename: img.filename, contentType: img.contentType, width: img.width, height: img.height, data: Buffer.from(img.bytes).toString('base64') };
}

test('adapter: an images list goes through as one upload and one confirm, with the review echoed back', async () => {
  const ports = fakePorts({ vision: weekendVision() });
  const images = weekendImages().map(dayBody);
  const up = await handleUpload(post({ ...UPLOAD_BODY, image: undefined, dates: { first: '2026-10-09', last: '2026-10-11' }, images }), ports);
  assert.equal(up.status, 200, await up.clone().text());
  const review = ((await up.json()) as { review: Review }).review;
  assert.equal(review.images.length, 3);
  assert.equal(review.sets.length, 11);

  const res = await handleConfirm(
    post({
      festival: 'Low Tide',
      owner: OWNER_SECRET,
      timezone: review.timezone,
      timezoneAssumed: review.timezoneAssumed,
      edits: [],
      unverifiable: [],
      images,
      reviewed: review.images,
    }),
    ports,
  );
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(ports.repo.commits.at(-1)!.images.length, 3);
});

test('adapter: a rejection about one image says which, by position', async () => {
  const ports = fakePorts({ vision: weekendVision({ notSchedules: ['saturday.png'] }) });
  const res = await handleUpload(post({ ...UPLOAD_BODY, image: undefined, images: weekendImages().map(dayBody) }), ports);
  assert.equal(res.status, 422);
  const body = (await res.json()) as { gate: string; reason: string; image: number };
  assert.equal(body.gate, 'schedule');
  assert.equal(body.image, 1);
  assert.match(body.reason, /^Day 2: /);
});

test('adapter: an images field that is not a list of images is a 400', async () => {
  const ports = fakePorts();
  for (const images of ['three', [null], [{ filename: 'x' }]]) {
    const res = await handleUpload(post({ ...UPLOAD_BODY, image: undefined, images }), ports);
    assert.equal(res.status, 400, JSON.stringify(images));
  }
  const tooMany = await handleUpload(post({ ...UPLOAD_BODY, images: Array.from({ length: 9 }, () => imageBody()) }), ports);
  assert.equal(tooMany.status, 400);
  assert.equal(((await tooMany.json()) as { gate: string }).gate, 'images');
});

// ---------------------------------------------------------------------------
// The owner field
// ---------------------------------------------------------------------------

function confirmBody(review: Review, extra: Record<string, unknown> = {}) {
  return {
    festival: 'Low Tide',
    timezone: review.timezone,
    timezoneAssumed: review.timezoneAssumed,
    edits: [],
    unverifiable: [],
    image: imageBody(),
    ...extra,
  };
}

test('adapter: the owner field reaches the publisher, and the owner confirm publishes at the root', async () => {
  const ports = fakePorts();
  const review = await uploadOk(ports);
  assert.equal(review.editionPath, 'low-tide-2026');
  const done = await handleConfirm(post(confirmBody(review, { owner: OWNER_SECRET })), ports);
  assert.equal(done.status, 200, await done.clone().text());
});

test('adapter: without the owner secret every adapter answers 403 in one sentence, and nothing is spent', async () => {
  const ports = fakePorts();
  const review = await uploadOk(ports);
  const commits = ports.repo.commits.length;
  const checks = ports.vision.checks;
  const links = fakeLinkPorts({ vision: weekendVision(), web: weekendPage() });
  for (const owner of [undefined, 'not-the-owner-secret', '', 42, null, { secret: OWNER_SECRET }, [OWNER_SECRET]]) {
    const answers = [
      await handleUpload(post({ ...UPLOAD_BODY, owner }), ports),
      await handleConfirm(post(confirmBody(review, { owner })), ports),
      await handleLink(post({ url: SCHEDULE, owner }), links),
    ];
    for (const res of answers) {
      assert.equal(res.status, 403, `owner: ${JSON.stringify(owner)}`);
      assert.deepEqual(await res.json(), { ok: false, gate: 'owner', reason: GATE_COPY.owner });
    }
  }
  const unset = await handleUpload(post(UPLOAD_BODY), fakePorts({ owner: fakeOwner(null) }));
  assert.equal(unset.status, 403, 'no secret on the deployment: nobody is the owner');
  assert.equal(ports.repo.commits.length, commits, 'nothing written');
  assert.equal(ports.vision.checks, checks, 'nothing asked');
  assert.deepEqual(links.web.pageFetches, [], 'nothing fetched');
});

// ---------------------------------------------------------------------------
// Link
// ---------------------------------------------------------------------------

const SCHEDULE = 'https://lowtide.example/schedule';

/** The weekend on a festival's page, as the link adapter's web sees it. */
function weekendPage() {
  const posters = {
    'https://lowtide.example/img/friday.webp': pngBytes(1080, 1920, 'friday'),
    'https://lowtide.example/img/saturday.png': pngBytes(1080, 1920, 'saturday'),
    'https://lowtide.example/img/sunday.jpg': pngBytes(1080, 1920, 'sunday'),
  };
  return fakeWeb({
    pages: { [SCHEDULE]: Object.keys(posters).map((u) => `<img src="${u}">`).join('\n') },
    images: Object.fromEntries(Object.entries(posters).map(([u, bytes]) => [u, { bytes, contentType: 'image/png' }])),
  });
}

test('adapter: a link returns the review, the days and the link as read, and the images, which confirm takes back', async () => {
  const ports = fakeLinkPorts({ vision: weekendVision(), web: weekendPage() });
  const res = await handleLink(post({ url: SCHEDULE, owner: OWNER_SECRET }), ports);
  assert.equal(res.status, 200, await res.clone().text());
  const body = (await res.json()) as { review: Review; officialUrl: string; days: string[]; images: Record<string, unknown>[] };
  assert.equal(body.officialUrl, SCHEDULE);
  assert.deepEqual(body.days, ['2026-10-09', '2026-10-10', '2026-10-11']);
  assert.equal(body.images.length, 3);
  assert.deepEqual(Object.keys(body.images[0]!).sort(), ['contentType', 'data', 'filename', 'height', 'width']);

  const confirmed = await handleConfirm(
    post({
      images: body.images,
      reviewed: body.review.images,
      festival: body.review.festival,
      owner: OWNER_SECRET,
      timezone: body.review.timezone,
      timezoneAssumed: body.review.timezoneAssumed,
      officialUrl: body.officialUrl,
    }),
    ports,
  );
  assert.equal(confirmed.status, 200, await confirmed.clone().text());
  assert.equal(((await confirmed.json()) as { editionPath: string }).editionPath, 'low-tide-2026');
});

test('adapter: a link the publisher cannot read comes back as its sentence, with a status for each reason', async () => {
  const ports = fakeLinkPorts({ web: fakeWeb() });
  const cases: [Record<string, unknown>, number, string][] = [
    [{ url: 'http://127.0.0.1/', owner: OWNER_SECRET }, 400, 'address'],
    [{ url: SCHEDULE, owner: OWNER_SECRET }, 502, 'unreachable'],
  ];
  for (const [body, status, gate] of cases) {
    const res = await handleLink(post(body), ports);
    assert.equal(res.status, status, `${gate}: ${await res.clone().text()}`);
    const answer = (await res.json()) as { gate: string; reason: string };
    assert.equal(answer.gate, gate);
    assert.match(answer.reason, /screenshots/);
  }

  const unreadable = await handleLink(post({ owner: OWNER_SECRET }), ports);
  assert.equal(unreadable.status, 400, 'no link, nothing to go on');
});

test('adapter: each file contains only request parsing and the publisher call', () => {
  const allowed = new Set(['../src/publisher.js', '../src/publisher-http.js', '../src/ports.js']);
  // Anything that decides rather than parses. If one of these ever appears in
  // an adapter, a rule has leaked out of the seam and into the transport.
  const rules = [
    'transcribe',
    'slugify',
    'schema',
    'namespace',
    'sha256',
    'MAX_IMAGE',
    'fan/',
    'data/',
    'state/',
    'Date.now',
    'randomBytes',
    'OWNER_SECRET',
    'ownerMatches',
    'listed',
  ];

  for (const file of ['upload.ts', 'link.ts', 'confirm.ts']) {
    const source = readFileSync(join(REPO_ROOT, 'api', file), 'utf8');
    const code = source.replace(/\/\*\*[\s\S]*?\*\//g, ''); // the header comment explains; it does not run
    const imports = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
    assert.ok(imports.length > 0, `${file} imports nothing`);
    for (const specifier of imports) {
      assert.ok(allowed.has(specifier), `api/${file} imports ${specifier} — an adapter knows only the publisher`);
    }
    for (const rule of rules) {
      assert.equal(code.includes(rule), false, `api/${file} mentions ${rule} — that belongs in the seam`);
    }
  }
});

// ---------------------------------------------------------------------------
// The stream (ticket 21): progress lines ahead of the answer, on one request
// ---------------------------------------------------------------------------

function streamPost(body: unknown): Request {
  return new Request('https://stagetimes.app/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: STREAM_TYPE },
    body: JSON.stringify(body),
  });
}

async function lines(res: Response): Promise<unknown[]> {
  const text = await res.text();
  assert.ok(text.endsWith('\n'), 'every line ends in a newline, the last one too');
  return text.trimEnd().split('\n').map((l) => JSON.parse(l) as unknown);
}

const WEEKEND_BODY = { ...UPLOAD_BODY, image: undefined, dates: { first: '2026-10-09', last: '2026-10-11' }, images: weekendImages().map(dayBody) };

test('adapter stream: upload sends one line per progress report, then the answer, on the same request', async () => {
  const res = await handleUpload(streamPost(WEEKEND_BODY), fakePorts({ vision: weekendVision() }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), `${STREAM_TYPE}; charset=utf-8`);
  const all = await lines(res);
  const progress = all.slice(0, -1) as { progress: { kind: string; step: string; done: number } }[];
  assert.deepEqual(
    progress.map((l) => [l.progress.step, l.progress.done]),
    [['checked', 0], ['checked', 0], ['checked', 0], ['read', 1], ['read', 2], ['read', 3]],
    'each report as its own line, in the order the publisher made them',
  );
  assert.equal((all.at(-1) as { ok: boolean }).ok, true, 'the answer comes last');
});

test("adapter stream: a client that reads only the final line gets exactly today's response body", async () => {
  const plain = await handleUpload(post(WEEKEND_BODY), fakePorts({ vision: weekendVision() }));
  const streamed = await handleUpload(streamPost(WEEKEND_BODY), fakePorts({ vision: weekendVision() }));
  assert.deepEqual((await lines(streamed)).at(-1), await plain.json(), 'the same review, byte for byte once parsed');
});

test("adapter stream: a rejection's final line is today's rejection, gate, reason and image and all", async () => {
  const body = { ...WEEKEND_BODY };
  const plain = await handleUpload(post(body), fakePorts({ vision: weekendVision({ notSchedules: ['sunday.jpg'] }) }));
  const streamed = await handleUpload(streamPost(body), fakePorts({ vision: weekendVision({ notSchedules: ['sunday.jpg'] }) }));
  const all = await lines(streamed);
  assert.deepEqual(all.at(-1), await plain.json());
  assert.equal(all.length, 3, 'Friday and Saturday cleared the check before Sunday did not');
});

test('adapter stream: a body that is not an intent is still a plain 400, streamed or not', async () => {
  const res = await handleUpload(streamPost({ festival: 'Low Tide' }), fakePorts());
  assert.equal(res.status, 400);
  assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
});

test('adapter stream: without asking for the stream, the answer is exactly as it was — status and all', async () => {
  const res = await handleUpload(post(WEEKEND_BODY), fakePorts({ vision: weekendVision({ notSchedules: ['sunday.jpg'] }) }));
  assert.equal(res.status, 422);
  assert.match(res.headers.get('content-type') ?? '', /^application\/json/);
});

test('adapter stream: a link sends its own steps, then each check and reading, then the answer, on the same request (ticket 20)', async () => {
  const ports = fakeLinkPorts({ vision: weekendVision(), web: weekendPage() });
  const res = await handleLink(
    new Request('https://stagetimes.app/api/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: STREAM_TYPE },
      body: JSON.stringify({ url: SCHEDULE, owner: OWNER_SECRET }),
    }),
    ports,
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), `${STREAM_TYPE}; charset=utf-8`);
  const all = await lines(res);
  const progress = all.slice(0, -1) as { progress: { kind: string; step: string; images?: number; done?: number } }[];
  assert.deepEqual(
    progress.map((l) => [l.progress.kind, l.progress.step, l.progress.images ?? l.progress.done]),
    [['link', 'page', undefined], ['link', 'found', 3], ['read', 'checked', 0], ['read', 'checked', 0], ['read', 'checked', 0], ['read', 'read', 1], ['read', 'read', 2], ['read', 'read', 3]],
  );
  const answer = all.at(-1) as { ok: boolean; days: string[]; images: unknown[] };
  assert.equal(answer.ok, true);
  assert.deepEqual(answer.days, ['2026-10-09', '2026-10-10', '2026-10-11']);
  assert.equal(answer.images.length, 3, 'the same body a plain request gets, as the last line');
  const plain = await handleLink(post({ url: SCHEDULE, owner: OWNER_SECRET }), fakeLinkPorts({ vision: weekendVision(), web: weekendPage() }));
  assert.deepEqual(answer, await plain.json());
});

test('adapter: confirm reads `days` as the days as checked, and refuses a list that is not one', async () => {
  const ports = fakeLinkPorts({ vision: weekendVision(), web: weekendPage() });
  const linked = (await (await handleLink(post({ url: SCHEDULE, owner: OWNER_SECRET }), ports)).json()) as { review: Review; officialUrl: string; images: Record<string, unknown>[] };
  const body = {
    images: linked.images,
    reviewed: linked.review.images,
    festival: 'Low Tide',
    owner: OWNER_SECRET,
    timezone: linked.review.timezone,
    timezoneAssumed: linked.review.timezoneAssumed,
    officialUrl: linked.officialUrl,
  };
  const bad = await handleConfirm(post({ ...body, days: 'next weekend' }), ports);
  assert.equal(bad.status, 400, 'not a list: the request could not be read');
  const moved = await handleConfirm(post({ ...body, days: ['2027-10-08', '2027-10-09', '2027-10-10'] }), ports);
  assert.equal(moved.status, 200, await moved.clone().text());
  assert.equal(((await moved.json()) as { editionPath: string }).editionPath, 'low-tide-2027', 'the days moved, and the year with them');
});

test("adapter stream: confirm streams checking, saving, done, then today's answer", async () => {
  const ports = fakePorts({ vision: weekendVision() });
  const up = await handleUpload(post(WEEKEND_BODY), ports);
  const review = ((await up.json()) as { review: Review }).review;
  const res = await handleConfirm(
    streamPost({
      festival: 'Low Tide',
      owner: OWNER_SECRET,
      timezone: review.timezone,
      timezoneAssumed: review.timezoneAssumed,
      edits: [],
      unverifiable: [],
      images: WEEKEND_BODY.images,
      reviewed: review.images,
    }),
    ports,
  );
  const all = await lines(res);
  assert.deepEqual(
    all.slice(0, -1).map((l) => (l as { progress: { step: string } }).progress.step),
    ['checking', 'saving', 'done'],
  );
  const answer = all.at(-1) as { ok: boolean; editionPath: string };
  assert.deepEqual(Object.keys(answer).sort(), ['editionPath', 'ok'], "today's confirm answer, nothing added");
  assert.equal(answer.editionPath, 'low-tide-2026');
});
