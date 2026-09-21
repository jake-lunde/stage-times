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
 * Four intents live here:
 *
 *   upload   an image plus a festival name, dates and an address, through the
 *            pre-spend gates, into a review payload the uploader can check
 *            against their own image.
 *   link     the festival's schedule page plus an address, and nothing else:
 *            the page's images, fetched and put through the same gates, into
 *            the same review (ticket 19).
 *   confirm  that review, with the uploader's corrections, validated through
 *            the real schema and committed to main as an edition.
 *   remove   the uploader's self-removal: the edition is blocked, its stored
 *            image kept.
 *
 * Upload and confirm carry an optional `owner` secret — the owner's bookmarked
 * link. When the owner port recognizes it, the same intent publishes into the
 * root namespace and its confirm sets `listed` in the same commit: the human
 * tapping is the approval. A wrong secret is no secret. A fan confirm, instead,
 * opens a pull request on the owner's behalf whose only change is listing the
 * edition; merging it is the one-tap listing (ticket 10).
 *
 * Upload and confirm carrying a valid update link are a **correction**: the
 * same two steps, but the confirm replaces that edition's sets in place instead
 * of making a new one. The build's sequence ledger then advances exactly the
 * events whose content moved. A wrong or absent secret is simply a fresh upload
 * and never touches an existing edition (ticket 09).
 *
 * The watcher (`src/watcher.ts`, ticket 11) is the same shape from the other
 * side: the same ports plus one for pages, and its review pull requests carry
 * the edition exactly as the owner's confirm commits it. The signal (ticket
 * 12) will be too.
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
 * While it works, upload and confirm report what has happened through an
 * optional progress port — each image checked and read, each confirm step —
 * which the upload adapter streams to the page (ticket 21). A report is never
 * an estimate, and without the port nothing changes.
 *
 * Secrets and addresses: the update-link secret is minted from the injected
 * randomness, returned once, and stored only as a SHA-256 hash. The uploader's
 * address is stored only as a hash too — it reaches the owner through the
 * notification, which is not a public repo.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import {
  editionPath,
  type PublishedEdition,
  type PublishedFile,
  type UploaderRecord,
} from './build.js';
import { eventContentHash, makeEventContent } from './ics.js';
import {
  isValidTimeZone,
  loadFestivalFromString,
  SchemaError,
  type FestivalDoc,
  type Namespace,
  type SetEntry,
} from './schema.js';
import { NO_OFFICIAL_URL, slugify, TranscribeError, type SetEdit } from './transcribe.js';
import { readImage, transcribe, type Headliner, type ModelOutput, type Transcription } from './transcription.js';
import {
  filenameOf,
  hostOf,
  imageDimensions,
  imageUrlsIn,
  isHtml,
  isLoginWall,
  isPublicAddress,
  publicLink,
  type FetchedImage,
  type WebPage,
} from './web.js';

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
/** The images a link's schedule check said no to, so the same page never pays to ask twice. */
export const SCREENED_PATH = 'state/screened.json';

/**
 * The most images a link reads off one page, in page order, before any is
 * looked at. A schedule page shows a handful; this bounds the fetching a
 * stranger's link can cause, not the reading — the reading is bounded by the
 * upload image limit.
 */
export const MAX_LINK_IMAGES_FETCHED = 60;
/** How many of a page's images are fetched at once. */
const LINK_FETCH_BATCH = 6;

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
  /** A committed text file on main, or null when there is none. A correction reads the YAML it replaces. */
  readFile(path: string): Promise<string | null>;
  /** Applies the commit to main and returns an id a pull request can branch from. */
  commit(commit: Commit): Promise<string>;
  openPullRequest(pr: PullRequest): Promise<void>;
}

