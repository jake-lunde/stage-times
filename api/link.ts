/**
 * POST /api/link — the owner's secret and the festival's schedule page in; the
 * review to check, the days and the link as read, and the images it was read
 * off, out. Confirm takes those images back as `images`, exactly as it takes
 * an upload's.
 *
 * Read the fields, call the publisher, return what it said — and, when the
 * page asks for it, stream what the publisher reports on the way (tickets 20
 * and 21): the page being opened, the images found, then each one checked and
 * read, exactly as an upload reports. Every rule — the owner's secret, which
 * addresses may be asked for, which images count, the cache, the review — is in
 * `src/publisher.ts`, and every reason string it hands back goes out untouched.
 */

import { link, type LinkIntent, type LinkPorts } from '../src/publisher.js';
import { badRequest, imageJson, json, optOwner, readJsonBody, rejected, str, streamed, wantsStream } from '../src/publisher-http.js';
import { linkPorts } from '../src/ports.js';

export async function handle(request: Request, ports: LinkPorts): Promise<Response> {
  let intent: LinkIntent;
  try {
    const body = await readJsonBody(request);
    intent = {
      kind: 'link',
      url: str(body, 'url'),
      ...optOwner(body),
    };
  } catch (err) {
    return badRequest(err);
  }

  const answer = async (ports: LinkPorts): Promise<Response> => {
    const result = await link(intent, ports);
    return result.ok
      ? json({ ok: true, review: result.review, officialUrl: result.officialUrl, days: result.days, images: result.images.map(imageJson) }, 200)
      : rejected(result.rejection!);
  };
  return wantsStream(request) ? streamed((progress) => answer({ ...ports, progress })) : answer(ports);
}

export function POST(request: Request): Promise<Response> {
  return handle(request, linkPorts());
}
