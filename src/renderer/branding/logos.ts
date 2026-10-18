import {
  horizontalSvg,
  iconSvg,
  squareSvg,
  wordmarkSvg,
  type SvgNode,
  type ThemeMode,
} from '@shared/branding/brand';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Builds real SVG DOM nodes from a brand tree: no innerHTML, nothing for the CSP to object to. */
function render(node: SvgNode): SVGElement {
  const element = document.createElementNS(SVG_NS, node.tag);
  for (const [name, value] of Object.entries(node.attrs)) {
    if (name === 'xmlns') continue; // implied by createElementNS
    element.setAttribute(name, String(value));
  }
  if (node.text !== undefined) element.textContent = node.text;
  for (const child of node.children ?? []) element.appendChild(render(child));
  return element;
}

/** The theme in effect: the manual toggle on <html data-theme>, else the OS preference. */
export function currentTheme(): ThemeMode {
  const forced = document.documentElement.dataset['theme'];
  if (forced === 'light' || forced === 'dark') return forced;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// A. ICON ONLY: app icon, favicon, compact headers.
export function SavdoChefIcon(opts: { theme?: ThemeMode; size?: number } = {}): SVGElement {
  return render(iconSvg(opts.theme ?? currentTheme(), opts.size ?? 256));
}

// B. WORDMARK ONLY: receipts, documents.
export function SavdoChefWordmark(opts: { theme?: ThemeMode; fontSize?: number } = {}): SVGElement {
  return render(wordmarkSvg(opts.theme ?? currentTheme(), opts.fontSize ?? 32));
}

// C. HORIZONTAL (COMBINED): app header, login, splash screen (primary logo).
export function SavdoChefHorizontal(
  opts: { theme?: ThemeMode; height?: number; tagline?: string } = {},
): SVGElement {
  return render(horizontalSvg(opts.theme ?? currentTheme(), opts.height ?? 50, opts.tagline));
}

// D. SQUARE: original artwork, about screen and large contexts.
export function SavdoChefSquare(opts: { theme?: ThemeMode; size?: number } = {}): SVGElement {
  return render(squareSvg(opts.theme ?? currentTheme(), opts.size ?? 400));
}

export default {
  Icon: SavdoChefIcon,
  Wordmark: SavdoChefWordmark,
  Horizontal: SavdoChefHorizontal,
  Square: SavdoChefSquare,
};
