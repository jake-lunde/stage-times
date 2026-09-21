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
  addressHash,
  type ClockPort,
  type Commit,
  type Notification,
  type NotifyPort,
  type OwnerPort,
  type PublisherPorts,
  type PullRequest,
  type RandomPort,
  type RepositoryPort,
  type SavedTranscription,
  type ScheduleCheck,
  type SourceImage,
  type UploadLedger,
  type UploadRecord,
  type VisionPort,
  sha256,
} from '../src/publisher.js';
import type { PublishedFile } from '../src/build.js';
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
  uploads: UploadLedger;
  transcriptions: Map<string, SavedTranscription>;
  /** Every commit applied, in order. */
  commits: Commit[];
  /** Every pull request opened, in order. Nothing in one is applied until `merge()`. */
  pullRequests: PullRequest[];
  /** Apply an opened pull request's commit, as merging it from the GitHub app would. */
  merge(pr: PullRequest): Promise<void>;
  /** The contents of a committed text file, latest write wins. */
  file(path: string): string | undefined;
  /** Every path any commit wrote, text and images. */
  paths(): string[];
}

export const FIXED_PUBLISHED_AT = '20260101T000000Z';

export interface FakeRepositoryOptions extends Partial<Pick<FakeRepository, 'published' | 'uploads'>> {
  /** Make opening a pull request fail, as GitHub would with a token missing that permission. */
  pullRequestsFail?: boolean;
}

export function fakeRepository(initial: FakeRepositoryOptions = {}): FakeRepository {
  const files = new Map<string, string>();
  const repo: FakeRepository = {
    published: initial.published ?? { publishedAt: FIXED_PUBLISHED_AT, editions: {} },
    uploads: initial.uploads ?? { uploads: [] },
    transcriptions: new Map(),
    commits: [],
    pullRequests: [],
    async readPublished() {
      return repo.published;
    },
    async readUploads() {
      return repo.uploads;
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
      const uploads = commit.files.find((f) => f.path === 'state/uploads.json');
      if (uploads) repo.uploads = JSON.parse(uploads.contents) as UploadLedger;
      for (const f of commit.files) {
        const stored = /^state\/transcriptions\/([0-9a-f]{64})\.json$/.exec(f.path);
        if (stored) repo.transcriptions.set(stored[1]!, JSON.parse(f.contents) as SavedTranscription);
      }
      return `commit-${repo.commits.length}`;
    },
    async openPullRequest(pr) {
      if (initial.pullRequestsFail) throw new Error('GitHub pull request write answered HTTP 403: Resource not accessible');
      repo.pullRequests.push(pr);
    },
    async merge(pr) {
      await repo.commit(pr.commit);
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

/** An upload ledger holding `count` entries for one address, all just now. */
export function ledgerOf(entries: { email: string; at: number; image?: string }[]): UploadLedger {
  const uploads: UploadRecord[] = entries.map((e, i) => ({
    address: addressHash(e.email),
    at: e.at,
    image: e.image ?? sha256(`filler-${i}`),
  }));
  return { uploads };
}

// ---------------------------------------------------------------------------
// Clock, randomness, notifications
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

export interface FakeNotifier extends NotifyPort {
  sent: Notification[];
}

export function fakeNotifier(): FakeNotifier {
  const sent: Notification[] = [];
  return { sent, async send(n) { sent.push(n); } };
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
  notify: FakeNotifier;
  clock: FakeClock;
}

export function fakePorts(overrides: Partial<Fakes> = {}): Fakes {
  return {
    vision: overrides.vision ?? fakeVision(),
    repo: overrides.repo ?? fakeRepository(),
    notify: overrides.notify ?? fakeNotifier(),
    clock: overrides.clock ?? fakeClock(),
    random: overrides.random ?? fakeRandom(),
    owner: overrides.owner ?? fakeOwner(),
  };
}
