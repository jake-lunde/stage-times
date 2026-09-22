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
 * Three intents live here, and every one is the owner's (ADR-0005): each
 * carries the secret from the owner's bookmarked link, and an intent the owner
 * port does not recognize is refused before anything else is looked at.
 *
 *   upload   images plus a festival name and dates, through the pre-spend
 *            gates, into a review payload to check against the images.
 *   link     the festival's schedule page, and nothing else: the page's
 *            images, fetched and put through the same gates, into the same
 *            review (ticket 19).
 *   confirm  that review, with its corrections, validated through the real
 *            schema and committed to main as an edition, listed in the same
 *            commit: the owner tapping is the approval.
 *
 * The watcher (`src/watcher.ts`, ticket 11) is the same shape from the other
 * side: the same ports plus one for pages, and its review pull requests carry
 * the edition exactly as the owner's confirm commits it.
 *
 * Three rules this module exists to enforce:
 *
 *   1. **Nothing costs money before it has earned it.** The gates run in a
 *      fixed order, cheapest first, and every one of them returns a plain
 *      sentence a person can read. A previously transcribed image costs
 *      nothing at all.
 *   2. **Only the owner publishes, and never over an edition already there.**
 *      Everything lands at the root (`data/<key>.yaml`); `/fan/` holds only
 *      the editions from before, and nothing here writes it.
 *   3. **The publish stamp comes from the injected clock, at commit time.**
 *      The build still never reads a clock; this is the one place a real time
 *      enters the system, and it enters as committed state.
 *
 * While it works, upload and confirm report what has happened through an
 * optional progress port — each image checked and read, each confirm step —
 * which the upload adapter streams to the page (ticket 21). A report is never
 * an estimate, and without the port nothing changes.
 */

import { createHash } from 'node:crypto';
import { editionPath, type PublishedEdition, type PublishedFile } from './build.js';
import { eventContentHash, makeEventContent } from './ics.js';
import {
  isValidTimeZone,
  loadFestivalFromString,
  SchemaError,
  type FestivalDoc,
  type SetEntry,
} from './schema.js';
import { NO_OFFICIAL_URL, slugify, TranscribeError, type SetEdit } from './transcribe.js';
import { daysRead, festivalRead, movedDays, readImage, transcribe, type Headliner, type ModelOutput, type Transcription } from './transcription.js';
import { loadAlmanac, zoneOnRecord } from './almanac.js';
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

/**
 * The zone the times are read in when nobody has said. A source image cannot
 * carry this, so it is always shown as an assumption on review and is always
 * changeable there.
 */
export const DEFAULT_TIMEZONE = 'America/Los_Angeles';

/** Where each kind of file goes. Every edition is the owner's, at the root. */
export const OWNER_DATA_DIR = 'data';
export const SOURCE_DIR = 'source';
export const SOURCE_IMAGE_DIR = 'source/images';
export const TRANSCRIPTION_STORE_DIR = 'state/transcriptions';
export const PUBLISHED_PATH = 'state/published.json';
/** The images a link's schedule check said no to, so the same page never pays to ask twice. */
export const SCREENED_PATH = 'state/screened.json';
/** The almanac (src/almanac.ts): read for the zone a festival on record prints its times in. */
export const ALMANAC_PATH = 'config/festivals.yaml';

/**
 * The most images a link reads off one page, in page order, before any is
 * looked at. A schedule page shows a handful; this bounds the fetching one
 * link can cause, not the reading — the reading is bounded by the upload
 * image limit.
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
  /** The saved transcription for an image content hash, or null. */
  readTranscription(hash: string): Promise<SavedTranscription | null>;
  /** A committed text file on main, or null when there is none. The watcher reads the YAML a change replaces. */
  readFile(path: string): Promise<string | null>;
  /** Applies the commit to main and returns an id a pull request can branch from. */
  commit(commit: Commit): Promise<string>;
  openPullRequest(pr: PullRequest): Promise<void>;
}

/**
 * What the owner is told. GitHub is the channel — a public one, since the
 * repository is public — so a notice carries no one's address, ever.
 */
