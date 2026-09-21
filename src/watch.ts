/**
 * The watcher's and the signal's scheduled entrypoint — `npm run watch`,
 * hourly from `.github/workflows/watch.yml`.
 *
 * Read the watch list, call the watcher, then the signal, print what they
 * said. Every rule — the cadence, what counts as a drop, a change or a
 * signal, what a review carries — is in `src/watcher.ts` and `src/signal.ts`;
 * the outside world is `src/ports.ts`. Nothing here decides anything. The
 * signal runs even when the watcher fails, so one broken page never silences
 * the other.
 *
 *   npm run watch               poll every entry that is due on this run
 *   npm run watch -- --force    poll every entry that is not dormant
 *   npm run watch -- --due      say what would be polled now, and stop
 */

import { readFileSync } from 'node:fs';
import { signalPorts, systemClock, watcherPorts } from './ports.js';
import { signal, type SignalReport } from './signal.js';
import { cadenceOf, isDue, keyOf, loadWatchList, watch, type WatchReport } from './watcher.js';

export const WATCH_LIST_PATH = 'config/watch.yaml';

function line(r: WatchReport): string {
  const tail =
    r.pullRequest ? `→ ${r.pullRequest.branch}: ${r.pullRequest.title}` : r.problem ? `— ${r.problem}` : r.images.length ? `(${r.images.length} schedule image${r.images.length === 1 ? '' : 's'})` : '';
  return `${r.key.padEnd(28)} ${r.cadence.padEnd(8)} ${r.outcome.padEnd(12)} ${tail}`.trimEnd();
}

function signalLine(r: SignalReport): string {
  const where = r.subreddit ? `r/${r.subreddit}` : '';
  const tail = r.problem ? `— ${r.problem}` : r.posts.map((p) => `→ ${p}`).join(' ');
  return `${r.key.padEnd(28)} ${where.padEnd(22)} ${r.outcome.padEnd(12)} ${tail}`.trimEnd();
}

function report(what: string, err: unknown): void {
  console.error(`${what} failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
}

async function main(argv: string[]): Promise<number> {
  const list = loadWatchList(readFileSync(WATCH_LIST_PATH, 'utf8'));
  const force = argv.includes('--force');

  if (argv.includes('--due')) {
    const now = systemClock().now();
    for (const entry of list) {
      const key = keyOf(entry);
      const cadence = cadenceOf(entry, now);
      const signalled = entry.subreddit && cadence === 'hourly' ? ` · signal r/${entry.subreddit}` : '';
      console.log(`${key.padEnd(28)} ${cadence.padEnd(8)} ${isDue(entry, now) ? 'due now' : cadence === 'dormant' ? 'over' : 'not on this run'}${signalled}`);
    }
    return 0;
  }

  let failed = 0;
  try {
    const result = await watch({ kind: 'watch', list, ...(force ? { force } : {}) }, watcherPorts());
    for (const r of result.reports) console.log(line(r));
    if (result.commit) console.log(`\n${result.commit.message}`);
    for (const n of result.notifications) console.log(`\nnotice: ${n.title}`);
  } catch (err) {
    report('The watcher', err);
    failed += 1;
  }

  try {
    const result = await signal({ kind: 'signal', list, ...(force ? { force } : {}) }, signalPorts());
    console.log('');
    for (const r of result.reports) console.log(signalLine(r));
    if (result.commit) console.log(`\n${result.commit.message}`);
  } catch (err) {
    report('The signal', err);
    failed += 1;
  }
  return failed > 0 ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  },
);