/** What the owner is told. GitHub is the channel; this is the content. */
export interface Notification {
  kind: 'edition-published' | 'edition-corrected' | 'watch-failed' | 'signal' | 'look-ahead';
  /** Absent on a notice about no one edition — the look-ahead's. */
  editionPath?: string;
  title: string;
  body: string;
  /**
   * The uploader's address. The only place it appears — committed state keeps
   * a hash, because the repository is public and the address is a contact.
   * Absent when nobody uploaded anything: the watcher's notices have no one
   * behind them.
   */
  email?: string;
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

/**
 * What the publisher says while it works, so the page can say it too. Each
 * report is something that has already happened — never an estimate.
 *
 * `read` is an upload's: an image cleared the schedule check (`checked`), or
 * its reading is in hand, freshly transcribed (`read`) or already paid for
 * (`reused`). `image` is its position in the intent's list, from 0; `done`
 * counts the images whose reading is in hand; `sets` is every set read off
 * them so far; `headliners` are the ones on this image, when it was read.
 *
 * `confirm` is a confirm's: the checks began, the commit is being made, the
 * commit landed.
 */
export type Progress =
  | {
      kind: 'read';
      step: 'checked' | 'read' | 'reused';
      image: number;
      total: number;
      done: number;
      sets: number;
      headliners: Headliner[];
    }
  | { kind: 'confirm'; step: 'checking' | 'saving' | 'done' };

export type { Headliner };

/** Where the reports go. The upload adapter streams them to the browser; nothing else listens. */
export interface ProgressPort {
  report(progress: Progress): void;
}

export interface PublisherPorts {
  vision: VisionPort;
  repo: RepositoryPort;
  notify: NotifyPort;
  clock: ClockPort;
  random: RandomPort;
  owner: OwnerPort;
  /** Optional: without it the publisher works exactly as it always has, and says nothing. */
  progress?: ProgressPort;
}

/**
 * The web, as the link intent reads it. Nothing here decides anything: the
 * publisher checks every address before it asks for it, and reads the answer.
 * The live port refuses a non-public address again at connect time, on every
 * redirect (src/ports.ts), because a name can resolve one way for the check
 * and another for the request.
 */
export interface WebPort {
  /** Every address a host name resolves to; empty when it resolves to none. */
  resolve(hostname: string): Promise<string[]>;
  /** One page, redirects followed, whatever its status. Null when nothing answered at all. */
  page(url: string): Promise<WebPage | null>;
  /** One image's bytes, or null when it did not answer with one. */
  image(url: string): Promise<FetchedImage | null>;
}

/** The publisher's ports plus the web. What the link intent is handed. */
export interface LinkPorts extends PublisherPorts {
  web: WebPort;
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
  /** Present when the upload came through an update link. A correction if it holds. */
  update?: UpdateClaim;
  /** The secret from the owner's bookmarked link, if the page had one. */
  owner?: string;
}

/**
 * The update link as the browser hands it over: the edition it names and the
 * secret from its fragment. Holding a secret whose hash matches that edition's
 * uploader record is what makes someone its uploader (CONTEXT: update link).
 */
export interface UpdateClaim {
  editionPath: string;
  secret: string;
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
  /** Present when the confirm came through an update link. A correction if it holds. */
  update?: UpdateClaim;
  /** The secret from the owner's bookmarked link, if the page had one. */
  owner?: string;
}

/**
 * The festival's schedule page instead of screenshots: the link and the
 * contact address, and nothing else typed. The name, the year and the days
 * are read off the page's images, and the link is the official schedule.
 */
export interface LinkIntent {
  kind: 'link';
  /** The schedule page, as typed. A bare `festival.com/schedule` is read as https. */
  url: string;
  /** Contact address. Never an account (CONTEXT: uploader). */
  email: string;
  /** The secret from the owner's bookmarked link, if the page had one. */
  owner?: string;
}

/** The uploader taking their own edition down, from its update link. */
export interface RemoveIntent {
  kind: 'remove';
  update: UpdateClaim;
}

export type Intent = UploadIntent | LinkIntent | ConfirmIntent | RemoveIntent;

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
  | 'schema'
  /** The source carries no web address and none was typed; the schema needs one. */
  | 'link'
  /** A correction whose source reads as a different year than the edition. */
  | 'year'
  /** A correction that would drop a stage people have already added. */
  | 'stages'
  /** An update link for an edition that has been taken down. */
  | 'removed'
  /** A self-removal whose secret does not match the edition. */
  | 'update-link'
  /** A link that is not a public http(s) web page — refused before any request. */
  | 'address'
  /** A link whose page did not answer. */
  | 'unreachable'
  /** A link whose page wants a login first. */
  | 'login'
  /** A link whose page shows no image that reads as a schedule. */
  | 'no-schedule';

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
  /**
   * True when the update link held: confirming replaces the sets of the edition
   * at `editionPath` rather than making a new one.
   */
  correcting: boolean;
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

/**
 * A link's answer: the review an upload of the same images would give, plus
 * what an upload's uploader typed and a link's did not — read off the page
 * instead — and the images themselves, which the uploader never had. Confirm
 * takes those images back exactly as an upload's confirm does.
 */
export interface LinkResult extends UploadResult {
  /** The link, as the edition's official schedule. Confirm sends it back as `officialUrl`. */
  officialUrl: string | null;
  /** Every day the sets were read as, ISO, in order — a night past midnight counts as the day it started. */
  days: string[];
  /** The images the review was read off, in the review's order, as fetched. */
  images: SourceImage[];
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
  /** True when this confirm replaced an existing edition's sets through its update link. */
  corrected: boolean;
  /** On a correction, every set whose calendar event changed, was added, or was dropped. */
  changes: SetChange[];
  commit: Commit | null;
  notifications: Notification[];
  /** The listing pull request a fan confirm opens. Empty for the owner, who listed by confirming. */
  pullRequests: PullRequest[];
}

export interface RemoveResult {
  ok: boolean;
  rejection: Rejection | null;
  editionPath: string | null;
  /** Null when there was nothing to write — the edition was already blocked. */
  commit: Commit | null;
  notifications: Notification[];
}

/** One set as it was and as it is, local wall times. */
export interface SetTimes {
  artist: string;
  start: string;
  end: string;
}

/**
 * One set a correction changed, keyed as the UID is — stage and normalized
 * artist — so a changed set is exactly an event whose SEQUENCE the build will
 * advance, an added one a new UID, and a removed one a UID that leaves the feed.
 */
export interface SetChange {
  kind: 'added' | 'removed' | 'changed';
  stage: string;
  stageName: string;
  before: SetTimes | null;
  after: SetTimes | null;
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

/** A fan edition an update link has proved its holder uploaded. */
export interface ClaimedEdition {
  path: string;
  record: PublishedEdition & { uploader: UploaderRecord };
}

/**
 * The edition an update link names, if the secret it carries is that
 * edition's: its SHA-256 matches the hash the confirm stored. Anything else —
 * no link, an edition that does not exist or has no uploader, a wrong secret —
 * is null, and the intent is treated as a fresh upload that never touches an
 * existing edition. Fan editions only; the owner path is its own (ticket 10).
 */
export function claimedEdition(published: PublishedFile, claim: UpdateClaim | undefined): ClaimedEdition | null {
  if (!claim) return null;
  const record = Object.hasOwn(published.editions, claim.editionPath) ? published.editions[claim.editionPath] : undefined;
  if (!record || record.namespace !== 'fan' || !record.uploader) return null;
  const presented = Buffer.from(sha256(claim.secret), 'hex');
  const stored = Buffer.from(record.uploader.secretHash, 'hex');
  if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) return null;
  return { path: claim.editionPath, record: record as ClaimedEdition['record'] };
}

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
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
  noLink: "The image doesn't say where the times are posted. Add the link to the festival's schedule and try again.",
  removed: "This page was taken down, so it can't be changed from here.",
  wrongLink: "That update link doesn't match this page. Check you copied all of it.",
} as const;

