/**
 * Stage colors (the design skill's references/color.md). Each stage has one
 * color, on its card and on its calendar: the festival's own, sampled off its
 * art (`festival.colors:` in the edition YAML), or the house colors when the
 * edition names none. Colors are assigned by position among the stages of one
 * weekend, so a stage that plays both weekends is one color.
 *
 * Integer math and fixed tables only: the same YAML gives the same bytes.
 */

export const CREAM = '#FCF9F4';
export const INK = '#12181F';

/** The floor for text on a stage color: card text runs 13–17px, which is not WCAG "large text". */
export const MIN_CONTRAST = 4.5;

// The house colors, for an edition that names none of its own.
//
// Note the first is `--red-deep` (#C42408, 5.5:1 with cream) rather than the
// hero's `--red` (#EC300C, 4.0:1). Card text runs at 13–17px, which is not "large
// text" under WCAG, so the brighter vermillion fails AA there. The hero keeps
// #EC300C because display type only needs 3:1. Same family, different job.
export const HOUSE_COLORS = [
  '#C42408', // red
  '#045CAC', // blue
  '#1F7A4C', // green
  '#B5307A', // magenta
  '#A85100', // orange
  '#5B3FA8', // violet
  '#0C6B78', // teal
  '#8A1B2E', // oxblood
];

/** Two festival colors closer than this (CIE76 ΔE) read as one stage twice. */
export const MIN_DISTANCE = 12;

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Mix a #rrggbb toward another by `t` (0..1). */
export function mix(a: string, b: string, t: number): string {
  const A = rgb(a);
  const B = rgb(b);
  const to2 = (v: number) => v.toString(16).padStart(2, '0');
  return `#${A.map((v, i) => to2(Math.round(v * (1 - t) + B[i]! * t))).join('')}`;
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The text a stage color takes: cream when cream clears the floor, ink when it
 * does not (owner ruling, 2026-09-23). A festival's light colors keep their
 * brightness and print ink on them, the way the festival's own poster does,
 * rather than being darkened until cream passes.
 */
export function textOn(color: string): string {
  return contrast(color, CREAM) >= MIN_CONTRAST ? CREAM : INK;
}

function lab(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** How far apart two colors look (CIE76 ΔE). */
export function distance(a: string, b: string): number {
  const A = lab(a);
  const B = lab(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}

/**
 * What is wrong with a festival's color list, one line per problem, for the
 * schema: a color that is not `#RRGGBB`, a color neither cream nor ink text
 * can be read on, two colors too close to tell two stages apart.
 */
export function colorProblems(colors: string[]): string[] {
  const problems: string[] = [];
  colors.forEach((c, i) => {
    if (!HEX_RE.test(c)) {
      problems.push(`festival: \`colors[${i}]\` "${c}" is not a #RRGGBB color`);
      return;
    }
    const cream = contrast(c, CREAM);
    const ink = contrast(c, INK);
    if (Math.max(cream, ink) < MIN_CONTRAST) {
      problems.push(
        `festival: \`colors[${i}]\` ${c} takes neither cream text (${cream.toFixed(1)}:1) nor ink (${ink.toFixed(1)}:1) ` +
          `at ${MIN_CONTRAST}:1 — pick a lighter or darker shade of it off the art`,
      );
    }
    for (let j = 0; j < i; j++) {
      const other = colors[j]!;
      if (HEX_RE.test(other) && distance(c, other) < MIN_DISTANCE) {
        problems.push(`festival: \`colors[${i}]\` ${c} is too close to \`colors[${j}]\` ${other} to tell two stages apart`);
      }
    }
  });
  return problems;
}

/** The most stages any one weekend has: how many colors an edition needs. */
export function colorsNeeded(stages: { weekend?: string }[]): number {
  const perWeekend = new Map<string | undefined, number>();
  for (const s of stages) perWeekend.set(s.weekend, (perWeekend.get(s.weekend) ?? 0) + 1);
  return Math.max(0, ...perWeekend.values());
}

/**
 * The color of each stage, by its position among the stages of its own
 * weekend: a stage that plays both weekends is two stages in the data and one
 * color, because color is identity. The festival's colors when it names enough
 * for every stage, the house colors otherwise — never a mix of the two.
 */
export function stageColors(stages: { id: string; weekend?: string }[], festivalColors?: string[]): Map<string, string> {
  const palette = festivalColors && festivalColors.length >= colorsNeeded(stages) ? festivalColors : HOUSE_COLORS;
  const colors = new Map<string, string>();
  const seen = new Map<string | undefined, number>();
  for (const s of stages) {
    const i = seen.get(s.weekend) ?? 0;
    seen.set(s.weekend, i + 1);
    colors.set(s.id, palette[i % palette.length]!.toUpperCase());
  }
  return colors;
}
