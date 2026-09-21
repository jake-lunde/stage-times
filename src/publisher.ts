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
 * Two intents live here, the two that make an edition exist:
 *
 *   upload   an image plus a festival name, dates and an address, through the
 *            pre-spend gates, into a review payload the uploader can check
 *            against their own image.
 *   confirm  that review, with the uploader's corrections, validated through
 *            the real schema and committed to main as an edition.
 *
 * Both carry an optional `owner` secret — the owner's bookmarked link. When the
 * owner port recognizes it, the same intent publishes into the root namespace
 * and its confirm sets `listed` in the same commit: the human tapping is the
 * approval. A wrong secret is no secret. A fan confirm, instead, opens a
 * pull request on the owner's behalf whose only change is listing the edition;
 * merging it is the one-tap listing (ticket 10).
 *
 * Correction, self-removal, the watcher and the signal are the same shape and
 * land here too (tickets 09, 11, 12).
 *
 * Three rules this module exists to enforce:
 *
 *   1. **Nothing costs money before it has earned it.** The gates run in a
 *      fixed order, cheapest first, and every one of them returns a plain
 *      sentence a person can read. A previously transcribed image costs
 *      nothing at all.
 *   2. **The root namespace is owner-only.** A fan intent writes `data/fan/`
 *      and `fan/<key>` in committed state, never the root; only an intent the
 *      owner port recognizes writes the root, and never over an edition
 *      already there. Permanent from first publish —
 *      docs/adr/0001-fan-namespace-prefix.md.
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
import { transcribe, type ModelOutput, type Transcription } from './transcription.js';

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

/**
 * The most images one upload can carry — one per day of the festival, and no
 * festival this is for runs longer than a week. Refused before anything is read.
 */
export const MAX_UPLOAD_IMAGES = 7;

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

/** Where each kind of file goes. `data/` itself is the owner's; fans write `data/fan/`. */
export const OWNER_DATA_DIR = 'data';
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
   * A small model, a yes or a no, about one image. Runs before the expensive call so garbage
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

/**
 * A change proposed to the owner rather than made: a branch off `from`
 * carrying one commit, opened as a pull request against main. Merging it from
 * the GitHub app is the owner's act; nothing here ever merges one.
 */
export interface PullRequest {
  /** The commit the branch starts from — what `commit()` returned. */
  from: string;
  branch: string;
  title: string;
  body: string;
  commit: Commit;
}

export interface RepositoryPort {
  readPublished(): Promise<PublishedFile>;
  readUploads(): Promise<UploadLedger>;
  /** The saved transcription for an image content hash, or null. */
  readTranscription(hash: string): Promise<SavedTranscription | null>;
  /** Applies the commit to main and returns an id a pull request can branch from. */
  commit(commit: Commit): Promise<string>;
  openPullRequest(pr: PullRequest): Promise<void>;
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

/**
 * Is this the owner's secret? A yes or a no and nothing else: a wrong secret,
 * a missing one, and a deployment with none set all answer no, and the
 * publisher treats every no the same way — as a fan.
 */
export interface OwnerPort {
  recognizes(presented: string | undefined): boolean;
}

export interface PublisherPorts {
  vision: VisionPort;
  repo: RepositoryPort;
  notify: NotifyPort;
  clock: ClockPort;
  random: RandomPort;
  owner: OwnerPort;
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
  /** Content hash of the (first) image that was transcribed. */
  image: string;
  /** Every image this upload paid to read, when it was more than one. */
  images?: string[];
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
  /** The model's reply for this one image, verbatim — what `transcribe()` takes. */
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
  /**
   * The source images, one per day, in day order. `image` is the same thing
   * for one image — a list of one — and is what an intent with no `images`
   * is read as.
   */
  images?: SourceImage[];
  image?: SourceImage;
  /** The secret from the owner's bookmarked link, if the page had one. */
  owner?: string;
}

export interface ConfirmIntent {
  kind: 'confirm';
  /**
   * The same images the review was built from, in the same order — hashed and
   * checked. `image` for one, as on upload.
   */
  images?: SourceImage[];
  image?: SourceImage;
  /**
   * The review's `images`, echoed back: the hashes the uploader checked the sets
   * against. Required for more than one image, so a confirm cannot quietly
   * publish a subset or a reordering of what was reviewed.
   */
  reviewed?: string[];
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
  /** The secret from the owner's bookmarked link, if the page had one. */
  owner?: string;
}

export type Intent = UploadIntent | ConfirmIntent;

/** Which gate stopped it. The screen picks its shape from this. */
export type Gate =
  | 'details'
  | 'images'
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
  /** Which image it is about, by position in the intent's list, from 0. */
  image?: number;
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
  /** Content hash of the image this set was read from — one of `Review.images`. */
  image: string;
}