/**
 * What a link that cannot be read says. Every one names the way forward that
 * always works: screenshots. A private address gets the same sentence as any
 * other link that is not a public page, so the answer says nothing about what
 * is behind it.
 */
export const LINK_COPY = {
  address: "That link isn't a public web page, so take screenshots of the schedule and add those instead.",
  unreachable: "That page didn't open for me, so take screenshots of the schedule and add those instead.",
  login: 'That page needs a login before it shows the times, so take screenshots of the schedule and add those instead.',
  noSchedule: "I couldn't find set times on that page, so take screenshots of the schedule and add those instead.",
  tooMany: 'The page had {n} images big enough to be the schedule, and only the {max} largest were read.',
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
  return {
    ok: false,
    rejection,
    updateSecret: null,
    editionPath: null,
    corrected: false,
    changes: [],
    commit: null,
    notifications: [],
    pullRequests: [],
  };
}

function rejectedRemove(rejection: Rejection): RemoveResult {
  return { ok: false, rejection, editionPath: null, commit: null, notifications: [] };
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
 *
 * A correction has no say in this: the edition its update link names keeps the
 * namespace it was published in, whatever secret came with the request. An
 * edition never moves between namespaces (README, the permanence contract;
 * docs/adr/0001-fan-namespace-prefix.md).
 */
function namespaceOf(
  intent: { owner?: string },
  ports: PublisherPorts,
  target: ClaimedEdition | null = null,
): Namespace {
  if (target) return target.record.namespace;
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
export function checkImage(image: SourceImage): Rejection | null {
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

  // An update link is checked before anything is spent, so a correction to a
  // page that has been taken down costs nothing. A link that does not hold is
  // not an error: it is a fresh upload, and the review says where it will live.
  const target = intent.update ? claimedEdition(await ports.repo.readPublished(), intent.update) : null;
  if (target?.record.blocked) return rejectedUpload(reject('removed', GATE_COPY.removed));

  const now = ports.clock.now();
  const stamp = icalStamp(now);
  const address = addressHash(intent.email);

  // Each image is looked up on its own. A retry of images already paid for
  // costs nothing and counts against nothing — that is the whole point of
  // storing the reply (story 31) — and a retry that adds a day pays for that
  // day alone.
  const saved = await Promise.all(hashes.map((hash) => ports.repo.readTranscription(hash)));
  const unread = images.flatMap((image, i) => (saved[i] ? [] : [i]));
  const tally = progressOf(ports, images.length);
  for (const [i, reading] of saved.entries()) if (reading) tally.read('reused', i, reading);
  if (unread.length === 0) {
    return finishUpload(intent, ports, saved as SavedTranscription[], { reused: true, commit: null, target });
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
    tally.checked(i);
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
    tally.read('read', i, reading);
  }

  const paidFor = fresh.map((f) => f.image);
  const commit: Commit = {
    message: `Transcribe an upload for ${intent.festival.trim()} (${paidFor.map((h) => h.slice(0, 12)).join(', ')})`,
    files: [
      ...fresh.map((f) => ({ path: `${TRANSCRIPTION_STORE_DIR}/${f.image}.json`, contents: committedJson(f) })),
      {
        path: UPLOADS_PATH,
        contents: committedJson({
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

  return finishUpload(intent, ports, saved as SavedTranscription[], { reused: false, commit, target });
}

/**
 * An upload's running count, reported as it moves: images whose reading is in
 * hand and the sets on them. A checked image adds nothing — it has not been
 * read yet.
 */
function progressOf(ports: PublisherPorts, total: number) {
  let done = 0;
  let sets = 0;
  const report = (p: Progress) => ports.progress?.report(p);
  return {
    checked(image: number) {
      report({ kind: 'read', step: 'checked', image, total, done, sets, headliners: [] });
    },
    read(step: 'read' | 'reused', image: number, reading: SavedTranscription) {
      const got = readImage({ source: storedImageName(reading), output: reading.output });
      done += 1;
      sets += got.sets;
      report({ kind: 'read', step, image, total, done, sets, headliners: got.headliners });
    },
  };
}

/** A confirm's step, reported. */
function confirmStep(ports: PublisherPorts, step: 'checking' | 'saving' | 'done'): void {
  ports.progress?.report({ kind: 'confirm', step });
}

/** Read the saved replies into one review payload. Shared by the cached path. */
async function finishUpload(
  intent: UploadIntent,
  ports: PublisherPorts,
  saved: SavedTranscription[],
  opts: { reused: boolean; commit: Commit | null; target: ClaimedEdition | null },
): Promise<UploadResult> {
  const read = await readReview(ports, saved, {
    ...opts,
    owner: intent.owner,
    name: intent.festival.trim(),
    slug: opts.target?.record.slug ?? slugify(intent.festival),
    officialUrl: intent.officialUrl,
    timezone: intent.timezone,
    typedYear: intent.dates.first.slice(0, 4),
  });
  return read.result;
}

/**
 * What a review is read with. An upload names the festival and its dates; a
 * link names neither, and the name and the year come off the images.
 */
interface ReadingOf {
  reused: boolean;
  commit: Commit | null;
  target: ClaimedEdition | null;
  owner?: string;
  /** The festival's name as typed. Absent: the name printed on the images. */
  name?: string;
  /** The slug to read under. Absent: derived from the name. */
  slug?: string;
  officialUrl?: string;
  timezone?: string;
  /** The year the typed dates are in. Absent: nothing typed, so nothing to mismatch. */
  typedYear?: string;
}

/**
 * The saved replies, read through the library into one review payload — the
 * one shape every intent that reads images answers with.
 */
async function readReview(
  ports: PublisherPorts,
  saved: SavedTranscription[],
  opts: ReadingOf,
): Promise<{ result: UploadResult; transcription: Transcription | null }> {
  const refused = (rejection: Rejection) => ({ result: rejectedUpload(rejection, opts.commit), transcription: null });
  // Recorded before it is read. A reply the library then refuses is still on
  // the record for the audit trail, and the fix-and-retry is free.
  if (opts.commit) await ports.repo.commit(opts.commit);

  const { target } = opts;
  const namespace = namespaceOf(opts, ports, target);
  const timezone = opts.timezone ?? DEFAULT_TIMEZONE;
  let transcription: Transcription;
  try {
    transcription = transcribe(modelOutputs(saved), {
      namespace,
      ...(opts.name !== undefined ? { name: opts.name } : {}),
      ...(opts.slug !== undefined ? { slug: opts.slug } : {}),
      officialUrl: opts.officialUrl,
      timezone,
      timezoneAssumed: opts.timezone === undefined,
    });
  } catch (err) {
    return refused(readingProblem(err));
  }

  const { festival, stages } = transcription.edition;
  if (target && festival.year !== target.record.year) {
    return refused(wrongYear(festival.year, target.record.year));
  }
  // A correction keeps the slug it has — the UIDs are derived from it. Anything
  // else claims one: suffixed inside `/fan/`, the festival's own at the root,
  // and refused where the owner already has that festival-year.
  const claimed = target
    ? { slug: target.record.slug }
    : claimSlug(await ports.repo.readPublished(), namespace, festival);
  if ('gate' in claimed) return refused(claimed);
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
    correcting: target !== null,
    timezone,
    timezoneAssumed: transcription.timezoneAssumed,
    yearMismatch: opts.typedYear !== undefined && opts.typedYear !== String(festival.year),
    stages: stages.map((s) => ({ id: s.id, name: s.name })),
    sets: transcription.sets.map((set, index) => ({
      index,
      stage: set.stage,
      stageName: stageNames.get(set.stage) ?? set.stage,
      artist: set.artist,
      start: set.start,
      end: set.end,
      endInferred: set.end_inferred,
      lowConfidence: lowConfidence(transcription.observations, set.printedArtist ?? set.artist),
      printedTime: set.printedTime,
      notes: set.notes,
      image: hashOf.get(set.source)!,
    })),
    observations: transcription.observations,
    reused: opts.reused,
  };

  return {
    result: { ok: true, rejection: null, review, commit: opts.commit, notifications: [], reused: opts.reused },
    transcription,
  };
}

// ---------------------------------------------------------------------------
// link
// ---------------------------------------------------------------------------

/**
 * The images not yet decided that the schedule check said no to, by content
 * hash — committed state, so a link tried twice asks about the same banner
 * once. Written only when the check said no.
 */
export interface ScreenedLedger {
  $comment?: string | string[];
  /** Hash → when the check said this image is not a schedule. */
  notSchedules: Record<string, string>;
}

const SCREENED_COMMENT = [
  'COMMITTED STATE — images a link\'s "is this a schedule" check said no to, by content hash, with',
  'when. A link that shows the same image again does not pay to ask again. An image the check said',
  'yes to is in state/transcriptions/ instead. Nothing in the build reads this file.',
];

/** A page image that cleared the free gates: hashed, sized, and ready to ask about. */
interface Candidate {
  hash: string;
  image: SourceImage;
  /** Where on the page it came, from 0. The order the review keeps. */
  order: number;
}

/**
 * The festival's schedule page, read into the same review an upload of its
 * images would give.
 *
 * Nothing typed but the link and the address, so the gates are the upload's
 * with the page in front of them, cheapest first, stopping at the first one
 * that fails:
 *
 *   1. the address; the link is a public http(s) web page    (free, no request)
 *   2. the caps — a link is one upload                       (free, no request)
 *   3. every address the host resolves to is public          (a name lookup)
 *   4. the page answers, without a login, as a web page      (one request)
 *   5. every image on it, fetched; the ones too small, too
 *      big or not an image by their header are dropped, and
 *      at most the upload image limit is kept, largest first (requests, no model)
 *   6. content-hash lookup, per image                         (free — a hit costs nothing)
 *   7. is this a schedule, per unread image — a no drops the
 *      image, not the link, and is remembered                 (a small model)
 *   8. transcribe, per schedule image not read before         (the real cost)
 *
 * What comes back is exactly an upload's review, read with the name and the
 * year printed on the images and the link as the official schedule, plus the
 * images themselves: confirm is the upload's confirm, and takes them back.
 */
export async function link(intent: LinkIntent, ports: LinkPorts): Promise<LinkResult> {
  const refused = (rejection: Rejection, commit: Commit | null = null): LinkResult => ({
    ...rejectedUpload(rejection, commit),
    officialUrl: null,
    days: [],
    images: [],
  });

  if (!EMAIL_RE.test(intent.email.trim())) return refused(reject('details', GATE_COPY.email));
  const target = publicLink(intent.url);
  if (!target) return refused(reject('address', LINK_COPY.address));

  // The caps before any request: a link is one upload, and a gate whose job
  // is to bound what a stranger can make this do cannot do it first.
  const now = ports.clock.now();
  const stamp = icalStamp(now);
  const address = addressHash(intent.email);
  const ledger = await ports.repo.readUploads();
  const capped = checkCaps(ledger, address, now);
  if (capped) return refused(capped);

  // A name is resolved before anything is asked of it, and one that leads
  // anywhere private is refused with the same sentence as any other address
  // that is not a public page.
  const reach = publicHosts(ports.web);
  const where = await reach(target);
  if (where === 'private') return refused(reject('address', LINK_COPY.address));
  if (where === 'nowhere') return refused(reject('unreachable', LINK_COPY.unreachable));

  const page = await ports.web.page(target.href);
  if (!page) return refused(reject('unreachable', LINK_COPY.unreachable));
  if (isLoginWall(page)) return refused(reject('login', LINK_COPY.login));
  if (page.status < 200 || page.status > 299) return refused(reject('unreachable', LINK_COPY.unreachable));
  if (!isHtml(page)) return refused(reject('address', LINK_COPY.address));

  // Every image the page shows, fetched and put through the free gates. What
  // cannot be a schedule by its header alone never reaches a model.
  const urls: string[] = [];
  for (const url of imageUrlsIn(page.html, page.url)) {
    if (urls.length >= MAX_LINK_IMAGES_FETCHED) break;
    const parsed = publicLink(url);
    if (parsed && (await reach(parsed)) === 'public') urls.push(parsed.href);
  }
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (let at = 0; at < urls.length; at += LINK_FETCH_BATCH) {
    const batch = urls.slice(at, at + LINK_FETCH_BATCH);
    const fetched = await Promise.all(batch.map((url) => ports.web.image(url)));
    for (const [i, got] of fetched.entries()) {
      if (!got) continue;
      const hash = sha256(got.bytes);
      if (seen.has(hash)) continue;
      seen.add(hash);
      const header = imageDimensions(got.bytes);
      if (!header) continue;
      const image: SourceImage = {
        filename: filenameOf(batch[i]!),
        contentType: header.contentType,
        bytes: got.bytes,
        width: header.width,
        height: header.height,
      };
      if (checkImage(image)) continue;
      candidates.push({ hash, image, order: candidates.length });
    }
  }
  if (candidates.length === 0) return refused(reject('no-schedule', LINK_COPY.noSchedule));

  // At most what one upload can carry, the largest first, then back into page
  // order — the order an uploader holding the same images would give them in.
  const area = (c: Candidate) => c.image.width * c.image.height;
  const kept = [...candidates]
    .sort((a, b) => area(b) - area(a) || a.order - b.order)
    .slice(0, MAX_UPLOAD_IMAGES)
    .sort((a, b) => a.order - b.order);
  const notes = candidates.length > kept.length ? [fill(LINK_COPY.tooMany, { n: candidates.length, max: kept.length })] : [];

  // Each image looked up on its own, exactly as an upload's: a reply already
  // paid for is a schedule and costs nothing; a no already paid for is not
  // asked again.
  const saved = await Promise.all(kept.map((c) => ports.repo.readTranscription(c.hash)));
  const screened = await readScreened(ports);
  const unread = kept.flatMap((c, i) => (saved[i] || screened.notSchedules[c.hash] ? [] : [i]));

  const noLonger: string[] = [];
  for (const i of unread) {
    const check = await ports.vision.looksLikeSchedule(kept[i]!.image);
    if (!check.isSchedule) noLonger.push(kept[i]!.hash);
  }
  const schedule = kept.flatMap((c, i) => (saved[i] || (unread.includes(i) && !noLonger.includes(c.hash)) ? [i] : []));

  const fresh: SavedTranscription[] = [];
  for (const i of schedule) {
    if (saved[i]) continue;
    const { hash, image } = kept[i]!;
    const output = await ports.vision.transcribe(image);
    const reading: SavedTranscription = { image: hash, filename: image.filename, contentType: image.contentType, output, transcribedAt: stamp };
    fresh.push(reading);
    saved[i] = reading;
  }

  // Anything paid for is recorded, whatever the page turns out to hold: the
  // replies, the noes, and the link as one upload against the caps.
  const paidFor = [...fresh.map((f) => f.image), ...noLonger];
  const commit: Commit | null =
    paidFor.length === 0
      ? null
      : {
          message: `${fresh.length > 0 ? 'Transcribe' : 'Screen'} a link to ${hostOf(target)} (${paidFor.map((h) => h.slice(0, 12)).join(', ')})`,
          files: [
            ...fresh.map((f) => ({ path: `${TRANSCRIPTION_STORE_DIR}/${f.image}.json`, contents: committedJson(f) })),
            ...(noLonger.length > 0
              ? [
                  {
                    path: SCREENED_PATH,
                    contents: committedJson({
                      $comment: screened.$comment ?? SCREENED_COMMENT,
                      notSchedules: sortKeys({ ...screened.notSchedules, ...Object.fromEntries(noLonger.map((h) => [h, stamp])) }),
                    }),
                  },
                ]
              : []),
            {
              path: UPLOADS_PATH,
              contents: committedJson({
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

  if (schedule.length === 0) {
    if (commit) await ports.repo.commit(commit);
    return refused(reject('no-schedule', LINK_COPY.noSchedule), commit);
  }

  const images = schedule.map((i) => kept[i]!.image);
  const read = await readReview(ports, schedule.map((i) => saved[i]!), {
    reused: commit === null,
    commit,
    target: null,
    owner: intent.owner,
    officialUrl: target.href,
  });
  if (!read.result.ok) return { ...read.result, officialUrl: null, days: [], images: [] };

  const review = read.result.review!;
  if (notes.length > 0) review.observations = [...review.observations, ...notes];
  return {
    ...read.result,
    officialUrl: target.href,
    days: [...new Set(read.transcription!.sets.map((s) => s.posterDate))].sort(),
    images,
  };
}

/**
 * Where a link's host leads: every address it resolves to is public, some
 * address is not, or it resolves to nothing. An address typed as an IP was
 * checked by `publicLink()`; a name is resolved once per host per intent.
 */
type Reach = 'public' | 'private' | 'nowhere';

function publicHosts(web: WebPort): (url: URL) => Promise<Reach> {
  const decided = new Map<string, Promise<Reach>>();
  return (url) => {
    const host = hostOf(url);
    if (isPublicAddress(host)) return Promise.resolve('public');
    let answer = decided.get(host);
    if (!answer) {
      answer = web
        .resolve(host)
        .then((addresses): Reach => (addresses.length === 0 ? 'nowhere' : addresses.every(isPublicAddress) ? 'public' : 'private'));
      decided.set(host, answer);
    }
    return answer;
  };
}

async function readScreened(ports: PublisherPorts): Promise<ScreenedLedger> {
  const text = await ports.repo.readFile(SCREENED_PATH);
  if (text === null) return { notSchedules: {} };
  const parsed = JSON.parse(text) as Partial<ScreenedLedger>;
  return { ...(parsed.$comment ? { $comment: parsed.$comment } : {}), notSchedules: parsed.notSchedules ?? {} };
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
  confirmStep(ports, 'checking');
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

  const published = await ports.repo.readPublished();
  const target = claimedEdition(published, intent.update);
  const namespace = namespaceOf(intent, ports, target);
  if (target?.record.blocked) return rejectedConfirm(reject('removed', GATE_COPY.removed));

  // Two passes. The first reads the source to find out what year it is, which
  // is what decides the slug; the second builds the edition under the slug that
  // read gives it. Both are deterministic over the same saved reply. A
  // correction keeps the slug it has — the UIDs are derived from it.
  let probe: Transcription;
  try {
    probe = transcribe(modelOutputs(saved), {
      namespace,
      name: intent.festival.trim(),
      slug: target?.record.slug ?? slugify(intent.festival),
      officialUrl: intent.officialUrl,
      timezone: intent.timezone,
      timezoneAssumed: intent.timezoneAssumed,
    });
  } catch (err) {
    return rejectedConfirm(readingProblem(err));
  }

  if (target && probe.edition.festival.year !== target.record.year) {
    return rejectedConfirm(wrongYear(probe.edition.festival.year, target.record.year));
  }
  const claimed = target ? { slug: target.record.slug } : claimSlug(published, namespace, probe.edition.festival);
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
  if (target) return correct(intent, ports, { target, published, transcription, saved, images, hashes });

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
      { path: PUBLISHED_PATH, contents: committedJson(nextPublished) },
    ],
    images: saved.map((reading, i) => ({
      path: `${SOURCE_IMAGE_DIR}/${storedImageName(reading)}`,
      contentType: reading.contentType,
      bytes: images[i]!.bytes,
    })),
  };

  confirmStep(ports, 'saving');
  const publishCommit = await ports.repo.commit(commit);
  confirmStep(ports, 'done');

  // The owner's confirm was a person tapping: nothing machine-initiated
  // happened, so nothing lands in the inbox.
  if (owner) {
    return {
      ok: true,
      rejection: null,
      updateSecret,
      editionPath: path,
      corrected: false,
      changes: [],
      commit,
      notifications: [],
      pullRequests: [],
    };
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
    corrected: false,
    changes: [],
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
      files: [{ path: PUBLISHED_PATH, contents: committedJson(listedState) }],
      images: [],
    },
  };
}

// ---------------------------------------------------------------------------
// correction — confirm through a valid update link
// ---------------------------------------------------------------------------

/**
 * Replace an edition's sets in place. Same slug, same year, same stage ids —
 * so every UID a subscriber already holds is still the UID of that set — and a
 * new publish stamp, so the build advances SEQUENCE for exactly the events
 * whose content moved and leaves the rest alone (src/build.ts, buildFeeds). The
 * sequence ledger is the build's to write; nothing here touches it.
 *
 * A stage already published cannot disappear (gate 4 would refuse the build),
 * so a correction that drops one is refused here, in words. The owner hears
 * about a correction only when the edition is listed, and nothing waits on
 * him: the commit lands either way.
 */
async function correct(
  intent: ConfirmIntent,
  ports: PublisherPorts,
  ctx: {
    target: ClaimedEdition;
    published: PublishedFile;
    transcription: Transcription;
    saved: SavedTranscription[];
    images: SourceImage[];
    hashes: string[];
  },
): Promise<ConfirmResult> {
  const { target, published, transcription, saved, images, hashes } = ctx;
  const doc = transcription.edition;
  const { path, record } = target;
  const key = `${record.slug}-${record.year}`;
  const yamlPath = `${FAN_DATA_DIR}/${key}.yaml`;

  const previousYaml = await ports.repo.readFile(yamlPath);
  const before = previousYaml === null ? null : loadFestivalFromString(previousYaml, yamlPath);

  const kept = new Set(doc.stages.map((s) => s.id));
  const dropped = record.stages.filter((id) => !kept.has(id));
  if (dropped.length > 0) {
    const names = dropped.map((id) => before?.stages.find((s) => s.id === id)?.name ?? id);
    return rejectedConfirm(droppedStages(names));
  }

  const stamp = icalStamp(ports.clock.now());
  const { images: _previousImages, ...uploader } = record.uploader;
  const nextRecord: PublishedEdition & { uploader: UploaderRecord } = {
    ...record,
    stages: [...new Set([...record.stages, ...kept])].sort(),
    uploader: {
      ...uploader,
      image: hashes[0]!,
      ...(hashes.length > 1 ? { images: hashes } : {}),
      correctedAt: stamp,
    },
  };
  const nextPublished: PublishedFile = {
    ...published,
    publishedAt: stamp,
    editions: sortKeys({ ...published.editions, [path]: nextRecord }),
  };

  const commit: Commit = {
    message: `Correct ${doc.festival.name} ${doc.festival.year} (${path}) through its update link`,
    files: [
      { path: yamlPath, contents: transcription.yaml },
      { path: `${SOURCE_DIR}/${path}/TRANSCRIPTION.md`, contents: transcription.log },
      { path: PUBLISHED_PATH, contents: committedJson(nextPublished) },
    ],
    images: saved.map((reading, i) => ({
      path: `${SOURCE_IMAGE_DIR}/${storedImageName(reading)}`,
      contentType: reading.contentType,
      bytes: images[i]!.bytes,
    })),
  };

  const changes = before ? diffSets(before, doc) : [];
  const notifications: Notification[] = record.listed
    ? [
        {
          kind: 'edition-corrected',
          editionPath: path,
          title: `Listed edition corrected: ${doc.festival.name} ${doc.festival.year}`,
          body: correctionBody(path, changes),
          email: intent.email.trim(),
        },
      ]
    : [];

  confirmStep(ports, 'saving');
  await ports.repo.commit(commit);
  confirmStep(ports, 'done');
  for (const n of notifications) await ports.notify.send(n);

  return {
    ok: true,
    rejection: null,
    // The secret the uploader already holds. Still never stored — only its hash.
    updateSecret: intent.update!.secret,
    editionPath: path,
    corrected: true,
    changes,
    commit,
    notifications,
    // No listing pull request. That one exists to offer the owner an edition
    // that has just appeared; a correction changes the times of one already
    // published and leaves `listed` exactly as it found it.
    pullRequests: [],
  };
}

/**
 * What a correction changed, set by set, keyed as the UID is. "Changed" means
 * the subscriber-visible event changed — the same content hash the build's
 * sequence ledger compares — so this list and the SEQUENCE bumps agree.
 */
export function diffSets(before: FestivalDoc, after: FestivalDoc): SetChange[] {
  const index = (doc: FestivalDoc) => {
    const stages = new Map(doc.stages.map((s) => [s.id, s]));
    const out = new Map<string, { set: SetEntry; stageName: string; hash: string }>();
    for (const set of doc.sets) {
      const stage = stages.get(set.stage)!;
      const content = makeEventContent(doc.festival, stage, set);
      out.set(content.uid, { set, stageName: stage.name, hash: eventContentHash(content) });
    }
    return out;
  };
  const was = index(before);
  const now = index(after);
  const times = (set: SetEntry): SetTimes => ({ artist: set.artist, start: set.start.raw, end: set.end.raw });

  const changes: SetChange[] = [];
  for (const [uid, next] of now) {
    const prev = was.get(uid);
    if (!prev) {
      changes.push({ kind: 'added', stage: next.set.stage, stageName: next.stageName, before: null, after: times(next.set) });
    } else if (prev.hash !== next.hash) {
      changes.push({ kind: 'changed', stage: next.set.stage, stageName: next.stageName, before: times(prev.set), after: times(next.set) });
    }
  }
  for (const [uid, prev] of was) {
    if (!now.has(uid)) {
      changes.push({ kind: 'removed', stage: prev.set.stage, stageName: prev.stageName, before: times(prev.set), after: null });
    }
  }
  const at = (c: SetChange) => (c.after ?? c.before)!;
  return changes.sort((a, b) => (at(a).start < at(b).start ? -1 : at(a).start > at(b).start ? 1 : at(a).artist < at(b).artist ? -1 : 1));
}

/** `2026-10-09T22:40:00` → `Oct 9 22:40`, for a line the owner reads. */
function wall(raw: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[Number(raw.slice(5, 7)) - 1]} ${Number(raw.slice(8, 10))} ${raw.slice(11, 16)}`;
}

function span(t: SetTimes): string {
  return `${wall(t.start)}–${t.end.slice(11, 16)}`;
}

/** One changed set as a line the owner reads, in a notification or a review. */
export function changeLine(c: SetChange): string {
  if (c.kind === 'added') return `- Added: ${c.after!.artist} (${c.stageName}), ${span(c.after!)}`;
  if (c.kind === 'removed') return `- Dropped: ${c.before!.artist} (${c.stageName}), was ${span(c.before!)}`;
  const renamed = c.before!.artist !== c.after!.artist ? `${c.before!.artist} → ${c.after!.artist}` : c.after!.artist;
  return `- ${renamed} (${c.stageName}): ${span(c.before!)} → ${span(c.after!)}`;
}

/** The notification body: one line per changed set, then where it lives. */
function correctionBody(path: string, changes: SetChange[]): string {
  const lines = changes.map(changeLine);
  const summary =
    changes.length === 0
      ? 'The uploader re-uploaded through the update link; no set changed.'
      : `The uploader corrected ${changes.length} set${changes.length === 1 ? '' : 's'} through the update link. Live already; nothing waits on you.`;
  return [summary, '', ...lines, ...(lines.length ? [''] : []), `https://stagetimes.app/${path}/`].join('\n');
}

// ---------------------------------------------------------------------------
// remove — the uploader's self-removal
// ---------------------------------------------------------------------------

/**
 * Block the edition the update link names. The same one-line edit the takedown
 * runbook describes: `blocked: true`, `listed` left alone, the YAML and the
 * sequence ledger untouched, so a revert brings every event back exactly as it
 * was. The stored source image is kept — a self-removal is not a rights claim,
 * and the image is the evidence behind the times (docs/takedown-runbook.md).
 *
 * A wrong secret is refused and writes nothing: removal has no "fresh" reading.
 */
export async function remove(intent: RemoveIntent, ports: PublisherPorts): Promise<RemoveResult> {
  const published = await ports.repo.readPublished();
  const target = claimedEdition(published, intent.update);
  if (!target) return rejectedRemove(reject('update-link', GATE_COPY.wrongLink));
  if (target.record.blocked) {
    return { ok: true, rejection: null, editionPath: target.path, commit: null, notifications: [] };
  }

  const nextPublished: PublishedFile = {
    ...published,
    editions: { ...published.editions, [target.path]: { ...target.record, blocked: true } },
  };
  const commit: Commit = {
    message:
      `Block ${target.path}: self-removal through its update link\n\n` +
      'The stored source image is kept; a self-removal is not a rights claim (docs/takedown-runbook.md).',
    files: [{ path: PUBLISHED_PATH, contents: committedJson(nextPublished) }],
    images: [],
  };
  await ports.repo.commit(commit);
  return { ok: true, rejection: null, editionPath: target.path, commit, notifications: [] };
}

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/** One intent in, the writes and notifications it would make out. */
export async function publish(intent: UploadIntent, ports: PublisherPorts): Promise<UploadResult>;
export async function publish(intent: LinkIntent, ports: LinkPorts): Promise<LinkResult>;
export async function publish(intent: ConfirmIntent, ports: PublisherPorts): Promise<ConfirmResult>;
export async function publish(intent: RemoveIntent, ports: PublisherPorts): Promise<RemoveResult>;
export async function publish(intent: Intent, ports: LinkPorts): Promise<UploadResult | ConfirmResult | RemoveResult>;
export async function publish(intent: Intent, ports: PublisherPorts | LinkPorts): Promise<UploadResult | ConfirmResult | RemoveResult> {
  if (intent.kind === 'upload') return upload(intent, ports);
  if (intent.kind === 'link') {
    if (!('web' in ports)) throw new Error('a link intent needs the web port');
    return link(intent, ports);
  }
  if (intent.kind === 'confirm') return confirm(intent, ports);
  return remove(intent, ports);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** The stored name of a source image: its content hash plus a real extension. */
export function storedImageName(saved: Pick<SavedTranscription, 'image' | 'contentType'>): string {
  return `${saved.image}${EXTENSIONS[saved.contentType] ?? '.bin'}`;
}

/** The saved replies as the library takes them, one source per image, in order. */
export function modelOutputs(saved: SavedTranscription[]): ModelOutput[] {
  return saved.map((s) => ({ source: storedImageName(s), output: s.output }));
}

/** `a`, `a and b`, `a, b and c` — for a sentence the owner reads. */
export function listed(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** A correction whose source reads as another year: that is another edition. */
function wrongYear(read: number, edition: number): Rejection {
  return reject(
    'year',
    `That image reads as ${read}, and this page is for ${edition}. For ${read}, add it as a new festival.`,
  );
}

/** A correction without a stage people have already added. */
function droppedStages(names: string[]): Rejection {
  return reject(
    'stages',
    names.length === 1
      ? `${names[0]} isn't in these times, and people have already added it. Include the image with its sets.`
      : `${listed(names)} aren't in these times, and people have already added them. Include the images with their sets.`,
  );
}

/**
 * Turn a library failure into something a person can act on. A `SchemaError`
 * means the edition would not build — usually a time an edit made impossible —
 * and its own problems ride along for the screen to lay out.
 */
export function readingProblem(err: unknown): Rejection {
  if (err instanceof SchemaError) {
    return reject(
      'schema',
      `Those times don't hold together: ${err.problems[0] ?? 'the schedule is not publishable'}`,
      err.problems,
    );
  }
  if (err instanceof TranscribeError && err.message === NO_OFFICIAL_URL) {
    // The CLI's sentence names a flag; the page has a field for it instead.
    return reject('link', GATE_COPY.noLink);
  }
  if (err instanceof TranscribeError) {
    return reject('schema', `I couldn't read that into a schedule: ${err.message}`);
  }
  throw err;
}

/** JSON as committed state is written: 2-space indent, trailing newline. */
export function committedJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

export function sortKeys<T>(obj: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(obj).sort()) out[k] = obj[k]!;
  return out;
}
