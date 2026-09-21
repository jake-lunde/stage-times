/**
 * The watcher's scheduled entrypoint — `npm run watch`, hourly from
 * `.github/workflows/watch.yml`.
 *
 * Read the watch list, call the watcher, print what it said. Every rule — the
 * cadence, what counts as a drop or a change, what a review carries — is in
 * `src/watcher.ts`; the outside world is `src/ports.ts`. Nothing here decides
 * anything.
 *
 *   npm run watch               poll every entry that is due on this run
 *   npm run watch -- --force    poll every entry that is not dormant
 *   npm run watch -- --due      say what would be polled now, and stop
 */

import { readFileSync } from 'node:fs';
import { watcherPorts } from './ports.js';
import { cadenceOf, isDue, loadWatchList, watch, type WatchReport } from './watcher.js';

export const WATCH_LIST_PATH = 'config/watch.yaml';

function line(r: WatchReport): string {
  const tail =
    r.pullRequest ? `→ ${r.pullRequest.branch}: ${r.pullRequest.title}` : r.problem ? `— ${r.problem}` : r.images.length ? `(${r.images.length} schedule image${r.images.length === 1 ? '' : 's'})` : '';
  return `${r.key.padEnd(28)} ${r.cadence.padEnd(8)} ${r.outcome.padEnd(12)} ${tail}`.trimEnd();
}

async function main(argv: string[]): Promise<void> {
  const list = loadWatchList(readFileSync(WATCH_LIST_PATH, 'utf8'));
  const force = argv.includes('--force');

  if (argv.includes('--due')) {
    const now = Date.now();
    for (const entry of list) {
      const key = `${entry.slug}-${entry.year}`;
      const cadence = cadenceOf(entry, now);
      console.log(`${key.padEnd(28)} ${cadence.padEnd(8)} ${isDue(entry, now) ? 'due now' : cadence === 'dormant' ? 'over' : 'not on this run'}`);
    }
    return;
  }

  const result = await watch({ kind: 'watch', list, ...(force ? { force } : {}) }, watcherPorts());
  for (const r of result.reports) console.log(line(r));
  if (result.commit) console.log(`\n${result.commit.message}`);
  for (const n of result.notifications) console.log(`\nnotice: ${n.title}`);
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
