/**
 * The owner's secret: every intent carries it, and without it nothing happens
 * (ADR-0005). Upload, link and confirm each refuse a missing, wrong or
 * unconfigured secret before any other gate — no field is judged, no model is
 * asked, no page is fetched, nothing is written, and no one is told.
 *
 * Fake ports throughout, as in tests/publisher.test.ts. The owner port is a
 * fake that recognizes one fixed secret; what each test asserts on is what
 * crossed the seam, never how the check is done inside.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { confirm, GATE_COPY, link, upload, type ConfirmIntent, type Review, type UploadIntent } from '../src/publisher.js';
import { fakeLinkPorts, fakeOwner, fakePorts, image, OWNER_SECRET, type Fakes } from './publisher-fakes.js';

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

/** Nothing crossed the seam: no model, no write. */
function untouched(ports: Fakes, commitsBefore = 0): void {
  assert.equal(ports.vision.checks + ports.vision.transcriptions, 0, 'no model was asked anything');
  assert.equal(ports.repo.commits.length, commitsBefore, 'nothing was written');
}

const NOT_THE_OWNER: [string, Partial<UploadIntent>, Fakes][] = [
  ['no secret', { owner: undefined }, fakePorts()],
  ['a wrong secret', { owner: 'not-the-owner-secret' }, fakePorts()],
  ['a deployment with no secret set', {}, fakePorts({ owner: fakeOwner(null) })],
  ['an empty secret', { owner: '' }, fakePorts({ owner: fakeOwner('') })],
];

test('owner: an upload without the owner secret is refused first, and nothing is spent or written', async () => {
  for (const [what, overrides, ports] of NOT_THE_OWNER) {
    // A bad image too: the secret is checked before the image is.
    const result = await upload(uploadIntent({ ...overrides, image: image({ contentType: 'application/pdf' }) }), ports);
    assert.equal(result.ok, false, what);
    assert.equal(result.rejection!.gate, 'owner', `${what}: refused at the first gate, not the image's`);
    assert.equal(result.rejection!.reason, GATE_COPY.owner);
    untouched(ports);
  }
});

test('owner: a link without the owner secret is refused before any address is looked up or page fetched', async () => {
  const ports = fakeLinkPorts();
  const result = await link({ kind: 'link', url: 'https://lowtide.example/schedule' }, ports);
  assert.equal(result.ok, false);
  assert.equal(result.rejection!.gate, 'owner');
  assert.deepEqual(ports.web.resolved, [], 'no name was resolved');
  assert.deepEqual([...ports.web.pageFetches, ...ports.web.imageFetches], [], 'no page and no image was fetched');
  untouched(ports);
});

test('owner: a confirm without the owner secret publishes nothing, even for a review the owner made', async () => {
  const ports = fakePorts();
  const up = await upload(uploadIntent(), ports);
  assert.ok(up.ok, up.rejection?.reason);
  const commitsBefore = ports.repo.commits.length;
  const checks = ports.vision.checks;
  const transcriptions = ports.vision.transcriptions;

  for (const owner of [undefined, 'not-the-owner-secret']) {
    const result = await confirm(confirmIntent(up.review!, { owner }), ports);
    assert.equal(result.ok, false);
    assert.equal(result.rejection!.gate, 'owner');
    assert.equal(result.editionPath, null);
  }
  assert.equal(ports.repo.commits.length, commitsBefore, 'nothing was committed');
  assert.equal(ports.vision.checks, checks);
  assert.equal(ports.vision.transcriptions, transcriptions);
  assert.equal(ports.repo.file('state/published.json'), undefined, 'no edition exists');
});

test('owner: with the secret, the same upload and confirm publish at the root, listed', async () => {
  const ports = fakePorts();
  const up = await upload(uploadIntent(), ports);
  assert.ok(up.ok, up.rejection?.reason);
  const result = await confirm(confirmIntent(up.review!), ports);
  assert.ok(result.ok, result.rejection?.reason);
  assert.equal(result.editionPath, 'low-tide-2026');
});