export interface Notification {
  kind: 'watch-failed' | 'signal' | 'look-ahead';
  /** Absent on a notice about no one edition — the look-ahead's. */
  editionPath?: string;
  title: string;
  body: string;
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
 * publisher refuses every no the same way, before anything else is looked at.
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
  | { kind: 'confirm'; step: 'checking' | 'saving' | 'done' }
  /** A link's own steps ahead of the reading: the page is being opened; its images are in hand, this many worth reading (ticket 20). */
  | { kind: 'link'; step: 'page' }
  | { kind: 'link'; step: 'found'; images: number };

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

// ---------------------------------------------------------------------------
// Intents and results
// ---------------------------------------------------------------------------

export interface UploadIntent {
  kind: 'upload';
  /** Festival name as typed. Becomes the display name. */
  festival: string;
  /** The days the edition runs, as typed, ISO `YYYY-MM-DD`. */
  dates: { first: string; last: string };
  /** IANA zone picked on the form, if any. Assumed otherwise. */
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
  /** The secret from the owner's bookmarked link. Nothing is read without it. */
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
   * The review's `images`, echoed back: the hashes the sets were checked
   * against. Required for more than one image, so a confirm cannot quietly
   * publish a subset or a reordering of what was reviewed.
   */
  reviewed?: string[];
  festival: string;
  /** The zone as it stood on review, changed or not. */
  timezone: string;
  /** False once the zone has been confirmed or changed on review. */
  timezoneAssumed: boolean;
  officialUrl?: string;
  /** Corrections, by set index in the review payload. */
  edits: SetEdit[];
  /** Indices of sets that could not be verified. Any one blocks confirm. */
  unverifiable: number[];
  /**
   * The days as they stand after checking, one for each day the
   * images were read as, in that order (a link's `days`; ticket 20). A day
   * that differs moves every set printed under it, and the year with it.
   * Absent, or the same list: the days stay as read.
   */
  days?: string[];
  /** The secret from the owner's bookmarked link. Nothing is published without it. */
  owner?: string;
}

/**
 * The festival's schedule page instead of screenshots: the link, and nothing
 * else typed. The name, the year and the days are read off the page's images,
 * and the link is the official schedule.
 */
export interface LinkIntent {
  kind: 'link';
  /** The schedule page, as typed. A bare `festival.com/schedule` is read as https. */
  url: string;
  /** The secret from the owner's bookmarked link. Nothing is fetched without it. */
  owner?: string;
}

export type Intent = UploadIntent | LinkIntent | ConfirmIntent;

/** Which gate stopped it. The screen picks its shape from this. */
export type Gate =
  /** No owner secret, or not the owner's. Refused before anything else. */
  | 'owner'
  | 'details'
  | 'images'
  | 'type'
  | 'size'
  | 'dimensions'
  | 'schedule'
  | 'expired'
  | 'review'
  | 'schema'
  /** The source carries no web address and none was typed; the schema needs one. */
  | 'link'
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

/** One set as the review screen shows it, beside the image it was read from. */
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
  /** The model said it was unsure of this line. The review's one flag: look here. */
  lowConfidence: boolean;
  /** Why, in the model's few words; empty when it was sure. */
  unsure: string;
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
  /** The slug this edition would claim. */
  slug: string;
  /** The year the source reads as. */
  year: number;
  /** Where the feeds would live: `<slug>-<year>`, at the root. */
  editionPath: string;
  timezone: string;
  /** True while nobody has confirmed the zone. The source cannot carry it. */
  timezoneAssumed: boolean;
  /**
   * True when the zone is the festival's own, from the record of it
   * (config/festivals.yaml, matched by the schedule page or the printed name)
   * rather than the default. Not assumed, and not yet anyone's word either.
   */
  timezoneOnRecord: boolean;
  /** True when the source reads as a different year than the dates typed. */
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
  /** True when an earlier upload of the same image paid for the transcription. */
  reused: boolean;
}

/**
 * A link's answer: the review an upload of the same images would give, plus
 * what an upload types and a link does not — read off the page instead — and
 * the images themselves, which nobody had in hand. Confirm takes those images
 * back exactly as an upload's confirm does.
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
  /** `<slug>-<year>` — where the feeds live. */
  editionPath: string | null;
  commit: Commit | null;
}

/** One set as it was and as it is, local wall times. */
export interface SetTimes {
  artist: string;
  start: string;
  end: string;
}

