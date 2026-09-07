/**
 * Stage Times — ingest CLI. A thin wrapper over the transcription library.
 *
 *   npm run ingest -- <image> [<image> ...] [flags]
 *
 * Takes one source image per festival day, asks the vision model for its
 * reading (src/vision.ts), then hands the model output to `transcribe()`
 * (src/transcription.ts), which deterministically produces:
 *
 *   <out>/<slug>-<year>.yaml     — the edition YAML in the repo's canonical
 *                                  format, validated by src/schema.ts, verified: false
 *   <out>/TRANSCRIPTION.md       — the ambiguity log for the human reviewer
 *   <out>/raw/<image>.json       — the model's reply, verbatim (audit + replay)
 *
 * All the file reading and writing happens here; the library does none.
 *
 * Flags:
 *   --out <dir>          output directory (default: ingest-out/). NEVER data/ —
 *                        hand-verified editions live there.
 *   --name <name>        festival display name (default: title-cased poster name)
 *   --slug <slug>        URL slug (default: slugified name). PERMANENT once published.
 *   --official-url <u>   official URL (default: the URL printed on the poster)
 *   --timezone <tz>      IANA timezone (default: America/Los_Angeles, flagged as
 *                        ASSUMED in the output — the poster cannot tell us this)
 *   --backend <b>        sdk | cli | auto (default: auto — sdk when an API key is
 *                        in the environment, else the local `claude` CLI login)
 *   --raw <file.json>    replay saved model output instead of calling the model
 *                        (repeatable; deterministic, costs nothing)
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { transcribe, type ModelOutput } from './transcription.js';
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
    // data/ holds hand-verified editions; machine output must never land there.
    console.error(`refusing to write into data/ — pick a scratch directory (got ${args.out})`);
    process.exit(2);
  }

  const outputs: ModelOutput[] = [];
  const results: VisionResult[] = [];

  // Replayed model output first (deterministic, free).
  for (const rawPath of args.raws) {
    outputs.push({ source: basename(rawPath), output: readFileSync(rawPath, 'utf8') });
    console.error(`replayed ${basename(rawPath)}`);
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
      outputs.push({ source: result.source, output: result.output });
      // Saved before it is read, so a reply the library rejects is still on
      // disk for the audit trail.
      const rawOut = join(outDir, 'raw', `${result.source}.json`);
      writeFileSync(rawOut, result.output.endsWith('\n') ? result.output : result.output + '\n');
      const secs = ((Date.now() - started) / 1000).toFixed(0);
      const cost = result.costUsd === null ? 'cost n/a' : `$${result.costUsd.toFixed(4)}`;
      console.error(`  ${result.model} · ${secs}s · ${cost} · raw saved to ${rawOut}`);
    }
  }

  const transcription = transcribe(outputs, {
    name: args.name,
    slug: args.slug,
    officialUrl: args.officialUrl,
    timezone: args.timezone,
    timezoneAssumed: args.timezoneAssumed,
  });

  const { festival, stages } = transcription.edition;
  mkdirSync(outDir, { recursive: true });
  const yamlPath = join(outDir, `${festival.slug}-${festival.year}.yaml`);
  const logPath = join(outDir, 'TRANSCRIPTION.md');
  writeFileSync(yamlPath, transcription.yaml);
  writeFileSync(logPath, transcription.log);

  // Summary.
  const perStage = new Map<string, number>();
  for (const set of transcription.sets) perStage.set(set.stage, (perStage.get(set.stage) ?? 0) + 1);
  console.error('');
  console.error(`${festival.name} ${festival.year} — ${transcription.sets.length} sets across ${stages.length} stages:`);
  for (const [stage, count] of perStage) console.error(`  ${stage}: ${count}`);
  const inferred = transcription.sets.filter((s) => s.end_inferred).length;
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
