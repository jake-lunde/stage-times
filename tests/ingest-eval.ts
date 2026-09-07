/**
 * Ingest eval — NOT a unit test (needs live Claude access; `npm test` ignores it).
 *
 *   npm run ingest:eval
 *
 * Runs the transcription pipeline on the three CHBP posters in
 * `_ref/set-screenshots/` and diffs the machine transcription against the
 * hand-verified `data/capitol-hill-block-party-2026.yaml` (79 sets). This is
 * the eval the handoff calls "already built": the hand transcription is the
 * ground truth, and the diff is the score.
 *
 * Output lands in `_ref/ingest-eval/` (gitignored scratch — the hand-verified
 * source files are never touched):
 *   raw/<image>.json   raw model output, verbatim (reused on re-runs, so a
 *                      second run is free — delete them to re-transcribe)
 *   capitol-hill-block-party-2026.yaml
 *   TRANSCRIPTION.md
 *   REPORT.md          the diff report printed below
 *
 * Fields compared per set: stage, artist, raw, start, end, end_inferred.
 * `notes` are prose and judged by eye via TRANSCRIPTION.md, not diffed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { loadFestival, normalizeArtist, type FestivalDoc, type SetEntry } from '../src/schema.js';
import { transcribe, type ModelOutput } from '../src/transcription.js';
import { pickBackend, transcribeImage } from '../src/vision.js';
import { REPO_ROOT } from './helpers.js';

const POSTERS = [
  'CHBP+Daily+Schedule_FRIDAY.webp',
  'CHBP+Daily+Schedule_SATURDAY.webp',
  'CHBP+Daily+Schedule_SUNDAY.webp',
];
const POSTER_DIR = join(REPO_ROOT, '_ref', 'set-screenshots');
const OUT_DIR = join(REPO_ROOT, '_ref', 'ingest-eval');
const HAND_YAML = join(REPO_ROOT, 'data', 'capitol-hill-block-party-2026.yaml');

const COMPARED_FIELDS = ['artist', 'raw', 'start', 'end', 'end_inferred'] as const;

interface FlatSet {
  stage: string;
  artist: string;
  raw: string;
  start: string;
  end: string;
  end_inferred: boolean;
}

function flatten(doc: FestivalDoc): FlatSet[] {
  return doc.sets.map((s: SetEntry) => ({
    stage: s.stage,
    artist: s.artist,
    // schema.ts does not surface `raw`, so re-read it from the YAML? No — raw
    // is not part of the validated doc. Filled in by the caller from raw YAML.
    raw: '',
    start: s.start.raw,
    end: s.end.raw,
    end_inferred: s.end_inferred,
  }));
}

/** `raw` isn't part of the validated schema — pull it straight from the YAML. */
function rawStrings(yamlText: string): string[] {
  const parsed = parseYaml(yamlText) as { sets: { raw?: string }[] };
  return parsed.sets.map((s) => s.raw ?? '');
}

