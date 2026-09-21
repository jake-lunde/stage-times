/**
 * POST /api/upload — the images (one per day) and what the uploader typed, in; the review to
 * check it against, out.
 *
 * Read the fields, call the publisher, return what it said. Every rule — the
 * gates, the caps, the cache, the review payload — is in `src/publisher.ts`,
 * and every reason string it hands back goes out untouched.
 */

import { upload, type PublisherPorts, type UploadIntent } from '../src/publisher.js';
import { badRequest, json, obj, optStr, optUpdate, parseImages, readJsonBody, rejected, str } from '../src/publisher-http.js';
import { livePorts } from '../src/ports.js';

export async function handle(request: Request, ports: PublisherPorts): Promise<Response> {
  let intent: UploadIntent;
  try {
    const body = await readJsonBody(request);
    const dates = obj(body, 'dates');
    intent = {
      kind: 'upload',
      festival: str(body, 'festival'),
      dates: { first: str(dates, 'first'), last: str(dates, 'last') },
      email: str(body, 'email'),
      ...(optStr(body, 'timezone') !== undefined ? { timezone: optStr(body, 'timezone')! } : {}),
      ...(optStr(body, 'officialUrl') !== undefined ? { officialUrl: optStr(body, 'officialUrl')! } : {}),
      ...parseImages(body),
      ...optUpdate(body),
    };
  } catch (err) {
    return badRequest(err);
  }

  const result = await upload(intent, ports);
  return result.ok ? json({ ok: true, review: result.review }, 200) : rejected(result.rejection!);
}

export function POST(request: Request): Promise<Response> {
  return handle(request, livePorts());
}
