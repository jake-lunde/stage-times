/**
 * Stage Times — ingest CLI (Phase 1 of the self-serve pipeline).
 *
 *   npm run ingest -- <image> [<image> ...] [flags]
 *
 * Takes one poster image per festival day, transcribes each with Claude vision
 * (src/vision.ts), then deterministically builds (src/transcribe.ts):
 *
 *   <out>/<slug>-<year>.yaml     — festival YAML in the repo's canonical format,
 *                                  validated by src/schema.ts, verified: false
 *   <out>/TRANSCRIPTION.md       — ambiguity log for the human reviewer
 *   <out>/raw/<image>.json       — the raw model transcription (audit + replay)
 *
 * Flags:
 *   --out <dir>        output directory (default: ingest-out/). NEVER data/ —
 *                      hand-verified festivals live there.
 *   --name <name>      festival display name (default: title-cased poster name)
 *   --slug <slug>      URL slug (default: slugified name). PERMANENT once published.
 *   --timezone <tz>    IANA timezone (default: America/Los_Angeles, flagged as
 *                      ASSUMED in the output — the poster cannot tell us this)
 *   --backend <b>      sdk | cli | auto (default: auto — sdk when an API key is
 *                      in the environment, else the local `claude` CLI login)
 *   --raw <file.json>  reuse a saved raw transcription instead of calling the
 *                      model (repeatable; deterministic, costs nothing)
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { buildIngest, assertRawTranscription, type RawTranscription } from './transcribe.js';
import { pickBackend, transcribeImage, type Backend, type VisionResult } from './vision.js';

interface Args {
  images: string[];
  raws: string[];
  out: string;
  name?: string;
  slug?: string;
  officialUrl?: string;
  timezone: string;
  timezoneAssumed: boolean;
  backend: Backend | 'auto';
}

const DEFAULT_TZ = 'America/Los_Angeles';

function usage(): never {
  console.error('usage: npm run ingest -- <image> [...] [--out dir] [--name n] [--slug s] [--official-url u] [--timezone tz] [--backend sdk|cli|auto] [--raw file.json]');
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { images: [], raws: [], out: 'ingest-out', timezone: DEFAULT_TZ, timezoneAssumed: true, backend: 'auto' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) usage();
      i += 1;
      return v;
    };
    switch (a) {
      case '--out': args.out = next(); break;
      case '--name': args.name = next(); break;
      case '--slug': args.slug = next(); break;
      case '--official-url': args.officialUrl = next(); break;
      case '--timezone': args.timezone = next(); args.timezoneAssumed = false; break;
      case '--raw': args.raws.push(next()); break;
      case '--backend': {
        const b = next();
        if (b !== 'sdk' && b !== 'cli' && b !== 'auto') usage();
        args.backend = b;
        break;
      }
      default:
        if (a.startsWith('--')) usage();
        args.images.push(a);
    }
  }
  if (args.images.length === 0 && args.raws.length === 0) usage();
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.out);
  const dataDir = resolve('data');
  if (outDir === dataDir || outDir.startsWith(dataDir + '/')) {
    // data/ holds hand-verified festivals; machine output must never land there.
    console.error(`refusing to write into data/ — pick a scratch directory (got ${args.out})`);
    process.exit(2);
  }

  const transcriptions: RawTranscription[] = [];
  const sources: string[] = [];
  const results: VisionResult[] = [];

  // Replayed raw transcriptions first (deterministic, free).
  for (const rawPath of args.raws) {
    const parsed = assertRawTranscription(JSON.parse(readFileSync(rawPath, 'utf8')), basename(rawPath));
    transcriptions.push(parsed);
    sources.push(basename(rawPath));
    console.error(`replayed ${basename(rawPath)} (${parsed.days.length} day${parsed.days.length === 1 ? '' : 's'})`);
  }

  if (args.images.length > 0) {
    const backend: Backend = args.backend === 'auto' ? pickBackend() : args.backend;
    console.error(`vision backend: ${backend}`);
    mkdirSync(join(outDir, 'raw'), { recursive: true });
    for (const image of args.images) {
      console.error(`transcribing ${basename(image)} …`);
      const started = Date.now();
      const result = await transcribeImage(image, backend);
      results.push(result);
      transcriptions.push(result.transcription);
      sources.push(basename(image));
      const rawOut = join(outDir, 'raw', `${basename(image)}.json`);
      writeFileSync(rawOut, JSON.stringify(result.transcription, null, 2) + '\n');
      const secs = ((Date.now() - started) / 1000).toFixed(0);
      const cost = result.costUsd === null ? 'cost n/a' : `$${result.costUsd.toFixed(4)}`;
      console.error(`  ${result.model} · ${secs}s · ${cost} · raw saved to ${rawOut}`);
    }
  }

  const built = buildIngest(transcriptions, {
    name: args.name,
    slug: args.slug,
    officialUrl: args.officialUrl,
    timezone: args.timezone,
    timezoneAssumed: args.timezoneAssumed,
    sources,
  });

  mkdirSync(outDir, { recursive: true });
  const yamlPath = join(outDir, `${built.festival.slug}-${built.festival.year}.yaml`);
  const logPath = join(outDir, 'TRANSCRIPTION.md');
  writeFileSync(yamlPath, built.yaml);
  writeFileSync(logPath, built.log);

  // Summary.
  const perStage = new Map<string, number>();
  for (const set of built.sets) perStage.set(set.stage, (perStage.get(set.stage) ?? 0) + 1);
  console.error('');
  console.error(`${built.festival.name} ${built.festival.year} — ${built.sets.length} sets across ${built.stages.length} stages:`);
  for (const [stage, count] of perStage) console.error(`  ${stage}: ${count}`);
  const inferred = built.sets.filter((s) => s.end_inferred).length;
  if (inferred > 0) console.error(`  (${inferred} end time${inferred === 1 ? '' : 's'} inferred from CLOSE — see the log)`);
  const totalCost = results.reduce<number | null>(
    (acc, r) => (acc === null || r.costUsd === null ? null : acc + r.costUsd),
    0,
  );
  if (results.length > 0 && totalCost !== null) console.error(`  total transcription cost: $${totalCost.toFixed(4)}`);
  console.error('');
  console.error(`wrote ${yamlPath}`);
  console.error(`wrote ${logPath}`);
  console.error('');
  console.error('NOT verified. Review every set against the source image, then set verified: true.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
