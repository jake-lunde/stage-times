/**
 * POST /api/upload — the owner's secret, the images (one per day) and what was typed, in; the
 * review to check it against, out.
 *
 * Read the fields, call the publisher, return what it said — and, when the
 * page asks for it, stream what the publisher reports on the way (ticket 21). Every rule — the
 * owner's secret, the gates, the cache, the review payload — is in `src/publisher.ts`,
 * and every reason string it hands back goes out untouched.
 */

import { upload, type PublisherPorts, type UploadIntent } from '../src/publisher.js';
import { badRequest, json, obj, optOwner, optStr, parseImages, readJsonBody, rejected, str, streamed, wantsStream } from '../src/publisher-http.js';
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
      ...(optStr(body, 'timezone') !== undefined ? { timezone: optStr(body, 'timezone')! } : {}),
      ...(optStr(body, 'officialUrl') !== undefined ? { officialUrl: optStr(body, 'officialUrl')! } : {}),
      ...parseImages(body),
      ...optOwner(body),
    };
  } catch (err) {
    return badRequest(err);
  }

  const answer = async (ports: PublisherPorts): Promise<Response> => {
    const result = await upload(intent, ports);
    return result.ok ? json({ ok: true, review: result.review }, 200) : rejected(result.rejection!);
  };
  return wantsStream(request) ? streamed((progress) => answer({ ...ports, progress })) : answer(ports);
}

export function POST(request: Request): Promise<Response> {
  return handle(request, livePorts());
}
