import type { MenuLayout } from '../../store/app';
import { t } from '../../i18n';
import { html } from '../../ui/html';
import { icon } from '../../ui/icons';

/**
 * The order screen's menu side, as parts both layouts share (F16): the category list (a row in
 * the horizontal layout, a sidebar in the vertical one), the dish grid and one dish card. They
 * only draw what `order-view.ts` hands them; availability, prices and adding stay there.
 */

const imageUrl = (file: string | null) =>
  file ? `savdochef-img://img/${encodeURIComponent(file)}` : null;

/** A picture box: the image, or the "no image" icon when there is none or it fails to load. */
export function thumb(file: string | null, className: string, iconSize = 22): HTMLElement {
  const box = document.createElement('div');
  box.className = className;
  const url = imageUrl(file);
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.draggable = false;
    img.addEventListener('error', () => img.replaceWith(icon('noImage', iconSize)));
    box.append(img);
  } else {
    box.append(icon('noImage', iconSize));
  }
  return box;
}

export interface CategoryTile {
  id: number | null;
  label: string;
  /** Shown when set; null draws a text-only tile. */
  imageFile: string | null;
}

export interface CategoryList {
  el: HTMLElement;
  render(tiles: CategoryTile[], activeId: number | null): void;
  setOrientation(orientation: MenuLayout): void;
}

/** Below this many pixels a mouse press is still a click, not a drag of the row. */
const DRAG_THRESHOLD = 6;

export function createCategoryList(onSelect: (id: number | null) => void): CategoryList {
  const el = document.createElement('div');
  el.className = 'category-tiles';
  el.setAttribute('role', 'tablist');
  let orientation: MenuLayout = 'horizontal';
  let shownActive: number | null | undefined;

  // A mouse wheel scrolls the row sideways (a touch screen swipes it natively).
  el.addEventListener(
    'wheel',
    (e) => {
      if (orientation !== 'horizontal' || e.ctrlKey) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    },
    { passive: false },
  );

  // Dragging with the mouse scrolls too; the click that ends a drag does not pick a category.
  let drag: { x: number; y: number; left: number; top: number; moved: boolean } | null = null;
  let swallowClick = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false };
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add('is-dragging');
    }
    if (orientation === 'horizontal') el.scrollLeft = drag.left - dx;
    else el.scrollTop = drag.top - dy;
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag) return;
    if (drag.moved) {
      swallowClick = true;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      // A drag that ended outside a tile fires no click: nothing left to swallow.
      setTimeout(() => (swallowClick = false), 0);
    }
    el.classList.remove('is-dragging');
    drag = null;
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  el.addEventListener(
    'click',
    (e) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  function scrollActiveIntoView(smooth: boolean) {
    const active = el.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!active || !el.isConnected) return;
    active.scrollIntoView(
      orientation === 'horizontal'
        ? { inline: 'center', block: 'nearest', behavior: smooth ? 'smooth' : 'auto' }
        : { block: 'nearest', inline: 'nearest', behavior: smooth ? 'smooth' : 'auto' },
    );
  }

  return {
    el,
    render(tiles, activeId) {
      el.replaceChildren(
        ...tiles.map((tile) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'category-tile';
          b.setAttribute('role', 'tab');
          b.setAttribute('aria-selected', String(activeId === tile.id));
          if (tile.imageFile) {
            b.classList.add('has-image');
            b.append(
              thumb(tile.imageFile, 'category-tile-image', 28),
              html`<span class="category-tile-label">${tile.label}</span>`,
            );
          } else {
            b.append(html`<span class="category-tile-label">${tile.label}</span>`);
          }
          b.addEventListener('click', () => onSelect(tile.id));
          return b;
        }),
      );
      // Only when the choice changed: a menu refresh must not jump the row back.
      if (activeId !== shownActive) {
        const first = shownActive === undefined;
        shownActive = activeId;
        requestAnimationFrame(() => scrollActiveIntoView(!first));
      }
    },
    setOrientation(next) {
      orientation = next;
      el.setAttribute('aria-orientation', next);
      requestAnimationFrame(() => scrollActiveIntoView(false));
    },
  };
}

export interface MenuItemCardProps {
  name: string;
  /** Formatted price, with the per-kilo suffix where it applies. */
  price: string;
  badge: string;
  /** Out of stock or not in the shift: greyed, muted badge. */
  out: boolean;
  disabled: boolean;
  /** undefined = pictures turned off (F10); null = no picture for this dish. */
  imageFile: string | null | undefined;
  onAdd(): void;
}

export function menuItemCard(p: MenuItemCardProps): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  const pictures = p.imageFile !== undefined;
  b.className = `dish-card${p.out ? ' is-out' : ''}${pictures ? '' : ' no-image'}`;
  b.disabled = p.disabled;
  b.append(
    html`${pictures ? thumb(p.imageFile ?? null, 'dish-image', 36) : ''}
      <span class="dish-body">
        <span class="dish-name">${p.name}</span>
        <span class="dish-price">${p.price}</span>
        <span class="dish-stock ${p.out ? 'badge badge-muted' : 'badge badge-success'}"
          >${p.badge}</span
        >
      </span>`,
  );
  b.addEventListener('click', p.onAdd);
  return b;
}

export interface MenuGrid {
  el: HTMLElement;
  render(cards: HTMLElement[]): void;
  resetScroll(): void;
}

export function createMenuGrid(): MenuGrid {
  const el = document.createElement('div');
  el.className = 'dish-grid';
  return {
    el,
    render(cards) {
      el.replaceChildren(
        ...(cards.length > 0
          ? cards
          : [html`<p class="muted empty-inline">${t('order.noDishes')}</p>`]),
      );
    },
    resetScroll() {
      el.scrollTop = 0;
    },
  };
}

/** Two icon buttons next to the search box: categories on top, or in a sidebar. */
export function layoutToggle(
  current: MenuLayout,
  onChange: (layout: MenuLayout) => void,
): { el: HTMLElement; set(layout: MenuLayout): void } {
  const el = document.createElement('div');
  el.className = 'layout-toggle';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', t('order.layout'));
  const options: [MenuLayout, 'layoutTop' | 'layoutSide', string][] = [
    ['horizontal', 'layoutTop', t('order.layoutHorizontal')],
    ['vertical', 'layoutSide', t('order.layoutVertical')],
  ];
  const buttons = options.map(([layout, name, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.dataset['layout'] = layout;
    b.append(icon(name, 20));
    b.addEventListener('click', () => onChange(layout));
    return b;
  });
  const set = (layout: MenuLayout) => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset['layout'] === layout));
  };
  set(current);
  el.append(...buttons);
  return { el, set };
}
