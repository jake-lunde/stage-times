/**
 * The two serverless adapters: HTTP in, the publisher's own answer out.
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
import { handle as handleRemove } from '../api/remove.js';
import { sha256, type Review, type SourceImage } from '../src/publisher.js';
import { fakePorts, image, weekendImages, weekendVision, type Fakes } from './publisher-fakes.js';
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
  email: 'sam@example.com',
  image: imageBody(),
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
  assert.equal(review.editionPath, 'fan/low-tide-2026');
  assert.equal(review.sets.length, 5);
  assert.equal(review.timezoneAssumed, true);
  assert.equal(ports.repo.commits.length, 1, 'the adapter added no writes of its own');
});

test("adapter: a gate comes back with the publisher's own words and a status that fits", async () => {
  const ports = fakePorts();
  const res = await handleUpload(post({ ...UPLOAD_BODY, email: 'not-an-address' }), ports);
  assert.equal(res.status, 400);
  const body = (await res.json()) as { ok: boolean; gate: string; reason: string };
  assert.equal(body.ok, false);
  assert.equal(body.gate, 'details');
  assert.equal(body.reason, "That email address doesn't look right.", 'passed through, not reworded');
});

test('adapter: a capped upload answers 429, an unreadable one 422', async () => {
  const capped = fakePorts();
  capped.repo.uploads = {
    uploads: [0, 1, 2].map((i) => ({
      address: sha256('sam@example.com'),
      at: capped.clock.now() - i * 1000,
      image: sha256(`x${i}`),
    })),
  };
  const one = await handleUpload(post(UPLOAD_BODY), capped);
  assert.equal(one.status, 429);
  assert.equal(((await one.json()) as { gate: string }).gate, 'address-cap');

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

test('adapter: confirm publishes and hands back the edition and the secret, once', async () => {
  const ports = fakePorts();
  const review = await uploadOk(ports);
  const res = await handleConfirm(
    post({
      festival: 'Low Tide',
      email: 'sam@example.com',
      timezone: review.timezone,
      timezoneAssumed: review.timezoneAssumed,
      edits: [{ index: 0, artist: 'Avery Cochrane' }],
      unverifiable: [],
      image: imageBody(),
    }),
    ports,
  );
  assert.equal(res.status, 200, await res.clone().text());
  const body = (await res.json()) as { ok: boolean; editionPath: string; updateSecret: string };
  assert.equal(body.ok, true);
  assert.equal(body.editionPath, 'fan/low-tide-2026');
  assert.match(body.updateSecret, /^[A-Za-z0-9_-]{43}$/);
  assert.match(ports.repo.file('data/fan/low-tide-2026.yaml')!, /artist: "Avery Cochrane"/);
});

test('adapter: an unverifiable set answers 409 and publishes nothing', async () => {
  const ports = fakePorts();
  const review = await uploadOk(ports);
  const res = await handleConfirm(
    post({
      festival: 'Low Tide',
      email: 'sam@example.com',
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
  assert.equal(ports.repo.file('data/fan/low-tide-2026.yaml'), undefined);
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
      email: 'sam@example.com',
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
// The adapters hold no rules
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The update link
// ---------------------------------------------------------------------------

async function publishedLink(ports: Fakes): Promise<{ editionPath: string; secret: string }> {
  const review = await uploadOk(ports);
  const res = await handleConfirm(
    post({ festival: 'Low Tide', email: 'sam@example.com', timezone: review.timezone, timezoneAssumed: true, edits: [], unverifiable: [], image: imageBody() }),
    ports,
  );
  const body = (await res.json()) as { editionPath: string; updateSecret: string };
  return { editionPath: body.editionPath, secret: body.updateSecret };
}

test('adapter: an update link rides through upload and confirm as a correction', async () => {
  const ports = fakePorts();
  const update = await publishedLink(ports);
  const up = await handleUpload(post({ ...UPLOAD_BODY, update }), ports);
  assert.equal(up.status, 200, await up.clone().text());
  const review = ((await up.json()) as { review: Review }).review;
  assert.equal(review.correcting, true);
  assert.equal(review.editionPath, 'fan/low-tide-2026');

  const res = await handleConfirm(
    post({ festival: 'Low Tide', email: 'sam@example.com', timezone: review.timezone, timezoneAssumed: true, edits: [], unverifiable: [], image: imageBody(), update }),
    ports,
  );
  const body = (await res.json()) as { editionPath: string; updateSecret: string; corrected: boolean };
  assert.equal(body.corrected, true);
  assert.equal(body.editionPath, 'fan/low-tide-2026');
  assert.equal(body.updateSecret, update.secret);
});

test('adapter: remove takes the edition down with the right link and answers 403 with a wrong one', async () => {
  const ports = fakePorts();
  const update = await publishedLink(ports);
  const wrong = await handleRemove(post({ update: { ...update, secret: 'nope' } }), ports);
  assert.equal(wrong.status, 403);
  assert.equal(((await wrong.json()) as { gate: string }).gate, 'update-link');
  assert.equal(ports.repo.published.editions['fan/low-tide-2026']!.blocked, false);

  const res = await handleRemove(post({ update }), ports);
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(ports.repo.published.editions['fan/low-tide-2026']!.blocked, true);

  const bad = await handleRemove(post({}), ports);
  assert.equal(bad.status, 400, 'no link, nothing to go on');
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
    'UPLOADS_PER',
    'fan/',
    'data/',
    'state/',
    'Date.now',
    'randomBytes',
  ];

  for (const file of ['upload.ts', 'confirm.ts', 'remove.ts']) {
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
