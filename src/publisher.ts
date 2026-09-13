/**
 * Stage Times — the publisher seam.
 *
 * One module, one job: take an *intent* — somebody trying to make an edition
 * exist — plus injected ports, and return the writes and notifications it would
 * make. Everything that talks to the outside world is a port: the vision model,
 * the repository, notifications, the clock, and randomness. Nothing in here
 * reads a file, calls a model, opens a socket, or looks at the wall clock, so
 * every rule below is testable with fakes and no API key (`tests/publisher.test.ts`).
 *
 * Two intents live here, the two that make a fan edition exist:
 *
 *   upload   an image plus a festival name, dates and an address, through the
 *            pre-spend gates, into a review payload the uploader can check
 *            against their own image.
 *   confirm  that review, with the uploader's corrections, validated through
 *            the real schema and committed to main as an edition.
 *
 * Correction, self-removal, the owner path, the watcher and the signal are the
 * same shape and land here too (tickets 09, 10, 11, 12).
 *
 * Three rules this module exists to enforce:
 *
 *   1. **Nothing costs money before it has earned it.** The gates run in a
 *      fixed order, cheapest first, and every one of them returns a plain
 *      sentence a person can read. A previously transcribed image costs
 *      nothing at all.
 *   2. **The root namespace is owner-only.** A fan intent writes `data/fan/`
 *      and `fan/<key>` in committed state, never the root. Permanent from
 *      first publish — docs/adr/0001-fan-namespace-prefix.md.
 *   3. **The publish stamp comes from the injected clock, at commit time.**
 *      The build still never reads a clock; this is the one place a real time
 *      enters the system, and it enters as committed state.
 *
 * Secrets and addresses: the update-link secret is minted from the injected
 * randomness, returned once, and stored only as a SHA-256 hash. The uploader's
 * address is stored only as a hash too — it reaches the owner through the
 * notification, which is not a public repo.
 */

import { createHash } from 'node:crypto';
import {
  editionPath,
  type PublishedEdition,
  type PublishedFile,
  type UploaderRecord,
} from './build.js';
import { isValidTimeZone, SchemaError, type FestivalDoc, type Namespace } from './schema.js';
import { slugify, TranscribeError, type SetEdit } from './transcribe.js';
import { transcribe, type Transcription } from './transcription.js';

export type { SetEdit };

// ---------------------------------------------------------------------------
// The limits
// ---------------------------------------------------------------------------

/** What a browser will hand us for a screenshot or a photo of a poster. */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Below this on the short side there are no legible times in the image. */
export const MIN_IMAGE_EDGE = 400;
/** Above this on the long side no vision model reads it whole. */
export const MAX_IMAGE_EDGE = 8000;

/** Three uploads per address per hour, twenty per day across everyone. */
export const UPLOADS_PER_ADDRESS_PER_HOUR = 3;
export const UPLOADS_PER_DAY = 20;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The zone the times are read in when nobody has said. A source image cannot
 * carry this, so it is always shown as an assumption on review and is always
 * changeable there.
 */
export const DEFAULT_TIMEZONE = 'America/Los_Angeles';

