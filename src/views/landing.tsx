/**
 * Stage Times — the landing page, rendered with React at build time.
 *
 * The first page on React as the template language (step 1 of the move; the
 * subscribe, removed and upload pages are still template strings in pages.ts
 * and upload-pages.ts). React renders to static HTML here and nothing else:
 * no hydration, no bundle, the same one inline script as before
 * (`LANDING_SCRIPT`). The page's weight doesn't change.
 *
 * The directory card is the Subframe Festival Card (src/ui/, synced by the
 * Subframe CLI), so its look is owned in Subframe. What stays here is what the
 * card can't know: the link around it, the shelf's sizing, and the art itself
 * (the committed image on the stage color's light ground). That layout lives in
 * pages.ts's CSS under "landing shelf".
 *
 * Deterministic: renderToStaticMarkup is a pure function of its props.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { FestivalCard } from '@/ui/components/FestivalCard';
import { HOUSE_COLORS } from '../colors.js';
import {
  artGround,
  count,
  editionDates,
  LANDING_SCRIPT,
  page,
  shelvedEditions,
  stageCount,
  type LandingOptions,
  type Manifest,
  type SiteManifest,
} from '../pages.js';
import { tailwindFor } from '../tailwind.js';

/**
 * One directory card, text first: eyebrow, the festival name, one bold lead
 * with the counts, the quiet line, then art edge to edge to the bottom of the
 * fixed-height card. The whole card is the link; nothing inside it is a button.
 *
 * The eyebrow is the dates and city. Every edition is the owner's (ADR-0005),
 * so no card carries a mark saying whose it is. The quiet line is the first
 * stage's billed headliners — the main stage by convention — as the data has
 * them.
 */
function DirectoryCard({ m, image }: { m: Manifest; image: string }) {
  const f = m.festival;
  const headliners = m.stages[0]?.headliners.join(' · ') ?? '';
  // Behind the image while it loads: the light ground of the edition's first stage color.
  const color = m.stages[0]?.color ?? HOUSE_COLORS[0]!;
  // The first and last festival day, for the page to shelve the card by (`LANDING_SCRIPT`).
  const { first, last } = m.all.dayspan;
  return (
    <li data-first={first} data-last={last}>
      <a className="shelf-link" href={`${f.basePath}/`}>
        <FestivalCard
          className="shelf-card"
          eyebrow={editionDates(m) + (f.city ? ` · ${f.city}` : '')}
          title={f.name}
          lead={`${count(m.allSetCount, 'set')} across ${count(stageCount(m), 'stage')}.`}
          meta={headliners || undefined}
          art={
            <span className="shelf-art" style={{ background: artGround(color) }}>
              <img src={image} alt="" loading="lazy" />
            </span>
          }
        />
      </a>
    </li>
  );
}

function Landing({ shelved, images }: { shelved: Manifest[]; images: Record<string, string> }) {
  return (
    <>
      <header className="hero">
        <div className="wrap wrap--wide">
          <h1>
            Stage
            <br />
            Times
          </h1>
          <p>Set times, by stage.</p>
        </div>
      </header>

      <main className="wrap wrap--wide">
        {shelved.length > 0 && (
          <>
            <section className="shelf-section" data-shelf="coming">
              <h2 className="shelf-head">
                <span className="lead">Add festival stages directly to your calendar.</span>{' '}
                <span className="tail">That's it.</span>
              </h2>
              <ul className="shelf">
                {shelved.map((m) => (
                  <DirectoryCard key={m.festival.basePath} m={m} image={images[m.festival.key]!} />
                ))}
              </ul>
            </section>

            <section className="shelf-section" data-shelf="past" hidden>
              <h2 className="shelf-head">
                <span className="lead">Already happened.</span> <span className="tail">The times are still here.</span>
              </h2>
              <ul className="shelf"></ul>
            </section>
          </>
        )}

        <section className="prose">
          <p className="eyebrow">What this is</p>
          <p>
            Add one calendar per stage. The sets show up in the calendar app you already use, and you can color or
            hide each stage on its own.
          </p>
        </section>

        <footer>
          <p>Times come from each festival's official schedule. Each festival page says when it was last checked.</p>
          <p>Unofficial. Not affiliated with any festival.</p>
          <p>
            Wrong time? <a href="https://github.com/jake-lunde/stage-times/issues">Tell me ↗</a>
          </p>
        </footer>
      </main>
    </>
  );
}

export function renderLandingPage(site: SiteManifest, opts: LandingOptions = {}): string {
  const images = opts.images ?? {};
  const pinned = new Set(opts.pinned ?? []);
  const isPinned = (m: Manifest) => pinned.has(m.festival.basePath.slice(1));
  // Pinned first, the rest after; each group keeps the date order. Once a
  // pinned edition is over, the page moves it to the happened shelf like any other.
  const byDate = shelvedEditions(site, images);
  const shelved = [...byDate.filter(isPinned), ...byDate.filter((m) => !isPinned(m))];

  const body = renderToStaticMarkup(<Landing shelved={shelved} images={images} />) + (shelved.length === 0 ? '' : `\n${LANDING_SCRIPT}`);

  return page(
    'Stage Times — set times, by stage',
    'Set times for each festival stage, as a calendar you can add to your phone.',
    body,
    tailwindFor(body),
  );
}
