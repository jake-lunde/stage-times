/**
 * POST /api/confirm — the owner's secret, the reviewed images and the
 * corrections made on review, in; the edition, published and listed, out.
 *
 * Read the fields, call the publisher, return what it said — and, when the
 * page asks for it, stream what the publisher reports on the way (ticket 21).
 * `days`, when the page sends it, is the days as checked, one per day read
 * (ticket 20).
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
  optStrList,
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
      timezone: str(body, 'timezone'),
      timezoneAssumed: bool(body, 'timezoneAssumed'),
      ...(optStr(body, 'officialUrl') !== undefined ? { officialUrl: optStr(body, 'officialUrl')! } : {}),
      edits: editList(body, 'edits'),
      unverifiable: indexList(body, 'unverifiable'),
      ...(optStrList(body, 'days', 'days') !== undefined ? { days: optStrList(body, 'days', 'days')! } : {}),
      ...parseImages(body),
      ...(optHashList(body, 'reviewed') !== undefined ? { reviewed: optHashList(body, 'reviewed')! } : {}),
      ...optOwner(body),
    };
  } catch (err) {
    return badRequest(err);
  }

  const answer = async (ports: PublisherPorts): Promise<Response> => {
    const result = await confirm(intent, ports);
    return result.ok
      ? json({ ok: true, editionPath: result.editionPath }, 200)
      : rejected(result.rejection!);
  };
  return wantsStream(request) ? streamed((progress) => answer({ ...ports, progress })) : answer(ports);
}

export function POST(request: Request): Promise<Response> {
  return handle(request, livePorts());
}
