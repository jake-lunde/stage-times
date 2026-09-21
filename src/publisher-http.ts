/**
 * Stage Times — turning an HTTP request into an intent, and a result into a
 * response. The shared half of the two serverless adapters.
 *
 * There is no rule in this file. It reads fields, decodes an image, picks a
 * status code, and serializes — everything that is true of *HTTP* rather than
 * of publishing. `api/upload.ts`, `api/link.ts` and `api/confirm.ts` each read
 * their own intent's fields and call the publisher; this is what they share.
 *
 * The reason text in a rejection comes from `src/publisher.ts` and is passed
 * through untouched: it is written to be read by the person who uploaded, and
 * an adapter that rewords it would be a second copy of the copy rules.
 *
 * Transport note: a serverless platform caps the request body well below the
 * publisher's own image limit, so an oversized image is refused by the platform
 * before any of this runs, with the platform's words rather than mine. The
 * upload screen (ticket 08) downscales before posting for exactly that reason.
 *
 * Progress (ticket 21): a client that sends `Accept: application/x-ndjson`
 * gets the publisher's progress reports as they happen, one JSON line each
 * (`{"progress": …}`), and then the answer as the last line — exactly the body
 * it would have got otherwise, on one line. The status is sent before the
 * answer is known, so it is 200; the answer's own `ok` and `gate` say the
 * rest. A client that does not ask gets exactly what it always did.
 */

import type { Gate, Progress, ProgressPort, Rejection, SourceImage, UpdateClaim } from './publisher.js';

/** A request that could not be read as an intent at all. */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

export type Body = Record<string, unknown>;

export async function readJsonBody(request: Request): Promise<Body> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new BadRequestError('the request body is not JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BadRequestError('the request body must be a JSON object');
  }
  return parsed as Body;
}

export function str(body: Body, field: string): string {
  const value = body[field];
  if (typeof value !== 'string') throw new BadRequestError(`\`${field}\` is required and must be a string`);
  return value;
}

export function optStr(body: Body, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new BadRequestError(`\`${field}\` must be a string if present`);
  return value;
}

export function bool(body: Body, field: string): boolean {
  const value = body[field];
  if (typeof value !== 'boolean') throw new BadRequestError(`\`${field}\` is required and must be true or false`);
  return value;
}

export function obj(body: Body, field: string): Body {
  const value = body[field];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestError(`\`${field}\` is required and must be an object`);
  }
  return value as Body;
}

export function indexList(body: Body, field: string): number[] {
  const value = body[field] ?? [];
  if (!Array.isArray(value) || value.some((n) => !Number.isInteger(n) || (n as number) < 0)) {
    throw new BadRequestError(`\`${field}\` must be a list of set indexes`);
  }
  return value as number[];
}

/** `{index, artist?, start?, end?}` per entry — the three editable fields. */
export function editList(body: Body, field: string): { index: number; artist?: string; start?: string; end?: string }[] {
  const value = body[field] ?? [];
  if (!Array.isArray(value)) throw new BadRequestError(`\`${field}\` must be a list of edits`);
  return value.map((raw) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BadRequestError(`each entry in \`${field}\` must be an object`);
    }
    const entry = raw as Body;
    const index = entry['index'];
    if (!Number.isInteger(index) || (index as number) < 0) {
      throw new BadRequestError(`each entry in \`${field}\` needs an \`index\``);
    }
    return {
      index: index as number,
      ...(optStr(entry, 'artist') !== undefined ? { artist: optStr(entry, 'artist')! } : {}),
      ...(optStr(entry, 'start') !== undefined ? { start: optStr(entry, 'start')! } : {}),
      ...(optStr(entry, 'end') !== undefined ? { end: optStr(entry, 'end')! } : {}),
    };
  });
}

/**
 * The update link, as `{editionPath, secret}` — the page reads the secret from
 * the link's fragment. Optional on upload and confirm: without it, or with one
 * that does not hold, the publisher treats the intent as a fresh upload.
 */
export function optUpdate(body: Body): { update: UpdateClaim } | Record<string, never> {
  if (body['update'] === undefined || body['update'] === null) return {};
  return { update: update(body) };
}

/** The update link, required — a self-removal has nothing else to go on. */
export function update(body: Body): UpdateClaim {
  const raw = obj(body, 'update');
  return { editionPath: str(raw, 'editionPath'), secret: str(raw, 'secret') };
}

/** `{filename, contentType, width, height, data}` with base64 bytes. */
export function parseImage(body: Body, field = 'image'): SourceImage {
  return imageFrom(obj(body, field), field);
}

