/**
 * POST /api/confirm — the reviewed images, the uploader's corrections, and
 * which sets they could not verify, in; the edition, published, out.
 *
 * Read the fields, call the publisher, return what it said — and, when the
 * page asks for it, stream what the publisher reports on the way (ticket 21). The update-link
 * secret comes back in this response and in no other, ever: committed state
 * keeps only its hash. With a valid `update` link the confirm is a correction
 * of that edition, and `corrected` says so.
 */

import { confirm, type ConfirmIntent, type PublisherPorts } from '../src/publisher.js';
import {
  badRequest,
  bool,
  editList,
  indexList,
  json,
  optHashList,
  optOwner,
  optStr,
  optUpdate,
  parseImages,
  readJsonBody,
  rejected,
  str,
  streamed,
  wantsStream,
} from '../src/publisher-http.js';
import { livePorts } from '../src/ports.js';

export async function handle(request: Request, ports: PublisherPorts): Promise<Response> {
  let intent: ConfirmIntent;
  try {
    const body = await readJsonBody(request);
    intent = {
      kind: 'confirm',
      festival: str(body, 'festival'),
      email: str(body, 'email'),
      timezone: str(body, 'timezone'),
      timezoneAssumed: bool(body, 'timezoneAssumed'),
      ...(optStr(body, 'officialUrl') !== undefined ? { officialUrl: optStr(body, 'officialUrl')! } : {}),
      edits: editList(body, 'edits'),
      unverifiable: indexList(body, 'unverifiable'),
      ...parseImages(body),
      ...(optHashList(body, 'reviewed') !== undefined ? { reviewed: optHashList(body, 'reviewed')! } : {}),
      ...optUpdate(body),
      ...optOwner(body),
    };
  } catch (err) {
    return badRequest(err);
  }

  const answer = async (ports: PublisherPorts): Promise<Response> => {
    const result = await confirm(intent, ports);
    return result.ok
      ? json({ ok: true, editionPath: result.editionPath, updateSecret: result.updateSecret, corrected: result.corrected }, 200)
      : rejected(result.rejection!);
  };
  return wantsStream(request) ? streamed((progress) => answer({ ...ports, progress })) : answer(ports);
}

export function POST(request: Request): Promise<Response> {
  return handle(request, livePorts());
}