/** Festival-day attribution: post-midnight sets belong to the previous day. */
function festivalDay(startIso: string): string {
  const hour = Number(startIso.slice(11, 13));
  if (hour >= 6) return startIso.slice(0, 10);
  const [y, m, d] = startIso.slice(0, 10).split('-').map(Number) as [number, number, number];
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${prev.getUTCFullYear()}-${p2(prev.getUTCMonth() + 1)}-${p2(prev.getUTCDate())}`;
}

function key(set: FlatSet): string {
  return `${set.stage}\0${normalizeArtist(set.artist)}`;
}

async function main(): Promise<void> {
  mkdirSync(join(OUT_DIR, 'raw'), { recursive: true });

  // 1. Read each poster (or replay saved model output — delete _ref/ingest-eval/raw to redo).
  const outputs: ModelOutput[] = [];
  const costs: (number | null)[] = [];
  let backendLabel = 'replayed from saved raw JSON';
  for (const poster of POSTERS) {
    const imagePath = join(POSTER_DIR, poster);
    const rawPath = join(OUT_DIR, 'raw', `${poster}.json`);
    if (existsSync(rawPath)) {
      outputs.push({ source: poster, output: readFileSync(rawPath, 'utf8') });
      costs.push(null);
      console.error(`replayed ${poster}`);
      continue;
    }
    const backend = pickBackend();
    console.error(`transcribing ${poster} via ${backend} …`);
    const started = Date.now();
    const result = await transcribeImage(imagePath, backend);
    backendLabel = `${result.backend} (${result.model})`;
    writeFileSync(rawPath, result.output.endsWith('\n') ? result.output : result.output + '\n');
    outputs.push({ source: poster, output: result.output });
    costs.push(result.costUsd);
    console.error(
      `  done in ${((Date.now() - started) / 1000).toFixed(0)}s` +
        (result.costUsd !== null ? ` · $${result.costUsd.toFixed(4)}` : ''),
    );
  }

  // 2. Transcribe. Name/slug/timezone are human-supplied knowledge, same as they
  //    were for the hand transcription — the eval scores set transcription.
  const built = transcribe(outputs, {
    namespace: 'owner',
    name: 'Capitol Hill Block Party',
    slug: 'capitol-hill-block-party',
    timezone: 'America/Los_Angeles',
    timezoneAssumed: false,
  });
  const yamlPath = join(OUT_DIR, `${built.edition.festival.slug}-${built.edition.festival.year}.yaml`);
  writeFileSync(yamlPath, built.yaml);
  writeFileSync(join(OUT_DIR, 'TRANSCRIPTION.md'), built.log);

  // 3. Diff against the hand-verified ground truth.
  const handDoc = loadFestival(HAND_YAML);
  const handFlat = flatten(handDoc);
  rawStrings(readFileSync(HAND_YAML, 'utf8')).forEach((raw, i) => (handFlat[i]!.raw = raw));
  const genFlat: FlatSet[] = built.sets.map((s) => ({
    stage: s.stage,
    artist: s.artist,
    raw: s.raw,
    start: s.start,
    end: s.end,
    end_inferred: s.end_inferred,
  }));

  const genByKey = new Map<string, FlatSet[]>();
  for (const g of genFlat) {
    (genByKey.get(key(g)) ?? genByKey.set(key(g), []).get(key(g))!).push(g);
  }

  const R: string[] = [];
  R.push('# Ingest eval — machine transcription vs hand-verified CHBP 2026');
  R.push('');
  R.push(`Backend: ${backendLabel}. Ground truth: \`data/capitol-hill-block-party-2026.yaml\` (${handFlat.length} sets).`);
  R.push('');

  let exact = 0;
  const mismatches: string[] = [];
  const missing: string[] = [];
  const matchedGen = new Set<FlatSet>();
  const perDay = new Map<string, { exact: number; total: number }>();

  for (const hand of handFlat) {
    const day = festivalDay(hand.start);
    const dayStats = perDay.get(day) ?? { exact: 0, total: 0 };
    dayStats.total += 1;
    perDay.set(day, dayStats);

    let candidate = (genByKey.get(key(hand)) ?? []).find((g) => !matchedGen.has(g));
    if (!candidate) {
      // Artist misread? Fall back to matching by stage + start time.
      candidate = genFlat.find((g) => !matchedGen.has(g) && g.stage === hand.stage && g.start === hand.start);
    }
    if (!candidate) {
      missing.push(`- MISSING: ${hand.stage} · ${hand.artist} · ${hand.start}`);
      continue;
    }
    matchedGen.add(candidate);
    const diffs = COMPARED_FIELDS.filter((f) => candidate![f] !== hand[f]);
    if (diffs.length === 0) {
      exact += 1;
      dayStats.exact += 1;
    } else {
      mismatches.push(
        `- ${hand.stage} · ${hand.artist} · ${hand.start}:` +
          diffs.map((f) => `\n    ${f}: hand=${JSON.stringify(hand[f])} gen=${JSON.stringify(candidate![f])}`).join(''),
      );
    }
  }
  const extras = genFlat.filter((g) => !matchedGen.has(g));

  R.push('## Score');
  R.push('');
  R.push(`- Exact matches (stage+artist+raw+start+end+end_inferred): **${exact} / ${handFlat.length}**`);
  R.push(`- Field mismatches: ${mismatches.length} · missing: ${missing.length} · extra: ${extras.length}`);
  R.push(`- Generated set count: ${genFlat.length}`);
  R.push('');
  R.push('Per festival day (post-midnight sets attributed to the poster day):');
  R.push('');
  for (const [day, stats] of [...perDay.entries()].sort()) {
    R.push(`- ${day}: ${stats.exact} / ${stats.total} exact`);
  }
  if (mismatches.length > 0) {
    R.push('');
    R.push('## Mismatches');
    R.push('');
    R.push(...mismatches);
  }
  if (missing.length > 0) {
    R.push('');
    R.push('## Missing from the machine transcription');
    R.push('');
    R.push(...missing);
  }
  if (extras.length > 0) {
    R.push('');
    R.push('## Extra sets not in the hand transcription');
    R.push('');
    R.push(...extras.map((g) => `- EXTRA: ${g.stage} · ${g.artist} · ${g.start}`));
  }

  // 4. Ambiguity-log quality signals.
  const genInferred = built.sets.filter((s) => s.end_inferred).length;
  const handInferred = handFlat.filter((s) => s.end_inferred).length;
  R.push('');
  R.push('## Ambiguity-log signals');
  R.push('');
  R.push(`- Inferred (CLOSE) ends: hand ${handInferred}, machine ${genInferred}.`);
  R.push(`- Model observations recorded: ${built.observations.length} (see TRANSCRIPTION.md §Transcriber observations).`);
  const knownCosts = costs.filter((c): c is number => c !== null);
  if (knownCosts.length > 0) {
    R.push(
      `- Cost: ${knownCosts.map((c) => `$${c.toFixed(4)}`).join(' + ')}` +
        (knownCosts.length === POSTERS.length
          ? ` = $${knownCosts.reduce((a, b) => a + b, 0).toFixed(4)} for all three posters`
          : ' (remaining posters replayed from cache)'),
    );
  }
  R.push('');

  const report = R.join('\n');
  writeFileSync(join(OUT_DIR, 'REPORT.md'), report);
  console.log(report);
  console.error(`\nwrote ${yamlPath}`);
  console.error(`wrote ${join(OUT_DIR, 'TRANSCRIPTION.md')}`);
  console.error(`wrote ${join(OUT_DIR, 'REPORT.md')}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
