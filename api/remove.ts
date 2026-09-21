/**
 * POST /api/remove — the update link in; the edition taken down, out.
 *
 * Read the link, call the publisher, return what it said. Whether the secret
 * holds, what the block writes and what it keeps are all in `src/publisher.ts`.
 */

import { remove, type PublisherPorts, type RemoveIntent } from '../src/publisher.js';
import { badRequest, json, readJsonBody, rejected, update } from '../src/publisher-http.js';
import { livePorts } from '../src/ports.js';

export async function handle(request: Request, ports: PublisherPorts): Promise<Response> {
  let intent: RemoveIntent;
  try {
    const body = await readJsonBody(request);
    intent = { kind: 'remove', update: update(body) };
  } catch (err) {
    return badRequest(err);
  }

  const result = await remove(intent, ports);
  return result.ok ? json({ ok: true, editionPath: result.editionPath }, 200) : rejected(result.rejection!);
}

export function POST(request: Request): Promise<Response> {
  return handle(request, livePorts());
}
