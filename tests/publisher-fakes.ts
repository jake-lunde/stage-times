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
  type PublisherPorts,
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
}

export function fakeVision(options: { reply?: string; isSchedule?: boolean; saw?: string } = {}): FakeVision {
  const reply = options.reply ?? recordedReply();
  const vision: FakeVision = {
    checks: 0,
    transcriptions: 0,
    async looksLikeSchedule(): Promise<ScheduleCheck> {
      vision.checks += 1;
      return options.isSchedule === false ? { isSchedule: false, saw: options.saw ?? 'a crowd' } : { isSchedule: true };
    },
    async transcribe(): Promise<string> {
      vision.transcriptions += 1;
      return reply;
    },
  };
  return vision;
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
  /** The contents of a committed text file, latest write wins. */
  file(path: string): string | undefined;
  /** Every path any commit wrote, text and images. */
  paths(): string[];
}

export const FIXED_PUBLISHED_AT = '20260101T000000Z';

export function fakeRepository(initial: Partial<Pick<FakeRepository, 'published' | 'uploads'>> = {}): FakeRepository {
  const files = new Map<string, string>();
  const repo: FakeRepository = {
    published: initial.published ?? { publishedAt: FIXED_PUBLISHED_AT, editions: {} },
    uploads: initial.uploads ?? { uploads: [] },
    transcriptions: new Map(),
    commits: [],
    async readPublished() {
      return repo.published;
    },
    async readUploads() {
      return repo.uploads;
    },
    async readTranscription(hash) {
      return repo.transcriptions.get(hash) ?? null;
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
  };
}
