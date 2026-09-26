/**
 * Fake ports for the publisher seam. Not a test file — `npm test` globs
 * tests/*.test.ts.
 *
 * Everything the publisher touches, faked: a vision model that replays a
 * recorded reply and counts what it was asked for, an in-memory repository, a
 * clock that only moves when a test moves it, and randomness that is a counter.
 * No network, no model, no filesystem beyond reading the recorded reply once.
 *
 * The vision fake counts calls on purpose. "Every gate rejects with no vision
 * spend" is a claim about what crosses the seam into the model, so the count is
 * an output of the seam, not a peek inside it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type ClockPort,
  type Commit,
  type OwnerPort,
  type Progress,
  type ProgressPort,
  type PublisherPorts,
  type RandomPort,
  type RepositoryPort,
  type SavedTranscription,
  type ScheduleCheck,
  type SourceImage,
  type VisionPort,
  type WebPort,
} from '../src/publisher.js';
import type { PublishedFile } from '../src/build.js';
import type { FetchedImage, WebPage } from '../src/web.js';
import { REPO_ROOT } from './helpers.js';

// ---------------------------------------------------------------------------
// Recorded model output
// ---------------------------------------------------------------------------

/** One day of a small festival, the shape a real model reply has. */
export function recordedReply(name = 'low-tide.json'): string {
  return readFileSync(join(REPO_ROOT, 'tests', 'fixtures', 'model-output', name), 'utf8');
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/** A stand-in source image. The bytes only ever get hashed. */
export function image(overrides: Partial<SourceImage> = {}): SourceImage {
  return {
    filename: 'schedule.webp',
    contentType: 'image/webp',
    bytes: new TextEncoder().encode('the friday schedule, as pixels'),
    width: 1170,
    height: 2532,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Vision
// ---------------------------------------------------------------------------

export interface FakeVision extends VisionPort {
  /** How many times the cheap yes-or-no check was asked. */
  checks: number;
  /** How many times the expensive call was made. This is the spend. */
  transcriptions: number;
  /** The file name of every image the cheap check was asked about, in order. */
  checked: string[];
  /** The file name of every image that was transcribed, in order. */
  transcribed: string[];
}

export interface FakeVisionOptions {
  /** The reply for any image without one of its own in `replies`. */
  reply?: string;
  /** A reply per image, by file name — one day's image, one day's reply. */
  replies?: Record<string, string>;
  isSchedule?: boolean;
  /** File names the cheap check says no to. Everything else is a schedule. */
  notSchedules?: string[];
  saw?: string;
}

export function fakeVision(options: FakeVisionOptions = {}): FakeVision {
  const reply = options.reply ?? recordedReply();
  const vision: FakeVision = {
    checks: 0,
    transcriptions: 0,
    checked: [],
    transcribed: [],
    async looksLikeSchedule(image): Promise<ScheduleCheck> {
      vision.checks += 1;
      vision.checked.push(image.filename);
      const no = options.isSchedule === false || (options.notSchedules ?? []).includes(image.filename);
      return no ? { isSchedule: false, saw: options.saw ?? 'a crowd' } : { isSchedule: true };
    },
    async transcribe(image): Promise<string> {
      vision.transcriptions += 1;
      vision.transcribed.push(image.filename);
      return options.replies?.[image.filename] ?? reply;
    },
  };
  return vision;
}

/**
 * Three days of Low Tide, one image each, in day order. Friday is the
 * one-image fixture everything else uses; Saturday and Sunday add a set list
 * of their own, and Sunday a stage the other days do not have.
 */
export function weekendImages(): SourceImage[] {
  return [
    image({ filename: 'friday.webp', bytes: new TextEncoder().encode('the friday schedule, as pixels') }),
    image({ filename: 'saturday.png', contentType: 'image/png', bytes: new TextEncoder().encode('the saturday schedule, as pixels') }),
    image({ filename: 'sunday.jpg', contentType: 'image/jpeg', bytes: new TextEncoder().encode('the sunday schedule, as pixels') }),
  ];
}

/** The fake vision for `weekendImages()`: each day's image reads as that day. */
export function weekendVision(options: Omit<FakeVisionOptions, 'replies'> = {}): FakeVision {
  return fakeVision({
    ...options,
    replies: {
      'friday.webp': recordedReply('low-tide.json'),
      'saturday.png': recordedReply('low-tide-saturday.json'),
      'sunday.jpg': recordedReply('low-tide-sunday.json'),
    },
  });
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export interface FakeRepository extends RepositoryPort {
  published: PublishedFile;
  transcriptions: Map<string, SavedTranscription>;
  /** Every commit applied, in order. */
  commits: Commit[];
  /** The contents of a committed text file, latest write wins. */
  file(path: string): string | undefined;
  /** Every path any commit wrote, text and images. */
  paths(): string[];
}

export const FIXED_PUBLISHED_AT = '20260101T000000Z';

export interface FakeRepositoryOptions extends Partial<Pick<FakeRepository, 'published'>> {
  /** Text files already on main when the test starts, by path — the almanac, say. */
  files?: Record<string, string>;
}

export function fakeRepository(initial: FakeRepositoryOptions = {}): FakeRepository {
  const files = new Map<string, string>(Object.entries(initial.files ?? {}));
  const repo: FakeRepository = {
    published: initial.published ?? { publishedAt: FIXED_PUBLISHED_AT, editions: {} },
    transcriptions: new Map(),
    commits: [],
    async readPublished() {
      return repo.published;
    },
    async readTranscription(hash) {
      return repo.transcriptions.get(hash) ?? null;
    },
    async readFile(path) {
      return files.get(path) ?? null;
    },
    async commit(commit) {
      repo.commits.push(commit);
      for (const f of commit.files) files.set(f.path, f.contents);
      // Apply the state files the way a real repository would, so a second
      // intent in the same test sees what the first one wrote.
      const published = commit.files.find((f) => f.path === 'state/published.json');
      if (published) repo.published = JSON.parse(published.contents) as PublishedFile;
      for (const f of commit.files) {
        const stored = /^state\/transcriptions\/([0-9a-f]{64})\.json$/.exec(f.path);
        if (stored) repo.transcriptions.set(stored[1]!, JSON.parse(f.contents) as SavedTranscription);
      }
      return `commit-${repo.commits.length}`;
    },
    file(path) {
      return files.get(path);
    },
    paths() {
      return repo.commits.flatMap((c) => [...c.files.map((f) => f.path), ...c.images.map((i) => i.path)]);
    },
  };
  return repo;
}

// ---------------------------------------------------------------------------
// Clock and randomness
// ---------------------------------------------------------------------------

/** 2026-10-09T18:30:00Z — ACL weekend two, which is what this is all for. */
export const FIXED_NOW = Date.UTC(2026, 9, 9, 18, 30, 0);
export const FIXED_NOW_STAMP = '20261009T183000Z';

export interface FakeClock extends ClockPort {
  set(epochMs: number): void;
}

export function fakeClock(start = FIXED_NOW): FakeClock {
  let at = start;
  return {
    now: () => at,
    set(epochMs) {
      at = epochMs;
    },
  };
}

/** Randomness that is a counter, so a secret is reproducible and obvious. */
export function fakeRandom(seed = 7): RandomPort {
  let call = 0;
  return {
    bytes(n) {
      call += 1;
      return Uint8Array.from({ length: n }, (_, i) => (seed + call + i) % 256);
    },
  };
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface FakeProgress extends ProgressPort {
  /** Every report, in the order it was made. */
  reports: Progress[];
}

export function fakeProgress(): FakeProgress {
  const reports: Progress[] = [];
  return { reports, report(p) { reports.push(p); } };
}

// ---------------------------------------------------------------------------
// The owner
// ---------------------------------------------------------------------------

/** What the fake owner port recognizes. The live one reads OWNER_SECRET. */
export const OWNER_SECRET = 'the-owner-bookmark-secret';

/**
 * Recognizes exactly one secret — or none at all, when the deployment has none
 * set (`null`) or an empty one, as `ownerMatches` in src/secrets.ts does.
 */
export function fakeOwner(secret: string | null = OWNER_SECRET): OwnerPort {
  return { recognizes: (presented) => Boolean(secret) && presented === secret };
}

// ---------------------------------------------------------------------------
// The set
// ---------------------------------------------------------------------------

export interface Fakes extends PublisherPorts {
  vision: FakeVision;
  repo: FakeRepository;
  clock: FakeClock;
}

export function fakePorts(overrides: Partial<Fakes> = {}): Fakes {
  return {
    vision: overrides.vision ?? fakeVision(),
    repo: overrides.repo ?? fakeRepository(),
    clock: overrides.clock ?? fakeClock(),
    random: overrides.random ?? fakeRandom(),
    owner: overrides.owner ?? fakeOwner(),
    ...(overrides.progress ? { progress: overrides.progress } : {}),
  };
}

// ---------------------------------------------------------------------------
// Image bytes with real headers
// ---------------------------------------------------------------------------

/**
 * Just enough of each format for `imageDimensions()` to read a size off it —
 * the header, then `seed` so two images of one size still hash apart. Nothing
 * here decodes; the bytes only ever get hashed and handed to a fake.
 */
export function pngBytes(width: number, height: number, seed = 'png'): Uint8Array {
  const out = new Uint8Array(33 + seed.length);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(out.buffer);
  view.setUint32(8, 13);
  out.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  view.setUint32(16, width);
  view.setUint32(20, height);
  out.set([8, 6, 0, 0, 0], 24);
  out.set(new TextEncoder().encode(seed), 33);
  return out;
}

export function jpegBytes(width: number, height: number, seed = 'jpeg'): Uint8Array {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const tail = new TextEncoder().encode(seed);
  return Uint8Array.from([0xff, 0xd8, ...app0, ...sof, ...tail, 0xff, 0xd9]);
}

export function gifBytes(width: number, height: number, seed = 'gif'): Uint8Array {
  const head = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, width & 0xff, width >> 8, height & 0xff, height >> 8, 0, 0, 0];
  return Uint8Array.from([...head, ...new TextEncoder().encode(seed)]);
}

export function webpBytes(width: number, height: number, seed = 'webp'): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  const chunk = [
    0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, // 'VP8X', size 10
    0, 0, 0, 0,
    w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff,
    h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff,
  ];
  const tail = new TextEncoder().encode(seed);
  const size = 4 + chunk.length + tail.length;
  return Uint8Array.from([
    0x52, 0x49, 0x46, 0x46, size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >> 24) & 0xff,
    0x57, 0x45, 0x42, 0x50,
    ...chunk,
    ...tail,
  ]);
}

// ---------------------------------------------------------------------------
// The web, for the link intent
// ---------------------------------------------------------------------------

/** Where every name resolves unless a test says otherwise: a documentation-free public address. */
export const PUBLIC_ADDRESS = '93.184.216.34';

export interface FakeWeb extends WebPort {
  /** Every host name resolved, in order. */
  resolved: string[];
  /** Every page URL asked for, in order. */
  pageFetches: string[];
  /** Every image URL asked for, in order. */
  imageFetches: string[];
  /** A page URL answers with its HTML (a 200) or a whole answer; anything else with nothing. */
  pages: Record<string, string | WebPage | null>;
  images: Record<string, FetchedImage | null>;
  /** What a host name resolves to. Anything not named resolves to `PUBLIC_ADDRESS`. */
  dns: Record<string, string[]>;
}

/** Recorded schedule pages, as the link intent's web port answers them. */
export function fakeWeb(
  initial: { pages?: FakeWeb['pages']; images?: FakeWeb['images']; dns?: FakeWeb['dns'] } = {},
): FakeWeb {
  const web: FakeWeb = {
    resolved: [],
    pageFetches: [],
    imageFetches: [],
    pages: { ...initial.pages },
    images: { ...initial.images },
    dns: { ...initial.dns },
    async resolve(hostname) {
      web.resolved.push(hostname);
      return web.dns[hostname] ?? [PUBLIC_ADDRESS];
    },
    async page(url) {
      web.pageFetches.push(url);
      const answer = web.pages[url];
      if (answer === undefined || answer === null) return null;
      return typeof answer === 'string' ? { status: 200, url, contentType: 'text/html; charset=utf-8', html: answer } : answer;
    },
    async image(url) {
      web.imageFetches.push(url);
      return web.images[url] ?? null;
    },
  };
  return web;
}

export interface LinkFakes extends Fakes {
  web: FakeWeb;
}

export function fakeLinkPorts(overrides: Partial<LinkFakes> = {}): LinkFakes {
  return { ...fakePorts(overrides), web: overrides.web ?? fakeWeb() };
}
