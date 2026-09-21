/**
 * The look-ahead's scheduled entrypoint — `npm run look-ahead`, on the 1st of
 * each month from `.github/workflows/look-ahead.yml`.
 *
 * Read the almanac and the watch list, call the look-ahead, print what it
 * sent. Every rule is in `src/look-ahead.ts`; nothing here decides anything.
 *
 *   npm run look-ahead                        open this month's issue
 *   npm run look-ahead -- --dry-run           print the issue instead
 *   npm run look-ahead -- --dry-run --on 2026-10-01   …as that day's run would write it
 */

import { readFileSync } from 'node:fs';
import { loadAlmanac, lookAhead } from './look-ahead.js';
import { githubNotifier, systemClock } from './ports.js';
import type { ClockPort, Notification, NotifyPort } from './publisher.js';
import { WATCH_LIST_PATH, loadWatchList } from './watcher.js';

export const ALMANAC_PATH = 'config/festivals.yaml';

function clockFrom(argv: string[]): ClockPort {
  const i = argv.indexOf('--on');
  if (i < 0) return systemClock();
  const day = argv[i + 1] ?? '';
  const at = Date.parse(`${day}T15:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(at)) throw new Error(`--on takes a day, YYYY-MM-DD, not ${JSON.stringify(day)}`);
  return { now: () => at };
}

function printer(): NotifyPort {
  return {
    async send(n: Notification) {
      console.log(`# ${n.title}\n\n${n.body}`);
    },
  };
}

async function main(argv: string[]): Promise<void> {
  const almanac = loadAlmanac(readFileSync(ALMANAC_PATH, 'utf8'));
  const list = loadWatchList(readFileSync(WATCH_LIST_PATH, 'utf8'));
  const dryRun = argv.includes('--dry-run');
  const result = await lookAhead({ kind: 'look-ahead', almanac, list }, { notify: dryRun ? printer() : githubNotifier(), clock: clockFrom(argv) });
  if (!dryRun) {
    console.log(`notice: ${result.notification.title}`);
    for (const r of result.rows) console.log(`${r.key.padEnd(28)} ${r.watched ? 'watched' : 'not watched'}`);
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