/** Where each kind of file goes. Fan editions only — the root is owner-only. */
export const FAN_DATA_DIR = 'data/fan';
export const SOURCE_DIR = 'source';
export const SOURCE_IMAGE_DIR = 'source/images';
export const UPLOADS_PATH = 'state/uploads.json';
export const TRANSCRIPTION_STORE_DIR = 'state/transcriptions';
export const PUBLISHED_PATH = 'state/published.json';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** A source image as the browser handed it over. */
export interface SourceImage {
  /** File name as uploaded. Display and log only — never a path. */
  filename: string;
  /** MIME type the browser reported. */
  contentType: string;
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** The cheap check: is this a schedule with times on it at all? */
export interface ScheduleCheck {
  isSchedule: boolean;
  /** The model's one line about what it saw instead. Never shown raw. */
  saw?: string;
}

export interface VisionPort {
  /**
   * A small model, a yes or a no. Runs before the expensive call so garbage
   * costs pennies (spec: "every upload's cost gated by a cheap check").
   */
  looksLikeSchedule(image: SourceImage): Promise<ScheduleCheck>;
  /** The expensive call: the model's reply for this image, verbatim. */
  transcribe(image: SourceImage): Promise<string>;
}

/** One text file in a commit. */
export interface FileWrite {
  /** Repo-relative POSIX path. */
  path: string;
  contents: string;
}

/**
 * One stored source image, named by content hash.
 *
 * Kept out of `files` on purpose. This repo is public and a rights-holder block
 * has to actually delete the artwork (docs/takedown-runbook.md), which git
 * history would not — so where these bytes land is the adapter's decision, not
 * the seam's.
 */
export interface ImageWrite {
  path: string;
  contentType: string;
  bytes: Uint8Array;
}

/** Everything one intent writes, as one commit to main. */
export interface Commit {
  message: string;
  files: FileWrite[];
  images: ImageWrite[];
}

export interface RepositoryPort {
  readPublished(): Promise<PublishedFile>;
  readUploads(): Promise<UploadLedger>;
  /** The saved transcription for an image content hash, or null. */
  readTranscription(hash: string): Promise<SavedTranscription | null>;
  commit(commit: Commit): Promise<void>;
}

/** What the owner is told. GitHub is the channel; this is the content. */
export interface Notification {
  kind: 'edition-published';
  editionPath: string;
  title: string;
  body: string;
  /**
   * The uploader's address. The only place it appears — committed state keeps
   * a hash, because the repository is public and the address is a contact.
   */
  email: string;
}

export interface NotifyPort {
  send(notification: Notification): Promise<void>;
}

/** Epoch milliseconds. The one place real time enters the system. */
export interface ClockPort {
  now(): number;
}

export interface RandomPort {
  bytes(n: number): Uint8Array;
}

export interface PublisherPorts {
  vision: VisionPort;
  repo: RepositoryPort;
  notify: NotifyPort;
  clock: ClockPort;
  random: RandomPort;
}

// ---------------------------------------------------------------------------
// Committed state the publisher owns
// ---------------------------------------------------------------------------

/**
 * One upload that was paid for, for the caps. The address is a hash: the caps
 * need to recognize a repeat address, not to read it.
 */
export interface UploadRecord {
  address: string;
  /** Epoch ms, from the injected clock. */
  at: number;
  /** Content hash of the image that was transcribed. */
  image: string;
}

export interface UploadLedger {
  $comment?: string | string[];
  uploads: UploadRecord[];
}

/** A transcription already paid for, so the same image never costs twice. */
export interface SavedTranscription {
  /** SHA-256 of the image bytes, hex. Also the file name in the store. */
  image: string;
  /** The name the image was uploaded under, for the log. */
  filename: string;
  contentType: string;
  /** The model's reply, verbatim — exactly what `transcribe()` takes. */
  output: string;
  /** When it was read, as a UTC iCalendar stamp. */
  transcribedAt: string;
}

/**
 * The uploader of an edition, recorded in `state/published.json` beside the
 * `listed` and `blocked` flags — its presence is what "uploader-verified"
 * means. Defined with the rest of the committed-state shapes in src/build.ts.
 */
export type { UploaderRecord };

const UPLOADS_COMMENT = [
  'COMMITTED STATE — what the upload caps count. Not a log; entries older than 24 hours are dropped.',
  '`address` is a SHA-256 of the lowercased contact address: the caps need to recognize a repeat',
  'address, not to read it. The address itself reaches the owner through the notification only.',
  '`at` is epoch milliseconds from the publisher clock, and the only real time in committed state',
  'besides publishedAt. Nothing in the build reads this file.',
];

// ---------------------------------------------------------------------------
// Intents and results
// ---------------------------------------------------------------------------

export interface UploadIntent {
  kind: 'upload';
  /** Festival name as the uploader typed it. Becomes the display name. */
  festival: string;
  /** The days the uploader says the edition runs, ISO `YYYY-MM-DD`. */
  dates: { first: string; last: string };
  /** Contact address. Never an account (CONTEXT: uploader). */
  email: string;
  /** IANA zone the uploader picked, if any. Assumed otherwise. */
  timezone?: string;
  /** The link to the official schedule, when the image carries none. */
  officialUrl?: string;
  image: SourceImage;
}

export interface ConfirmIntent {
  kind: 'confirm';
  /** The same image the review was built from — hashed and checked. */
  image: SourceImage;
  festival: string;
  email: string;
  /** The zone as it stood on review, changed or not. */
  timezone: string;
  /** False once the uploader has confirmed or changed the zone. */
  timezoneAssumed: boolean;
  officialUrl?: string;
  /** Corrections, by set index in the review payload. */
  edits: SetEdit[];
  /** Indices of sets the uploader could not verify. Any one blocks confirm. */
  unverifiable: number[];
}

export type Intent = UploadIntent | ConfirmIntent;

/** Which gate stopped it. The screen picks its shape from this. */
export type Gate =
  | 'details'
  | 'type'
  | 'size'
  | 'dimensions'
  | 'address-cap'
  | 'daily-cap'
  | 'schedule'
  | 'expired'
  | 'review'
  | 'schema';

export interface Rejection {
  gate: Gate;
  /** One or two plain sentences, ready to put on a screen. */
  reason: string;
  /** The schema's own problems, when the schema is what refused. */
  problems?: string[];
}

/** One set as the review screen shows it, beside the uploader's own image. */
export interface ReviewSet {
  /** Position in printed order. What an edit and an unverifiable flag address. */
  index: number;
  stage: string;
  stageName: string;
  artist: string;
  /** Local wall time, `YYYY-MM-DDTHH:MM:SS`, in the edition's zone. */
  start: string;
  end: string;
  /** The end was not printed on the source — it is a guess (start + an hour). */
  endInferred: boolean;
  /** The model flagged something about this set. Look here hardest. */
  lowConfidence: boolean;
  /** The time exactly as printed on the source. */
  printedTime: string;
  notes: string;
}

export interface Review {
  /** SHA-256 of the image these sets were read from. Confirm echoes it back. */
  image: string;
  festival: string;
  /** The slug this edition would claim, suffixed if one is already taken. */
  slug: string;
  /** The year the source reads as. */
  year: number;
  /** Always `fan` for these two intents. The root is owner-only. */
  namespace: Namespace;
  /** Where the feeds would live: `fan/<slug>-<year>`. */
  editionPath: string;
  timezone: string;
  /** True while nobody has confirmed the zone. The source cannot carry it. */
  timezoneAssumed: boolean;
  /** True when the source reads as a different year than the uploader typed. */
  yearMismatch: boolean;
  stages: { id: string; name: string }[];
  sets: ReviewSet[];
  /** The model's own notes, verbatim. */
  observations: string[];
  /** True when this image had been read before and this cost nothing. */
  reused: boolean;
}

export interface UploadResult {
  ok: boolean;
  rejection: Rejection | null;
  review: Review | null;
  /** The writes to apply. Null when there is nothing to write. */
  commit: Commit | null;
  notifications: Notification[];
  /** True when an earlier upload of the same image paid for the transcription. */
  reused: boolean;
}

export interface ConfirmResult {
  ok: boolean;
  rejection: Rejection | null;
  /**
   * The update-link secret, returned once and never stored — committed state
   * keeps only its hash. Holding it is what makes someone this edition's
   * uploader (CONTEXT: update link).
   */
  updateSecret: string | null;
  /** `fan/<slug>-<year>` — where the feeds live. */
  editionPath: string | null;
  commit: Commit | null;
  notifications: Notification[];
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

export function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** SHA-256 of a contact address, case- and space-insensitively. */
export function addressHash(email: string): string {
  return sha256(email.trim().toLowerCase());
}

/** Epoch ms → the `YYYYMMDDTHHMMSSZ` stamp committed state is written in. */
export function icalStamp(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** A URL-safe secret from n injected random bytes. */
export function secretFrom(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/**
 * The slug a new fan edition gets for this festival-year.
 *
 * The first upload takes the plain slug. A second one for the same festival and
 * year — someone else's image, someone else's edition — gets `-2`, `-3`, and so
 * on, because a fan is never blocked by another fan's work and a published
 * slug is never reused (spec: slug collision inside `/fan/`). The owner
 * namespace is not consulted: it is a different URL family, and nothing here
 * may ever claim a slug in it.
 */
export function claimFanSlug(published: PublishedFile, slug: string, year: number): string {
  let candidate = slug;
  for (let n = 2; published.editions[editionPath('fan', `${candidate}-${year}`)]; n += 1) {
    candidate = `${slug}-${n}`;
  }
  return candidate;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Deliberately loose. This is a contact address, not a credential: the only
// failure that matters is a typo the uploader can see in their own sentence.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

function reject(gate: Gate, reason: string, problems?: string[]): Rejection {
  return problems ? { gate, reason, problems } : { gate, reason };
}

function rejectedUpload(rejection: Rejection, commit: Commit | null = null): UploadResult {
  return { ok: false, rejection, review: null, commit, notifications: [], reused: false };
}

function rejectedConfirm(rejection: Rejection): ConfirmResult {
  return { ok: false, rejection, updateSecret: null, editionPath: null, commit: null, notifications: [] };
}

/** Megabytes, one decimal, for a sentence a person reads. */
function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '');
}

/**
 * Does the model's own note single this set out? The review screen's
 * "look here hardest" flag. Substring on the artist, because that is the handle
 * the model uses when it is unsure ("MGNA CRRRTA re-checked — three R's are
 * printed"). Names under three characters are skipped: they match everything.
 */
export function lowConfidence(observations: string[], artist: string): boolean {
  if (artist.trim().length < 3) return false;
  const needle = artist.toLowerCase();
  return observations.some((o) => o.toLowerCase().includes(needle));
}

// ---------------------------------------------------------------------------
// The pre-spend gates
// ---------------------------------------------------------------------------

/** Type, size and dimensions: everything knowable without asking anyone. */
function checkImage(image: SourceImage): Rejection | null {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(image.contentType)) {
    return reject('type', "That file isn't an image. A screenshot or a photo of the schedule works.");
  }
  if (image.bytes.byteLength > MAX_IMAGE_BYTES) {
    return reject(
      'size',
      `That image is ${mb(image.bytes.byteLength)} MB. ${mb(MAX_IMAGE_BYTES)} MB is the most I can take — a screenshot is usually well under that.`,
    );
  }
  const short = Math.min(image.width, image.height);
  const long = Math.max(image.width, image.height);
  if (short < MIN_IMAGE_EDGE) {
    return reject(
      'dimensions',
      `That image is ${short} pixels on its short side. Under ${MIN_IMAGE_EDGE} there is nothing legible to read the times off.`,
    );
  }
  if (long > MAX_IMAGE_EDGE) {
    return reject(
      'dimensions',
      `That image is ${long} pixels on its long side. ${MAX_IMAGE_EDGE} is the most I can read in one go.`,
    );
  }
  return null;
}

/** The festival name, dates, zone and address the uploader typed. */
function checkDetails(intent: UploadIntent): Rejection | null {
  if (intent.festival.trim() === '' || slugify(intent.festival) === '') {
    return reject('details', "Type the festival's name first.");
  }
  if (!ISO_DATE_RE.test(intent.dates.first) || !ISO_DATE_RE.test(intent.dates.last) || intent.dates.last < intent.dates.first) {
    return reject('details', "Those dates don't look right. Give the day it starts and the day it ends.");
  }
  if (!EMAIL_RE.test(intent.email.trim())) {
    return reject('details', "That email address doesn't look right.");
  }
  if (intent.timezone !== undefined && !isValidTimeZone(intent.timezone)) {
    return reject('details', "That time zone isn't one I know.");
  }
  return null;
}

/**
 * The caps.
 *
 * Three per address per hour, twenty per day across everyone, so the worst day
 * costs about five dollars. They sit ahead of the schedule check rather than
 * behind it: that check is a model call, and a gate whose whole job is to bound
 * spend cannot spend to run.
 */
function checkCaps(ledger: UploadLedger, address: string, now: number): Rejection | null {
  const today = ledger.uploads.filter((u) => u.at > now - DAY_MS);
  const mine = today.filter((u) => u.address === address && u.at > now - HOUR_MS);
  if (mine.length >= UPLOADS_PER_ADDRESS_PER_HOUR) {
    return reject(
      'address-cap',
      `That's ${UPLOADS_PER_ADDRESS_PER_HOUR} uploads from this address in an hour, which is the limit. Try again in an hour.`,
    );
  }
  if (today.length >= UPLOADS_PER_DAY) {
    return reject('daily-cap', "That's every upload for today. Try again tomorrow.");
  }
  return null;
}

/** Entries still inside the widest window a cap looks at, newest kept. */
function pruneUploads(ledger: UploadLedger, now: number): UploadRecord[] {
  return ledger.uploads.filter((u) => u.at > now - DAY_MS);
}

// ---------------------------------------------------------------------------
// upload
// ---------------------------------------------------------------------------

/**
 * An image plus what the uploader typed, through the gates, into a review.
 *
 * The gates run cheapest first and stop at the first one that fails, so a
 * rejection never costs a model call it did not have to make:
 *
 *   1. what the uploader typed  (free)
 *   2. type, size, dimensions   (free)
 *   3. content-hash lookup      (free — and a hit costs nothing at all)
 *   4. the caps                 (free)
 *   5. is this a schedule       (a small model)
 *   6. transcribe               (the real cost)
 */
export async function upload(intent: UploadIntent, ports: PublisherPorts): Promise<UploadResult> {
  const details = checkDetails(intent);
  if (details) return rejectedUpload(details);

  const imageProblem = checkImage(intent.image);
  if (imageProblem) return rejectedUpload(imageProblem);

  const now = ports.clock.now();
  const stamp = icalStamp(now);
  const hash = sha256(intent.image.bytes);
  const address = addressHash(intent.email);

  // A retry of an image already paid for costs nothing and counts against
  // nothing — that is the whole point of storing the reply (story 31).
  const saved = await ports.repo.readTranscription(hash);
  if (saved) {
    return finishUpload(intent, ports, saved, { reused: true, commit: null });
  }

  const ledger = await ports.repo.readUploads();
  const capped = checkCaps(ledger, address, now);
  if (capped) return rejectedUpload(capped);

  const check = await ports.vision.looksLikeSchedule(intent.image);
  if (!check.isSchedule) {
    return rejectedUpload(
      reject(
        'schedule',
        "I can't find set times on that image. It needs the schedule with the times on it, not the lineup.",
      ),
    );
  }

  const output = await ports.vision.transcribe(intent.image);
  const fresh: SavedTranscription = {
    image: hash,
    filename: intent.image.filename,
    contentType: intent.image.contentType,
    output,
    transcribedAt: stamp,
  };

  // Written before it is read, so a reply the library rejects is still on the
  // record — and so a retry after a rejection the uploader can fix is free.
  const commit: Commit = {
    message: `Transcribe an upload for ${intent.festival.trim()} (${hash.slice(0, 12)})`,
    files: [
      { path: `${TRANSCRIPTION_STORE_DIR}/${hash}.json`, contents: json(fresh) },
      {
        path: UPLOADS_PATH,
        contents: json({
          $comment: ledger.$comment ?? UPLOADS_COMMENT,
          uploads: [...pruneUploads(ledger, now), { address, at: now, image: hash }],
        }),
      },
    ],
    images: [],
  };

  return finishUpload(intent, ports, fresh, { reused: false, commit });
}

/** Read the saved reply into a review payload. Shared by the cached path. */
async function finishUpload(
  intent: UploadIntent,
  ports: PublisherPorts,
  saved: SavedTranscription,
  opts: { reused: boolean; commit: Commit | null },
): Promise<UploadResult> {
  const timezone = intent.timezone ?? DEFAULT_TIMEZONE;
  let transcription: Transcription;
  try {
    transcription = transcribe([{ source: storedImageName(saved), output: saved.output }], {
      namespace: 'fan',
      name: intent.festival.trim(),
      slug: slugify(intent.festival),
      officialUrl: intent.officialUrl,
      timezone,
      timezoneAssumed: intent.timezone === undefined,
    });
  } catch (err) {
    if (opts.commit) await ports.repo.commit(opts.commit);
    return rejectedUpload(readingProblem(err), opts.commit);
  }

  if (opts.commit) await ports.repo.commit(opts.commit);

  const published = await ports.repo.readPublished();
  const { festival, stages } = transcription.edition;
  const slug = claimFanSlug(published, festival.slug, festival.year);
  const stageNames = new Map(stages.map((s) => [s.id, s.name]));

  const review: Review = {
    image: saved.image,
    festival: festival.name,
    slug,
    year: festival.year,
    namespace: 'fan',
    editionPath: editionPath('fan', `${slug}-${festival.year}`),
    timezone,
    timezoneAssumed: transcription.timezoneAssumed,
    yearMismatch: intent.dates.first.slice(0, 4) !== String(festival.year),
    stages: stages.map((s) => ({ id: s.id, name: s.name })),
    sets: transcription.sets.map((set, index) => ({
      index,
      stage: set.stage,
      stageName: stageNames.get(set.stage) ?? set.stage,
      artist: set.artist,
      start: set.start,
      end: set.end,
      endInferred: set.end_inferred,
      lowConfidence: lowConfidence(transcription.observations, set.artist),
      printedTime: set.printedTime,
      notes: set.notes,
    })),
    observations: transcription.observations,
    reused: opts.reused,
  };

  return { ok: true, rejection: null, review, commit: opts.commit, notifications: [], reused: opts.reused };
}

// ---------------------------------------------------------------------------
// confirm
// ---------------------------------------------------------------------------

/**
 * The uploader's confirm: this is the human check the whole pipeline waits for.
 *
 * The sets are rebuilt from the saved model reply rather than from anything the
 * browser sends back, so the only thing a client can change is the three fields
 * the review screen exposes — and every one of those is recorded in the log.
 * The result passes through the real schema loader on its way out: if it would
 * not build, it is not committed.
 */
export async function confirm(intent: ConfirmIntent, ports: PublisherPorts): Promise<ConfirmResult> {
  const imageProblem = checkImage(intent.image);
  if (imageProblem) return rejectedConfirm(imageProblem);

  const hash = sha256(intent.image.bytes);
  const saved = await ports.repo.readTranscription(hash);
  if (!saved) {
    return rejectedConfirm(
      reject('expired', "I don't have that image any more. Upload it again and check the times."),
    );
  }

  if (intent.unverifiable.length > 0) {
    const n = intent.unverifiable.length;
    return rejectedConfirm(
      reject(
        'review',
        n === 1
          ? "One set is still marked as one you can't read. Check it against your image, then confirm."
          : `${n} sets are still marked as ones you can't read. Check them against your image, then confirm.`,
      ),
    );
  }

  if (!isValidTimeZone(intent.timezone)) {
    return rejectedConfirm(reject('details', "That time zone isn't one I know."));
  }

  const published = await ports.repo.readPublished();

  // Two passes. The first reads the source to find out what year it is, which
  // is what decides the slug; the second builds the edition under the slug that
  // read gives it. Both are deterministic over the same saved reply.
  let probe: Transcription;
  try {
    probe = transcribe([{ source: storedImageName(saved), output: saved.output }], {
      namespace: 'fan',
      name: intent.festival.trim(),
      slug: slugify(intent.festival),
      officialUrl: intent.officialUrl,
      timezone: intent.timezone,
      timezoneAssumed: intent.timezoneAssumed,
    });
  } catch (err) {
    return rejectedConfirm(readingProblem(err));
  }

  const slug = claimFanSlug(published, probe.edition.festival.slug, probe.edition.festival.year);

  let transcription: Transcription;
  try {
    transcription = transcribe([{ source: storedImageName(saved), output: saved.output }], {
      namespace: 'fan',
      name: intent.festival.trim(),
      slug,
      officialUrl: intent.officialUrl,
      timezone: intent.timezone,
      timezoneAssumed: intent.timezoneAssumed,
      edits: intent.edits,
      // The uploader checking every set against their own image IS the human
      // verification the build's production gate asks for.
      verified: true,
    });
  } catch (err) {
    return rejectedConfirm(readingProblem(err));
  }

  const doc: FestivalDoc = transcription.edition;
  const key = `${doc.festival.slug}-${doc.festival.year}`;
  const path = editionPath('fan', key);

  // The publish stamp: the one real time in the system, taken here and written
  // into committed state so the build never has to read a clock.
  const stamp = icalStamp(ports.clock.now());
  const updateSecret = secretFrom(ports.random.bytes(32));

  const record: PublishedEdition & { uploader: UploaderRecord } = {
    slug: doc.festival.slug,
    year: doc.festival.year,
    namespace: 'fan',
    // Never auto-list. Listing is the owner's act, always (CONTEXT: listing).
    listed: false,
    blocked: false,
    stages: doc.stages.map((s) => s.id).sort(),
    uploader: {
      secretHash: sha256(updateSecret),
      addressHash: addressHash(intent.email),
      verifiedAt: stamp,
      image: hash,
    },
  };

  const nextPublished: PublishedFile = {
    ...published,
    publishedAt: stamp,
    editions: sortKeys({ ...published.editions, [path]: record }),
  };

  const setCount = doc.sets.length;
  const commit: Commit = {
    message: `Publish ${doc.festival.name} ${doc.festival.year} (${path})`,
    files: [
      { path: `${FAN_DATA_DIR}/${key}.yaml`, contents: transcription.yaml },
      { path: `${SOURCE_DIR}/${path}/TRANSCRIPTION.md`, contents: transcription.log },
      { path: PUBLISHED_PATH, contents: json(nextPublished) },
    ],
    images: [
      {
        path: `${SOURCE_IMAGE_DIR}/${storedImageName(saved)}`,
        contentType: saved.contentType,
        bytes: intent.image.bytes,
      },
    ],
  };

  const notification: Notification = {
    kind: 'edition-published',
    editionPath: path,
    title: `Fan edition published: ${doc.festival.name} ${doc.festival.year}`,
    body:
      `${setCount} set${setCount === 1 ? '' : 's'} across ${doc.stages.length} stage${doc.stages.length === 1 ? '' : 's'}, ` +
      `read off ${saved.filename} and checked by the uploader` +
      `${transcription.edits.length > 0 ? ` with ${transcription.edits.length} correction${transcription.edits.length === 1 ? '' : 's'}` : ''}. ` +
      `Unlisted — https://stagetimes.app/${path}/`,
    email: intent.email.trim(),
  };

  await ports.repo.commit(commit);
  await ports.notify.send(notification);

  return {
    ok: true,
    rejection: null,
    updateSecret,
    editionPath: path,
    commit,
    notifications: [notification],
  };
}

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/** One intent in, the writes and notifications it would make out. */
export async function publish(intent: UploadIntent, ports: PublisherPorts): Promise<UploadResult>;
export async function publish(intent: ConfirmIntent, ports: PublisherPorts): Promise<ConfirmResult>;
export async function publish(intent: Intent, ports: PublisherPorts): Promise<UploadResult | ConfirmResult>;
export async function publish(intent: Intent, ports: PublisherPorts): Promise<UploadResult | ConfirmResult> {
  return intent.kind === 'upload' ? upload(intent, ports) : confirm(intent, ports);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** The stored name of a source image: its content hash plus a real extension. */
function storedImageName(saved: SavedTranscription): string {
  return `${saved.image}${EXTENSIONS[saved.contentType] ?? '.bin'}`;
}

/**
 * Turn a library failure into something a person can act on. A `SchemaError`
 * means the edition would not build — usually a time an edit made impossible —
 * and its own problems ride along for the screen to lay out.
 */
function readingProblem(err: unknown): Rejection {
  if (err instanceof SchemaError) {
    return reject(
      'schema',
      `Those times don't hold together: ${err.problems[0] ?? 'the schedule is not publishable'}`,
      err.problems,
    );
  }
  if (err instanceof TranscribeError) {
    return reject('schema', `I couldn't read that into a schedule: ${err.message}`);
  }
  throw err;
}

/** JSON as committed state is written: 2-space indent, trailing newline. */
function json(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

function sortKeys<T>(obj: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k]!;
  return out;
}