export interface Review {
  /** SHA-256 of the first image these sets were read from. */
  image: string;
  /** SHA-256 of every image, in the order given. Confirm echoes it back. */
  images: string[];
  festival: string;
  /** The slug this edition would claim, suffixed if one is already taken. */
  slug: string;
  /** The year the source reads as. */
  year: number;
  /** `owner` when the owner's secret came with the upload, else `fan`. */
  namespace: Namespace;
  /** Where the feeds would live: `<slug>-<year>` for the owner, `fan/<slug>-<year>` otherwise. */
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
  /** True when every image had been read before and this cost nothing. */
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
  /** `fan/<slug>-<year>`, or `<slug>-<year>` for the owner — where the feeds live. */
  editionPath: string | null;
  commit: Commit | null;
  notifications: Notification[];
  /** The listing pull request a fan confirm opens. Empty for the owner, who listed by confirming. */
  pullRequests: PullRequest[];
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
/**
 * Deliberately loose. This is a contact address, not a credential: the only
 * failure that matters is a typo the uploader can see in their own sentence.
 * Exported so the upload screen checks the same shape before it posts.
 */
export const EMAIL_RE = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

/**
 * The sentences the free gates speak, in one place, so the upload screen can
 * say exactly the same thing before a request is made (it injects this
 * object) and no second copy of the copy rules exists. `{short}`, `{min}` and
 * `{n}` are filled in by `fill()`.
 */
export const GATE_COPY = {
  festival: "Type the festival's name first.",
  email: "That email address doesn't look right.",
  dates: "Those dates don't look right. Give the day it starts and the day it ends.",
  notImage: "That file isn't an image. A screenshot or a photo of the schedule works.",
  tooSmall: 'That image is {short} pixels on its short side. Under {min} there is nothing legible to read the times off.',
  unreadableOne: "One set is still marked as one you can't read. Check it against your image, then confirm.",
  unreadableMany: "{n} sets are still marked as ones you can't read. Check them against your image, then confirm.",
} as const;

/** `{name}` placeholders → values. The page carries the same one-liner. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

function reject(gate: Gate, reason: string, problems?: string[]): Rejection {
  return problems ? { gate, reason, problems } : { gate, reason };
}

function rejectedUpload(rejection: Rejection, commit: Commit | null = null): UploadResult {
  return { ok: false, rejection, review: null, commit, notifications: [], reused: false };
}

function rejectedConfirm(rejection: Rejection): ConfirmResult {
  return { ok: false, rejection, updateSecret: null, editionPath: null, commit: null, notifications: [], pullRequests: [] };
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

/**
 * Which namespace an intent publishes into. The owner port's yes is the only
 * way into the root; every no — wrong, missing, or no secret configured — is a
 * fan, with nothing in the result to say which kind of no it was.
 */
function namespaceOf(intent: { owner?: string }, ports: PublisherPorts): Namespace {
  return ports.owner.recognizes(intent.owner) ? 'owner' : 'fan';
}

/**
 * The slug an edition claims in its namespace, or a rejection. A fan slug is
 * suffixed past any taken one. A root slug is never minted: it is the festival's
 * own, and an owner edition already there is refused rather than replaced —
 * replacing one is a correction, and a correction is not this intent.
 */
function claimSlug(
  published: PublishedFile,
  namespace: Namespace,
  festival: { name: string; slug: string; year: number },
): { slug: string } | Rejection {
  if (namespace === 'fan') return { slug: claimFanSlug(published, festival.slug, festival.year) };
  if (published.editions[editionPath('owner', `${festival.slug}-${festival.year}`)]) {
    return reject('details', `${festival.name} ${festival.year} already has a page, and this would replace it. Nothing was published.`);
  }
  return { slug: festival.slug };
}

// ---------------------------------------------------------------------------
// The pre-spend gates
// ---------------------------------------------------------------------------

/** Type, size and dimensions: everything knowable without asking anyone. */
function checkImage(image: SourceImage): Rejection | null {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(image.contentType)) {
    return reject('type', GATE_COPY.notImage);
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
    return reject('dimensions', fill(GATE_COPY.tooSmall, { short, min: MIN_IMAGE_EDGE }));
  }
  if (long > MAX_IMAGE_EDGE) {
    return reject(
      'dimensions',
      `That image is ${long} pixels on its long side. ${MAX_IMAGE_EDGE} is the most I can read in one go.`,
    );
  }
  return null;
}

