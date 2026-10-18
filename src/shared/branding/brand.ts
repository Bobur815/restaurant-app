/**
 * SavdoChef brand: constants and the logo artwork, as plain SVG trees.
 *
 * One source for every place the logo appears:
 * - renderer: src/renderer/branding turns these trees into DOM <svg> elements (no innerHTML);
 * - icons: scripts/build-icons.mjs renders them to build/icons (.svg, .ico, .png) and the
 *   renderer favicon. `brand.test.ts` fails if those committed files are stale.
 *
 * Artwork redrawn as vectors from the original raster icon (orange tile, chef hat with a rising
 * bar chart, "SavdoChef" wordmark), with a transparent background outside the tile.
 *
 * No imports and only erasable TypeScript: build-icons.mjs loads this file directly with
 * `node --experimental-strip-types`.
 */

export const BRAND_NAME = 'SavdoChef';
export const BRAND_TAGLINE = 'RESTAURANT POS';
export const BRAND_TAGLINE_UZ = 'RESTORAN SAVDO TIZIMI';
export const BRAND_TAGLINE_RU = 'СИСТЕМА ДЛЯ РЕСТОРАНОВ';

export type ThemeMode = 'light' | 'dark';

export const BRAND_COLORS = {
  light: {
    primary: '#F8901F', // tile orange, sampled from the original icon
    primaryDark: '#E07A10',
    onPrimary: '#FFFFFF',
    text: '#1F2328',
    textMuted: '#5B6573',
    surface: '#FFFFFF',
  },
  dark: {
    primary: '#F8901F',
    primaryDark: '#E07A10',
    onPrimary: '#FFFFFF',
    text: '#F2F4F7',
    textMuted: '#9AA4B1',
    surface: '#1A1F25',
  },
} as const;

export const BRAND_FONT = "'Poppins', 'Segoe UI Semibold', 'Segoe UI', Arial, sans-serif";

// ── SVG tree ─────────────────────────────────────────────────────────────────────────────────

export interface SvgNode {
  tag: string;
  attrs: Record<string, string | number>;
  children?: SvgNode[];
  text?: string;
}

const el = (
  tag: string,
  attrs: Record<string, string | number>,
  children?: SvgNode[],
  text?: string,
): SvgNode => ({ tag, attrs, children, text });

/**
 * The chef hat, in the original 1024 px icon's coordinates (hat spans x 322..702, y 232..597,
 * centred on 512, 414). Placed with `hat(cx, cy, width)`.
 */
function hatShapes(hat: string, cutout: string): SvgNode[] {
  return [
    // Puffs + body, one white silhouette.
    el('circle', { cx: 410, cy: 360, r: 88, fill: hat }),
    el('circle', { cx: 614, cy: 360, r: 88, fill: hat }),
    el('circle', { cx: 512, cy: 332, r: 100, fill: hat }),
    el('rect', { x: 384, y: 380, width: 256, height: 217, rx: 12, fill: hat }),
    // Rising bar chart, cut out in the tile colour.
    el('rect', { x: 448, y: 440, width: 40, height: 88, rx: 4, fill: cutout }),
    el('rect', { x: 504, y: 400, width: 41, height: 128, rx: 4, fill: cutout }),
    el('rect', { x: 561, y: 359, width: 42, height: 169, rx: 4, fill: cutout }),
    // Hat band with a curved top edge.
    el('path', { d: 'M405 551 Q512 541 619 551 L619 578 L405 578 Z', fill: cutout }),
  ];
}

const HAT_WIDTH = 380; // 702 - 322
const HAT_CX = 512;
const HAT_CY = 414.5; // (232 + 597) / 2

function hat(cx: number, cy: number, width: number, hatFill: string, cutout: string): SvgNode {
  const s = width / HAT_WIDTH;
  const tx = round(cx - HAT_CX * s);
  const ty = round(cy - HAT_CY * s);
  return el(
    'g',
    { transform: `translate(${tx} ${ty}) scale(${round(s)})` },
    hatShapes(hatFill, cutout),
  );
}

const round = (n: number): number => Math.round(n * 10000) / 10000;

function svgRoot(width: number, height: number, children: SvgNode[], label: string): SvgNode {
  return el(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      fill: 'none',
      role: 'img',
      'aria-label': label,
    },
    children,
  );
}

function wordmarkText(
  x: number,
  y: number,
  fontSize: number,
  fill: string,
  width: number,
  anchor: 'start' | 'middle',
): SvgNode {
  return el(
    'text',
    {
      x,
      y,
      fill,
      'font-family': BRAND_FONT,
      'font-size': fontSize,
      'font-weight': 600,
      'text-anchor': anchor,
      // Fixed width whatever font the system substitutes, so layouts never overflow.
      textLength: width,
      lengthAdjust: 'spacingAndGlyphs',
    },
    undefined,
    BRAND_NAME,
  );
}

