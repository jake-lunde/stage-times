/**
 * POST /api/link — the festival's schedule page and a contact address in; the
 * review to check, the days and the link as read, and the images it was read
 * off, out. Confirm takes those images back as `images`, exactly as it takes
 * an upload's.
 *
 * Read the fields, call the publisher, return what it said. Every rule — which
 * addresses may be asked for, the caps, which images count, the cache, the
 * review — is in `src/publisher.ts`, and every reason string it hands back
 * goes out untouched.
 */

import { link, type LinkIntent, type LinkPorts } from '../src/publisher.js';
import { badRequest, imageJson, json, optOwner, readJsonBody, rejected, str } from '../src/publisher-http.js';
import { linkPorts } from '../src/ports.js';

export async function handle(request: Request, ports: LinkPorts): Promise<Response> {
  let intent: LinkIntent;
  try {
    const body = await readJsonBody(request);
    intent = {
      kind: 'link',
      url: str(body, 'url'),
      email: str(body, 'email'),
      ...optOwner(body),
    };
  } catch (err) {
    return badRequest(err);
  }

  const result = await link(intent, ports);
  return result.ok
    ? json({ ok: true, review: result.review, officialUrl: result.officialUrl, days: result.days, images: result.images.map(imageJson) }, 200)
    : rejected(result.rejection!);
}

export function POST(request: Request): Promise<Response> {
  return handle(request, linkPorts());
}