/** The intent's images as a list: `images`, or `image` as a list of one. */
function imagesOf(intent: { images?: SourceImage[]; image?: SourceImage }): SourceImage[] {
  return intent.images ?? (intent.image ? [intent.image] : []);
}

/**
 * A rejection about one image of several says which, as the uploader counts
 * them: images come in day order, so the second one is day 2. With one image
 * the sentence is left exactly as it was.
 */
function aboutImage(rejection: Rejection, index: number, total: number): Rejection {
  return {
    ...rejection,
    reason: total > 1 ? `Day ${index + 1}: ${rejection.reason}` : rejection.reason,
    image: index,
  };
}

/**
 * The free checks on the list and on every image in it, before anything is
 * read: how many, each one's type, size and dimensions, and no image twice.
 */
function checkImages(images: SourceImage[], hashes: string[]): Rejection | null {
  if (images.length === 0) return reject('images', 'Add an image of the schedule first.');
  if (images.length > MAX_UPLOAD_IMAGES) {
    return reject(
      'images',
      `That's ${images.length} images. ${MAX_UPLOAD_IMAGES} is the most one upload can take — one per day.`,
    );
  }
  for (const [i, image] of images.entries()) {
    const problem = checkImage(image);
    if (problem) return aboutImage(problem, i, images.length);
  }
  for (const [i, hash] of hashes.entries()) {
    const first = hashes.indexOf(hash);
    if (first < i) {
      return { ...reject('images', `Day ${i + 1} is the same image as day ${first + 1}. Each day needs its own.`), image: i };
    }
  }
  return null;
}

/** The festival name, dates, zone and address the uploader typed. */
function checkDetails(intent: UploadIntent): Rejection | null {
  const named = checkWhoAndWhat(intent.festival, intent.email);
  if (named) return named;
  if (!ISO_DATE_RE.test(intent.dates.first) || !ISO_DATE_RE.test(intent.dates.last) || intent.dates.last < intent.dates.first) {
    return reject('details', GATE_COPY.dates);
  }
  if (intent.timezone !== undefined && !isValidTimeZone(intent.timezone)) {
    return reject('details', "That time zone isn't one I know.");
  }
  return null;
}