/**
 * The intent's source images: an `images` list, one per day in day order, or
 * a single `image` — which the publisher reads as a list of one.
 */
export function parseImages(body: Body): { images: SourceImage[] } | { image: SourceImage } {
  const list = body['images'];
  if (list === undefined || list === null) return { image: parseImage(body) };
  if (!Array.isArray(list)) throw new BadRequestError('`images` must be a list of images');
  return {
    images: list.map((raw, i) => {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new BadRequestError(`\`images[${i}]\` must be an object`);
      }
      return imageFrom(raw as Body, `images[${i}]`);
    }),
  };
}

/**
 * The secret from the owner's bookmarked link, spread into an intent. Never
 * throws: a missing, empty or malformed one is left out — exactly as a wrong one
 * is treated as no secret by the publisher — so nothing about the response says
 * whether a secret exists or what shape it has.
 */
export function optOwner(body: Body): { owner: string } | Record<string, never> {
  const value = body['owner'];
  return typeof value === 'string' && value !== '' ? { owner: value } : {};
}

/** The review's image hashes, echoed back on confirm. Optional. */
export function optHashList(body: Body, field: string): string[] | undefined {
  return optStrList(body, field, 'image hashes');
}

/** A list of strings, optional — `what` names them in the complaint. */
export function optStrList(body: Body, field: string, what: string): string[] | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((h) => typeof h !== 'string')) {
    throw new BadRequestError(`\`${field}\` must be a list of ${what}`);
  }
  return value as string[];
}

/**
 * An image as the adapters send one — the same `{filename, contentType, width,
 * height, data}` that `parseImages()` reads — so an image a link fetched goes
 * back to confirm exactly as an uploaded one would.
 */
export function imageJson(image: SourceImage): Body {
  return {
    filename: image.filename,
    contentType: image.contentType,
    width: image.width,
    height: image.height,
    data: Buffer.from(image.bytes).toString('base64'),
  };
}

function imageFrom(raw: Body, label: string): SourceImage {
  const width = raw['width'];
  const height = raw['height'];
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new BadRequestError(`\`${label}.width\` and \`${label}.height\` are required numbers`);
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(str(raw, 'data'), 'base64'));
  } catch {
    throw new BadRequestError(`\`${label}.data\` is not base64`);
  }
  return {
    filename: str(raw, 'filename'),
    contentType: str(raw, 'contentType'),
    width: width as number,
    height: height as number,
    bytes,
  };
}

/**
 * What each gate means over HTTP. The gate name is the publisher's; the number
 * is this file's opinion about it, and nothing downstream reads it.
 */
const STATUS: Record<Gate, number> = {
  details: 400,
  images: 400,
  type: 400,
  size: 413,
  dimensions: 400,
  'address-cap': 429,
  'daily-cap': 429,
  schedule: 422,
  expired: 410,
  review: 409,
  schema: 422,
  link: 422,
  year: 422,
  stages: 422,
  removed: 410,
  'update-link': 403,
  address: 400,
  unreachable: 502,
  login: 422,
  'no-schedule': 422,
};

export function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body, null, 2) + '\n', {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export function badRequest(err: unknown): Response {
  const message = err instanceof BadRequestError ? err.message : 'the request could not be read';
  if (!(err instanceof BadRequestError)) throw err;
  return json({ ok: false, reason: message }, 400);
}

export function rejected(rejection: Rejection): Response {
  return json(
    {
      ok: false,
      gate: rejection.gate,
      reason: rejection.reason,
      ...(rejection.problems ? { problems: rejection.problems } : {}),
      ...(rejection.image !== undefined ? { image: rejection.image } : {}),
    },
    STATUS[rejection.gate],
  );
}

/** What a client asks for to get the progress lines ahead of the answer. */
export const STREAM_TYPE = 'application/x-ndjson';

/** Did the client ask for the progress stream? */
export function wantsStream(request: Request): boolean {
  return (request.headers.get('accept') ?? '').includes(STREAM_TYPE);
}

/**
 * The answer, preceded by a line for every progress report made while it was
 * worked out. `work` is handed the port to report through and returns the
 * response a client that did not ask for the stream would get; its body goes
 * out as the last line. Nothing about the work changes — only who hears it.
 */
export function streamed(work: (progress: ProgressPort) => Promise<Response>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const line = (value: unknown) => controller.enqueue(encoder.encode(JSON.stringify(value) + '\n'));
      try {
        const answer = await work({ report: (progress: Progress) => line({ progress }) });
        line(JSON.parse(await answer.text()));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': `${STREAM_TYPE}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  });
}