/**
 * One set a change on the schedule page moved, keyed as the UID is — stage and
 * normalized artist — so a changed set is exactly an event whose SEQUENCE the
 * build will advance, an added one a new UID, and a removed one a UID that
 * leaves the feed. The watcher's review diff.
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

/** Epoch ms → the `YYYYMMDDTHHMMSSZ` stamp committed state is written in. */
export function icalStamp(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The sentences the free gates speak, in one place, so the upload screen can
 * say exactly the same thing before a request is made (it injects this
 * object) and no second copy of the copy rules exists. `{short}`, `{min}` and
 * `{n}` are filled in by `fill()`.
 */
export const GATE_COPY = {
  owner: 'Only I add festivals here.',
  festival: "Type the festival's name first.",
  dates: "Those dates don't look right. Give the day it starts and the day it ends.",
  notImage: "That file isn't an image. A screenshot or a photo of the schedule works.",
  tooSmall: 'That image is {short} pixels on its short side. Under {min} there is nothing legible to read the times off.',
  unreadableOne: "One set is still marked as one you can't read. Check it against your image, then confirm.",
  unreadableMany: "{n} sets are still marked as ones you can't read. Check them against your image, then confirm.",
  noLink: "The image doesn't say where the times are posted. Add the link to the festival's schedule and try again.",
  days: "Those days don't look right. Give each day that was read its own date.",
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
  return { ok: false, rejection, review: null, commit, reused: false };
}

function rejectedConfirm(rejection: Rejection): ConfirmResult {
  return { ok: false, rejection, editionPath: null, commit: null };
}

/**
 * Every intent's first gate: the owner's secret, or nothing. A wrong secret, a
 * missing one and a deployment with none set are refused alike, before a
 * field is read or a request made — so nothing anyone else sends can cost a
 * call or write a byte (ADR-0005).
 */
function notTheOwner(intent: { owner?: string }, ports: PublisherPorts): Rejection | null {
  return ports.owner.recognizes(intent.owner) ? null : reject('owner', GATE_COPY.owner);
}

/** Megabytes, one decimal, for a sentence a person reads. */
function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '');
}

/**
 * The slug an edition claims, or a rejection. It is the festival's own, never
 * minted, and an edition already there is refused rather than replaced —
 * changing one is the watcher's review or a hand edit, not this intent.
 */