/** The two fields both intents carry. Checked here so the schema never has to. */
function checkWhoAndWhat(festival: string, email: string): Rejection | null {
  if (festival.trim() === '' || slugify(festival) === '') {
    return reject('details', GATE_COPY.festival);
  }
  if (!EMAIL_RE.test(email.trim())) {
    return reject('details', GATE_COPY.email);
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
 * The images plus what the uploader typed, through the gates, into a review.
 *
 * Most festivals post one image per day, so an upload is a list of images in
 * day order; one image is a list of one. The gates run cheapest first and stop
 * at the first one that fails, so a rejection never costs a model call it did
 * not have to make:
 *
 *   1. what the uploader typed                  (free)
 *   2. how many images; each one's type, size,
 *      dimensions; no image twice               (free)
 *   3. content-hash lookup, per image           (free — a hit costs nothing at all)
 *   4. the caps, once for the whole upload      (free)
 *   5. is this a schedule, per unread image     (a small model)
 *   6. transcribe, per unread image             (the real cost)
 *
 * Every image clears 5 before any image reaches 6. A rejection about one image
 * names it, and none of the others is paid for until it is fixed.
 */
export async function upload(intent: UploadIntent, ports: PublisherPorts): Promise<UploadResult> {
  const details = checkDetails(intent);
  if (details) return rejectedUpload(details);

  const images = imagesOf(intent);
  const hashes = images.map((image) => sha256(image.bytes));
  const imageProblem = checkImages(images, hashes);
  if (imageProblem) return rejectedUpload(imageProblem);

  const now = ports.clock.now();
  const stamp = icalStamp(now);
  const address = addressHash(intent.email);

  // Each image is looked up on its own. A retry of images already paid for
  // costs nothing and counts against nothing — that is the whole point of
  // storing the reply (story 31) — and a retry that adds a day pays for that
  // day alone.
  const saved = await Promise.all(hashes.map((hash) => ports.repo.readTranscription(hash)));
  const unread = images.flatMap((image, i) => (saved[i] ? [] : [i]));
  if (unread.length === 0) {
    return finishUpload(intent, ports, saved as SavedTranscription[], { reused: true, commit: null });
  }

  // The caps count the upload, not its images: one request is one upload.
  const ledger = await ports.repo.readUploads();
  const capped = checkCaps(ledger, address, now);
  if (capped) return rejectedUpload(capped);

  // Every cheap check before any expensive call, so an image that is not a
  // schedule stops the upload before any of the others is paid for.
  for (const i of unread) {
    const check = await ports.vision.looksLikeSchedule(images[i]!);
    if (!check.isSchedule) {
      return rejectedUpload(
        aboutImage(
          reject(
            'schedule',
            "I can't find set times on that image. It needs the schedule with the times on it, not the lineup.",
          ),
          i,
          images.length,
        ),
      );
    }
  }

  const fresh: SavedTranscription[] = [];
  for (const i of unread) {
    const image = images[i]!;
    const output = await ports.vision.transcribe(image);
    const reading: SavedTranscription = {
      image: hashes[i]!,
      filename: image.filename,
      contentType: image.contentType,
      output,
      transcribedAt: stamp,
    };
    fresh.push(reading);
    saved[i] = reading;
  }

  const paidFor = fresh.map((f) => f.image);
  const commit: Commit = {
    message: `Transcribe an upload for ${intent.festival.trim()} (${paidFor.map((h) => h.slice(0, 12)).join(', ')})`,
    files: [
      ...fresh.map((f) => ({ path: `${TRANSCRIPTION_STORE_DIR}/${f.image}.json`, contents: json(f) })),
      {
        path: UPLOADS_PATH,
        contents: json({
          $comment: ledger.$comment ?? UPLOADS_COMMENT,
          uploads: [
            ...pruneUploads(ledger, now),
            { address, at: now, image: paidFor[0]!, ...(paidFor.length > 1 ? { images: paidFor } : {}) },
          ],
        }),
      },
    ],
    images: [],
  };

  return finishUpload(intent, ports, saved as SavedTranscription[], { reused: false, commit });
}

/** Read the saved replies into one review payload. Shared by the cached path. */
async function finishUpload(
  intent: UploadIntent,
  ports: PublisherPorts,
  saved: SavedTranscription[],
  opts: { reused: boolean; commit: Commit | null },
): Promise<UploadResult> {
  // Recorded before it is read. A reply the library then refuses is still on
  // the record for the audit trail, and the fix-and-retry is free.
  if (opts.commit) await ports.repo.commit(opts.commit);

  const namespace = namespaceOf(intent, ports);
  const timezone = intent.timezone ?? DEFAULT_TIMEZONE;
  let transcription: Transcription;
  try {
    transcription = transcribe(modelOutputs(saved), {
      namespace,
      name: intent.festival.trim(),
      slug: slugify(intent.festival),
      officialUrl: intent.officialUrl,
      timezone,
      timezoneAssumed: intent.timezone === undefined,
    });
  } catch (err) {
    return rejectedUpload(readingProblem(err), opts.commit);
  }

  const published = await ports.repo.readPublished();
  const { festival, stages } = transcription.edition;
  const claimed = claimSlug(published, namespace, festival);
  if ('gate' in claimed) return rejectedUpload(claimed, opts.commit);
  const slug = claimed.slug;
  const stageNames = new Map(stages.map((s) => [s.id, s.name]));
  const hashOf = new Map(saved.map((s) => [storedImageName(s), s.image]));

  const review: Review = {
    image: saved[0]!.image,
    images: saved.map((s) => s.image),
    festival: festival.name,
    slug,
    year: festival.year,
    namespace,
    editionPath: editionPath(namespace, `${slug}-${festival.year}`),
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
      image: hashOf.get(set.source)!,
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
  const named = checkWhoAndWhat(intent.festival, intent.email);
  if (named) return rejectedConfirm(named);

  const images = imagesOf(intent);
  const hashes = images.map((image) => sha256(image.bytes));
  const imageProblem = checkImages(images, hashes);
  if (imageProblem) return rejectedConfirm(imageProblem);

  // The list has to be the one the sets were checked against: the same images
  // in the same order. A day left out would publish without it, unnoticed.
  const reviewed = intent.reviewed ?? (images.length === 1 ? hashes : []);
  if (reviewed.length !== hashes.length || reviewed.some((h, i) => h !== hashes[i])) {
    return rejectedConfirm(
      reject('expired', "Those aren't the images you checked. Upload them again and check the times."),
    );
  }

  const saved: SavedTranscription[] = [];
  for (const [i, hash] of hashes.entries()) {
    const reading = await ports.repo.readTranscription(hash);
    if (!reading) {
      return rejectedConfirm(
        aboutImage(
          reject('expired', "I don't have that image any more. Upload it again and check the times."),
          i,
          images.length,
        ),
      );
    }
    saved.push(reading);
  }

  if (intent.unverifiable.length > 0) {
    const n = intent.unverifiable.length;
    return rejectedConfirm(
      reject('review', n === 1 ? GATE_COPY.unreadableOne : fill(GATE_COPY.unreadableMany, { n })),
    );
  }

  if (!isValidTimeZone(intent.timezone)) {
    return rejectedConfirm(reject('details', "That time zone isn't one I know."));
  }

  const namespace = namespaceOf(intent, ports);
  const published = await ports.repo.readPublished();

  // Two passes. The first reads the source to find out what year it is, which
  // is what decides the slug; the second builds the edition under the slug that
  // read gives it. Both are deterministic over the same saved reply.
  let probe: Transcription;
  try {
    probe = transcribe(modelOutputs(saved), {
      namespace,
      name: intent.festival.trim(),
      slug: slugify(intent.festival),
      officialUrl: intent.officialUrl,
      timezone: intent.timezone,
      timezoneAssumed: intent.timezoneAssumed,
    });
  } catch (err) {
    return rejectedConfirm(readingProblem(err));
  }

  const claimed = claimSlug(published, namespace, probe.edition.festival);
  if ('gate' in claimed) return rejectedConfirm(claimed);
  const slug = claimed.slug;

  let transcription: Transcription;
  try {
    transcription = transcribe(modelOutputs(saved), {
      namespace,
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
  const path = editionPath(namespace, key);
  const owner = namespace === 'owner';

  // The publish stamp: the one real time in the system, taken here and written
  // into committed state so the build never has to read a clock.
  const stamp = icalStamp(ports.clock.now());
  const updateSecret = secretFrom(ports.random.bytes(32));

  const record: PublishedEdition & { uploader: UploaderRecord } = {
    slug: doc.festival.slug,
    year: doc.festival.year,
    namespace,
    // Never auto-list. Listing is the owner's act, always (CONTEXT: listing) —
    // and the owner's own confirm is that act, in the same commit.
    listed: owner,
    blocked: false,
    stages: doc.stages.map((s) => s.id).sort(),
    uploader: {
      secretHash: sha256(updateSecret),
      addressHash: addressHash(intent.email),
      verifiedAt: stamp,
      image: hashes[0]!,
      ...(hashes.length > 1 ? { images: hashes } : {}),
    },
  };

  const nextPublished: PublishedFile = {
    ...published,
    publishedAt: stamp,
    editions: sortKeys({ ...published.editions, [path]: record }),
  };

  const setCount = doc.sets.length;
  const size = `${setCount} set${setCount === 1 ? '' : 's'} across ${doc.stages.length} stage${doc.stages.length === 1 ? '' : 's'}`;
  const pageUrl = `https://stagetimes.app/${path}/`;
  const commit: Commit = {
    message: `${owner ? 'Publish and list' : 'Publish'} ${doc.festival.name} ${doc.festival.year} (${path})`,
    files: [
      { path: `${owner ? OWNER_DATA_DIR : FAN_DATA_DIR}/${key}.yaml`, contents: transcription.yaml },
      { path: `${SOURCE_DIR}/${path}/TRANSCRIPTION.md`, contents: transcription.log },
      { path: PUBLISHED_PATH, contents: json(nextPublished) },
    ],
    images: saved.map((reading, i) => ({
      path: `${SOURCE_IMAGE_DIR}/${storedImageName(reading)}`,
      contentType: reading.contentType,
      bytes: images[i]!.bytes,
    })),
  };

  const publishCommit = await ports.repo.commit(commit);

  // The owner's confirm was a person tapping: nothing machine-initiated
  // happened, so nothing lands in the inbox.
  if (owner) {
    return { ok: true, rejection: null, updateSecret, editionPath: path, commit, notifications: [], pullRequests: [] };
  }

  // A fan confirm asks the owner to list it. The edition is already live and
  // the update secret exists nowhere else, so a pull request that will not
  // open must not fail the confirm — the notification says so instead.
  const listing = listingPullRequest(publishCommit, nextPublished, path, `${doc.festival.name} ${doc.festival.year}`, size, pageUrl);
  let opened: PullRequest[] = [];
  let listingNote = 'Merge the listing pull request to list it.';
  try {
    await ports.repo.openPullRequest(listing);
    opened = [listing];
  } catch (err) {
    listingNote = `The listing pull request could not be opened (${(err as Error).message}); list it by hand.`;
  }

  const notification: Notification = {
    kind: 'edition-published',
    editionPath: path,
    title: `Fan edition published: ${doc.festival.name} ${doc.festival.year}`,
    body:
      `${size}, ` +
      `read off ${listed(saved.map((s) => s.filename))} and checked by the uploader` +
      `${transcription.edits.length > 0 ? ` with ${transcription.edits.length} correction${transcription.edits.length === 1 ? '' : 's'}` : ''}. ` +
      `Unlisted — ${pageUrl} ${listingNote}`,
    email: intent.email.trim(),
  };

  await ports.notify.send(notification);

  return {
    ok: true,
    rejection: null,
    updateSecret,
    editionPath: path,
    commit,
    notifications: [notification],
    pullRequests: opened,
  };
}

/**
 * The pull request that lists a fan edition: a branch off the publish commit
 * whose one change is `listed` on that edition in committed state. Branching
 * from the publish commit rather than from wherever main is by then keeps the
 * diff that one line, whatever lands in between; publishedAt is not bumped,
 * because a listing moves no feed byte.
 */
function listingPullRequest(
  from: string,
  published: PublishedFile,
  path: string,
  name: string,
  size: string,
  pageUrl: string,
): PullRequest {
  const listedState: PublishedFile = {
    ...published,
    editions: { ...published.editions, [path]: { ...published.editions[path]!, listed: true } },
  };
  return {
    from,
    branch: `list/${path}`,
    title: `List ${name}`,
    body:
      `${name}: ${size}, checked by the uploader against their own image.\n\n` +
      `${pageUrl}\n\n` +
      `Merging lists it on the homepage. The only change is \`listed\` on \`${path}\` in \`${PUBLISHED_PATH}\`.\n`,
    commit: {
      message: `List ${name} (${path})`,
      files: [{ path: PUBLISHED_PATH, contents: json(listedState) }],
      images: [],
    },
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

/** The saved replies as the library takes them, one source per image, in order. */
function modelOutputs(saved: SavedTranscription[]): ModelOutput[] {
  return saved.map((s) => ({ source: storedImageName(s), output: s.output }));
}

/** `a`, `a and b`, `a, b and c` — for a sentence the owner reads. */
function listed(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
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