// ── Variants (same set as posgro's branding) ───────────────────────────────────────────────

/** A. ICON: tile + hat, no text. App icon, favicon, taskbar, small sizes. */
export function iconSvg(theme: ThemeMode = 'light', size = 256): SvgNode {
  const c = BRAND_COLORS[theme];
  const root = svgRoot(
    256,
    256,
    [
      el('rect', { width: 256, height: 256, rx: 56, fill: c.primary }),
      hat(128, 124, 172, c.onPrimary, c.primary),
    ],
    BRAND_NAME,
  );
  root.attrs['width'] = size;
  root.attrs['height'] = size;
  return root;
}

/** B. WORDMARK: "SavdoChef" only. Receipts, documents. */
export function wordmarkSvg(theme: ThemeMode = 'light', fontSize = 32): SvgNode {
  const c = BRAND_COLORS[theme];
  const root = svgRoot(200, 44, [wordmarkText(0, 33, 34, c.text, 196, 'start')], BRAND_NAME);
  root.attrs['width'] = round((fontSize / 32) * 200);
  root.attrs['height'] = round((fontSize / 32) * 44);
  return root;
}

/** C. HORIZONTAL: icon tile + wordmark + tagline. App header, login, splash. */
export function horizontalSvg(
  theme: ThemeMode = 'light',
  height = 50,
  tagline = BRAND_TAGLINE,
): SvgNode {
  const c = BRAND_COLORS[theme];
  const root = svgRoot(
    300,
    70,
    [
      el('rect', { x: 8, y: 8, width: 54, height: 54, rx: 13, fill: c.primary }),
      hat(35, 34.5, 37, c.onPrimary, c.primary),
      wordmarkText(76, 40, 30, c.text, 176, 'start'),
      el(
        'text',
        {
          x: 77,
          y: 57,
          fill: c.textMuted,
          'font-family': BRAND_FONT,
          'font-size': 9.5,
          'font-weight': 600,
          'letter-spacing': 1.2,
        },
        undefined,
        tagline,
      ),
    ],
    BRAND_NAME,
  );
  root.attrs['width'] = round((height / 70) * 300);
  root.attrs['height'] = height;
  return root;
}

/**
 * D. SQUARE: the original artwork, tile with hat and wordmark inside, transparent around it.
 * Marketing, about screen, large sizes. The wordmark is unreadable below ~96 px; use the icon.
 */
export function squareSvg(theme: ThemeMode = 'light', size = 400): SvgNode {
  const c = BRAND_COLORS[theme];
  const root = svgRoot(
    256,
    256,
    [
      el('rect', { width: 256, height: 256, rx: 52, fill: c.primary }),
      hat(128, 98, 132, c.onPrimary, c.primary),
      wordmarkText(128, 208, 46, c.onPrimary, 206, 'middle'),
    ],
    BRAND_NAME,
  );
  root.attrs['width'] = size;
  root.attrs['height'] = size;
  return root;
}

// ── Serialisation (build script, tests) ─────────────────────────────────────────────────────

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function toSvgString(node: SvgNode, indent = ''): string {
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`)
    .join('');
  if (node.text !== undefined)
    return `${indent}<${node.tag}${attrs}>${escapeXml(node.text)}</${node.tag}>`;
  if (!node.children?.length) return `${indent}<${node.tag}${attrs}/>`;
  const inner = node.children.map((c) => toSvgString(c, `${indent}  `)).join('\n');
  return `${indent}<${node.tag}${attrs}>\n${inner}\n${indent}</${node.tag}>`;
}

export const GENERATED_SVG_HEADER =
  '<!-- Generated by scripts/build-icons.mjs from src/shared/branding/brand.ts. Do not edit. -->';

/** Exact contents of a generated .svg file (the build script writes it, brand.test.ts compares). */
export function svgFileContents(node: SvgNode): string {
  return `${GENERATED_SVG_HEADER}\n${toSvgString(node)}\n`;
}

/** Files under build/icons generated from this module by scripts/build-icons.mjs. */
export const ICON_SOURCES: ReadonlyArray<{ file: string; svg: () => SvgNode }> = [
  { file: 'savdochef-icon.svg', svg: () => iconSvg('light', 1024) },
  { file: 'savdochef-logo-square.svg', svg: () => squareSvg('light', 1024) },
  { file: 'savdochef-logo-horizontal.svg', svg: () => horizontalSvg('light', 140) },
  { file: 'savdochef-logo-horizontal-dark.svg', svg: () => horizontalSvg('dark', 140) },
];

/** The renderer favicon (src/renderer/public/favicon.svg). */
export const FAVICON_SOURCE = (): SvgNode => iconSvg('light', 64);
