/**
 * html`...` builds a DocumentFragment from a template literal. Every interpolated value is
 * escaped: a dish called `<img onerror=...>` renders as that text, never as markup (legacy built
 * pages with innerHTML and raw data, an XSS risk). This file is the only place allowed to assign
 * innerHTML (eslint enforces it elsewhere).
 *
 * Values:
 * - string / number          escaped text (in attributes: escaped attribute value)
 * - null / undefined / bool  nothing (write `${x ? 'a' : ''}` for conditional text)
 * - Node (incl. html`` results, icons)   inserted as a node, text positions only
 * - arrays                   each item as above
 * - raw(markup)              inserted as-is: only for markup this code wrote itself
 *
 * Rules enforced at runtime (they are programming errors, so they throw):
 * - attribute values must be quoted: class="${x}", never class=${x};
 * - no interpolation into on* attributes (inline handlers are blocked by the CSP anyway).
 * `javascript:` in href/src/action is replaced with `about:blank`.
 */

const RAW = Symbol('raw-html');

export interface RawHtml {
  readonly [RAW]: string;
}

/** Trusted, already-safe markup (static SVG, entities). Never pass data through this. */
export function raw(markup: string): RawHtml {
  return { [RAW]: markup };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href']);
const isRaw = (v: unknown): v is RawHtml => typeof v === 'object' && v !== null && RAW in v;

/** Parser position between template chunks: inside a tag? inside a quoted attribute value? */
interface TagState {
  inside: boolean;
  quote: '"' | "'" | null;
}

/**
 * Advances the state over a static chunk. The quote must carry across chunks: after
 * `title="${x}` the next chunk starts with the closing `"`, not an opening one.
 */
function scan(state: TagState, chunk: string): TagState {
  let { inside, quote } = state;
  for (const ch of chunk) {
    if (inside) {
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') inside = false;
    } else if (ch === '<') inside = true;
  }
  return { inside, quote };
}

function attributeValue(value: unknown, before: string): string {
  const trimmed = before.trimEnd();
  if (trimmed.endsWith('=')) throw new Error('html``: attribute values must be quoted');
  const name = /([^\s"'=<>/]+)\s*=\s*["'][^"']*$/.exec(before)?.[1]?.toLowerCase() ?? '';
  if (name.startsWith('on')) throw new Error(`html\`\`: no interpolation into ${name}`);
  if (isRaw(value) || value instanceof Node)
    throw new Error('html``: nodes and raw() only in text positions');
  if (value === null || value === undefined || value === false || value === true) return '';
  const text = String(value);
  if (URL_ATTRS.has(name) && /^[\s\u0000-\u001f]*javascript:/i.test(text)) return 'about:blank';
  return escapeHtml(text);
}

function textValue(value: unknown, nodes: Node[]): string {
  if (value === null || value === undefined || value === false || value === true) return '';
  if (Array.isArray(value)) return value.map((v) => textValue(v, nodes)).join('');
  if (isRaw(value)) return value[RAW];
  if (value instanceof Node) {
    nodes.push(value);
    return `<!--html-slot:${nodes.length - 1}-->`;
  }
  return escapeHtml(String(value));
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): DocumentFragment {
  const nodes: Node[] = [];
  let markup = '';
  let state: TagState = { inside: false, quote: null };

  strings.forEach((chunk, i) => {
    markup += chunk;
    state = scan(state, chunk);
    if (i < values.length) {
      markup += state.inside ? attributeValue(values[i], markup) : textValue(values[i], nodes);
    }
  });

  const template = document.createElement('template');
  // eslint-disable-next-line no-restricted-properties -- the escaping happens above
  template.innerHTML = markup;
  const fragment = template.content;

  if (nodes.length) {
    const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_COMMENT);
    const slots: Comment[] = [];
    while (walker.nextNode()) {
      const c = walker.currentNode as Comment;
      if (c.data.startsWith('html-slot:')) slots.push(c);
    }
    for (const slot of slots)
      slot.replaceWith(nodes[Number(slot.data.slice('html-slot:'.length))]!);
  }
  // Returned as-is, not via importNode: cloning would drop listeners on inserted nodes. Appending
  // the fragment to the page adopts its nodes.
  return fragment;
}

/** Elements marked data-ref="name" inside `root`, by name (typed by the caller). */
export function refs<T extends Record<string, Element>>(root: ParentNode): T {
  const out: Record<string, Element> = {};
  root.querySelectorAll('[data-ref]').forEach((el) => {
    out[el.getAttribute('data-ref')!] = el;
  });
  return out as T;
}