function claimSlug(
  published: PublishedFile,
  festival: { name: string; slug: string; year: number },
): { slug: string } | Rejection {
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
 * A rejection about one image of several says which, as the form counts
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

/** The festival name, dates and zone typed on the form. */
function checkDetails(intent: UploadIntent): Rejection | null {
  const named = checkFestival(intent.festival);
  if (named) return named;
  if (!ISO_DATE_RE.test(intent.dates.first) || !ISO_DATE_RE.test(intent.dates.last) || intent.dates.last < intent.dates.first) {
    return reject('details', GATE_COPY.dates);
  }
  if (intent.timezone !== undefined && !isValidTimeZone(intent.timezone)) {
    return reject('details', "That time zone isn't one I know.");
  }
  return null;
}

/** The festival's name, which both upload and confirm carry. Checked here so the schema never has to. */
function checkFestival(festival: string): Rejection | null {
  if (festival.trim() === '' || slugify(festival) === '') {
    return reject('details', GATE_COPY.festival);
  }
  return null;
}

// ---------------------------------------------------------------------------
// upload
// ---------------------------------------------------------------------------

/**
 * The images plus what was typed, through the gates, into a review.
 *
 * Most festivals post one image per day, so an upload is a list of images in
 * day order; one image is a list of one. The gates run cheapest first and stop
 * at the first one that fails, so a rejection never costs a model call it did
 * not have to make:
 *
 *   1. the owner's secret                       (free)
 *   2. what was typed                           (free)
 *   3. how many images; each one's type, size,
 *      dimensions; no image twice               (free)
 *   4. content-hash lookup, per image           (free — a hit costs nothing at all)
 *   5. is this a schedule, per unread image     (a small model)
 *   6. transcribe, per unread image             (the real cost)
 *
 * Every image clears 5 before any image reaches 6. A rejection about one image
 * names it, and none of the others is paid for until it is fixed.
 */
export async function upload(intent: UploadIntent, ports: PublisherPorts): Promise<UploadResult> {
  const stranger = notTheOwner(intent, ports);
  if (stranger) return rejectedUpload(stranger);

  const details = checkDetails(intent);
  if (details) return rejectedUpload(details);

  const images = imagesOf(intent);
  const hashes = images.map((image) => sha256(image.bytes));
  const imageProblem = checkImages(images, hashes);
  if (imageProblem) return rejectedUpload(imageProblem);

  const stamp = icalStamp(ports.clock.now());

  // Each image is looked up on its own. A retry of images already paid for
  // costs nothing — that is the whole point of storing the reply (story 31) —
  // and a retry that adds a day pays for that day alone.
  const saved = await Promise.all(hashes.map((hash) => ports.repo.readTranscription(hash)));
  const unread = images.flatMap((image, i) => (saved[i] ? [] : [i]));
  const tally = progressOf(ports, images.length);
  for (const [i, reading] of saved.entries()) if (reading) tally.read('reused', i, reading);
  if (unread.length === 0) {
    return finishUpload(intent, ports, saved as SavedTranscription[], { reused: true, commit: null });
  }

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

  const commit: Commit = {
    message: `Transcribe an upload for ${intent.festival.trim()} (${fresh.map((f) => f.image.slice(0, 12)).join(', ')})`,
    files: fresh.map((f) => ({ path: `${TRANSCRIPTION_STORE_DIR}/${f.image}.json`, contents: committedJson(f) })),
    images: [],
  };

  return finishUpload(intent, ports, saved as SavedTranscription[], { reused: false, commit });
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
  opts: { reused: boolean; commit: Commit | null },
): Promise<UploadResult> {
  const read = await readReview(ports, saved, {
    ...opts,
    name: intent.festival.trim(),
    slug: slugify(intent.festival),
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

  // The zone: the human's, else the festival's own from the record of it,
  // else the default — assumed, and the review says so.
  const outputs = modelOutputs(saved);
  const onRecord = opts.timezone === undefined ? await zoneFromRecord(ports, outputs, opts) : null;
  const timezone = opts.timezone ?? onRecord ?? DEFAULT_TIMEZONE;
  let transcription: Transcription;
  try {
    transcription = transcribe(outputs, {
      namespace: 'owner',
      ...(opts.name !== undefined ? { name: opts.name } : {}),
      ...(opts.slug !== undefined ? { slug: opts.slug } : {}),
      officialUrl: opts.officialUrl,
      timezone,
      timezoneAssumed: opts.timezone === undefined && onRecord === null,
    });
  } catch (err) {
    return refused(readingProblem(err));
  }

  const { festival, stages } = transcription.edition;
  // The festival's own slug, refused where that festival-year already has a page.
  const claimed = claimSlug(await ports.repo.readPublished(), festival);
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
    editionPath: editionPath('owner', `${slug}-${festival.year}`),
    timezone,
    timezoneAssumed: transcription.timezoneAssumed,
    timezoneOnRecord: onRecord !== null,
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
      lowConfidence: Boolean(set.unsure),
      unsure: set.unsure ?? '',
      printedTime: set.printedTime,
      notes: set.notes,
      image: hashOf.get(set.source)!,
    })),
    observations: transcription.observations,
    reused: opts.reused,
  };

  return {
    result: { ok: true, rejection: null, review, commit: opts.commit, reused: opts.reused },
    transcription,
  };
}

/**
 * The festival's own zone, from the almanac on main, when the reading matches
 * a festival on record by its schedule page or its name (src/almanac.ts) —
 * the name as typed first, then as printed. A missing or unreadable almanac
 * is no zone, never a refusal: the record is a convenience, and the review
 * shows whatever zone it has to change.
 */
async function zoneFromRecord(ports: PublisherPorts, outputs: ModelOutput[], opts: Pick<ReadingOf, 'name' | 'officialUrl'>): Promise<string | null> {
  const text = await ports.repo.readFile(ALMANAC_PATH);
  if (text === null) return null;
  let almanac: ReturnType<typeof loadAlmanac>;
  try {
    almanac = loadAlmanac(text);
  } catch {
    return null;
  }
  const read = festivalRead(outputs);
  const url = opts.officialUrl ?? read.officialUrl;
  return zoneOnRecord(almanac, { url, name: opts.name ?? read.name }) ?? (opts.name !== undefined ? zoneOnRecord(almanac, { name: read.name }) : null);
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
 * Nothing typed but the link, so the gates are the upload's with the page in
 * front of them, cheapest first, stopping at the first one that fails:
 *
 *   1. the owner's secret                                    (free, no request)
 *   2. the link is a public http(s) web page                 (free, no request)
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

  const stranger = notTheOwner(intent, ports);
  if (stranger) return refused(stranger);
  const target = publicLink(intent.url);
  if (!target) return refused(reject('address', LINK_COPY.address));
  const stamp = icalStamp(ports.clock.now());

  // A name is resolved before anything is asked of it, and one that leads
  // anywhere private is refused with the same sentence as any other address
  // that is not a public page.
  const reach = publicHosts(ports.web);
  const where = await reach(target);
  if (where === 'private') return refused(reject('address', LINK_COPY.address));
  if (where === 'nowhere') return refused(reject('unreachable', LINK_COPY.unreachable));

  ports.progress?.report({ kind: 'link', step: 'page' });
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
  // order until they are read — day order after that, below.
  const area = (c: Candidate) => c.image.width * c.image.height;
  const kept = [...candidates]
    .sort((a, b) => area(b) - area(a) || a.order - b.order)
    .slice(0, MAX_UPLOAD_IMAGES)
    .sort((a, b) => a.order - b.order);
  const notes = candidates.length > kept.length ? [fill(LINK_COPY.tooMany, { n: candidates.length, max: kept.length })] : [];
  ports.progress?.report({ kind: 'link', step: 'found', images: kept.length });

  // Each image looked up on its own, exactly as an upload's: a reply already
  // paid for is a schedule and costs nothing; a no already paid for is not
  // asked again. Reported as an upload's images are (ticket 21), over the
  // images kept: the page can count them the same way.
  const saved = await Promise.all(kept.map((c) => ports.repo.readTranscription(c.hash)));
  const screened = await readScreened(ports);
  const unread = kept.flatMap((c, i) => (saved[i] || screened.notSchedules[c.hash] ? [] : [i]));
  const tally = progressOf(ports, kept.length);
  for (const [i, reading] of saved.entries()) if (reading) tally.read('reused', i, reading);

  const noLonger: string[] = [];
  for (const i of unread) {
    const check = await ports.vision.looksLikeSchedule(kept[i]!.image);
    if (!check.isSchedule) noLonger.push(kept[i]!.hash);
    else tally.checked(i);
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
    tally.read('read', i, reading);
  }

  // Anything paid for is recorded, whatever the page turns out to hold: the
  // replies and the noes.
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
          ],
          images: [],
        };

  if (schedule.length === 0) {
    if (commit) await ports.repo.commit(commit);
    return refused(reject('no-schedule', LINK_COPY.noSchedule), commit);
  }

  // Into day order — the order someone holding the same images would give
  // them in, whatever order the page listed them. An image whose reply names
  // no day keeps its page order, after the rest.
  const firstDay = (i: number) => daysRead(modelOutputs([saved[i]!]))[0] ?? '\uffff';
  schedule.sort((a, b) => (firstDay(a) < firstDay(b) ? -1 : firstDay(a) > firstDay(b) ? 1 : a - b));
  const images = schedule.map((i) => kept[i]!.image);
  const read = await readReview(ports, schedule.map((i) => saved[i]!), {
    reused: commit === null,
    commit,
    officialUrl: target.href,
  });
  if (!read.result.ok) return { ...read.result, officialUrl: null, days: [], images: [] };

  const review = read.result.review!;
  if (notes.length > 0) review.observations = [...review.observations, ...notes];
  return {
    ...read.result,
    officialUrl: target.href,
    days: daysRead(modelOutputs(schedule.map((i) => saved[i]!))),
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
 * The owner's confirm: this is the human check the whole pipeline waits for.
 *
 * The sets are rebuilt from the saved model reply rather than from anything the
 * browser sends back, so the only thing a client can change is the three fields
 * the review screen exposes — and every one of those is recorded in the log.
 * The result passes through the real schema loader on its way out: if it would
 * not build, it is not committed.
 */
export async function confirm(intent: ConfirmIntent, ports: PublisherPorts): Promise<ConfirmResult> {
  const stranger = notTheOwner(intent, ports);
  if (stranger) return rejectedConfirm(stranger);
  confirmStep(ports, 'checking');
  const named = checkFestival(intent.festival);
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

  // The days as checked (ticket 20): one date per day read, or the reading
  // stands. A list that does not fit the reading is refused — nothing is
  // guessed about which day was meant.
  const outputs = daysAsChecked(modelOutputs(saved), intent.days);
  if ('gate' in outputs) return rejectedConfirm(outputs);

  // Two passes. The first reads the source to find out what year it is, which
  // is what decides the slug; the second builds the edition under the slug that
  // read gives it. Both are deterministic over the same saved reply.
  let probe: Transcription;
  try {
    probe = transcribe(outputs, {
      namespace: 'owner',
      name: intent.festival.trim(),
      slug: slugify(intent.festival),
      officialUrl: intent.officialUrl,
      timezone: intent.timezone,
      timezoneAssumed: intent.timezoneAssumed,
    });
  } catch (err) {
    return rejectedConfirm(readingProblem(err));
  }

  const claimed = claimSlug(published, probe.edition.festival);
  if ('gate' in claimed) return rejectedConfirm(claimed);
  const slug = claimed.slug;

  let transcription: Transcription;
  try {
    transcription = transcribe(outputs, {
      namespace: 'owner',
      name: intent.festival.trim(),
      slug,
      officialUrl: intent.officialUrl,
      timezone: intent.timezone,
      timezoneAssumed: intent.timezoneAssumed,
      edits: intent.edits,
      // The owner checking every set against the images IS the human
      // verification the build's production gate asks for.
      verified: true,
    });
  } catch (err) {
    return rejectedConfirm(readingProblem(err));
  }

  const doc: FestivalDoc = transcription.edition;
  const key = `${doc.festival.slug}-${doc.festival.year}`;
  const path = editionPath('owner', key);

  // The publish stamp: the one real time in the system, taken here and written
  // into committed state so the build never has to read a clock.
  const stamp = icalStamp(ports.clock.now());

  const record: PublishedEdition = {
    slug: doc.festival.slug,
    year: doc.festival.year,
    namespace: 'owner',
    // Never auto-list. Listing is the owner's act, always (CONTEXT: listing) —
    // and the owner's own confirm is that act, in the same commit.
    listed: true,
    blocked: false,
    stages: doc.stages.map((s) => s.id).sort(),
  };

  const nextPublished: PublishedFile = {
    ...published,
    publishedAt: stamp,
    editions: sortKeys({ ...published.editions, [path]: record }),
  };

  const commit: Commit = {
    message: `Publish and list ${doc.festival.name} ${doc.festival.year} (${path})`,
    files: [
      { path: `${OWNER_DATA_DIR}/${key}.yaml`, contents: transcription.yaml },
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
  await ports.repo.commit(commit);
  confirmStep(ports, 'done');

  // A person tapped: nothing machine-initiated happened, so nothing lands in
  // the inbox.
  return { ok: true, rejection: null, editionPath: path, commit };
}

/**
 * What a change on the schedule page moved, set by set, keyed as the UID is.
 * "Changed" means the subscriber-visible event changed — the same content hash
 * the build's sequence ledger compares — so this list and the SEQUENCE bumps
 * agree. The watcher's review diff.
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

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

/** One intent in, the writes it would make out. */
export async function publish(intent: UploadIntent, ports: PublisherPorts): Promise<UploadResult>;
export async function publish(intent: LinkIntent, ports: LinkPorts): Promise<LinkResult>;
export async function publish(intent: ConfirmIntent, ports: PublisherPorts): Promise<ConfirmResult>;
export async function publish(intent: Intent, ports: LinkPorts): Promise<UploadResult | ConfirmResult>;
export async function publish(intent: Intent, ports: PublisherPorts | LinkPorts): Promise<UploadResult | ConfirmResult> {
  if (intent.kind === 'upload') return upload(intent, ports);
  if (intent.kind === 'link') {
    if (!('web' in ports)) throw new Error('a link intent needs the web port');
    return link(intent, ports);
  }
  return confirm(intent, ports);
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

/**
 * The replies with their days as checked on review (ticket 20): the
 * list has to name one date for each day read, in that order, every one a
 * date and no two the same. The same list as read changes nothing; absent, the
 * reading stands. Anything else is refused rather than guessed at.
 */
export function daysAsChecked(outputs: ModelOutput[], days: string[] | undefined): ModelOutput[] | Rejection {
  if (days === undefined) return outputs;
  const read = daysRead(outputs);
  const fits = days.length === read.length && days.every((d) => ISO_DATE_RE.test(d)) && new Set(days).size === days.length;
  if (!fits) return reject('review', GATE_COPY.days);
  if (days.every((d, i) => d === read[i])) return outputs;
  return movedDays(outputs, read, days);
}

/** `a`, `a and b`, `a, b and c` — for a sentence the owner reads. */
export function listed(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
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
