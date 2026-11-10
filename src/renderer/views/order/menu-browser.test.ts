import { createCategoryList, createMenuGrid, layoutToggle, menuItemCard } from './menu-browser';

describe('order screen menu parts (F16)', () => {
  it('category list: tiles in the given order, picture only when there is one, a tap selects', () => {
    const picked: (number | null)[] = [];
    const list = createCategoryList((id) => picked.push(id));
    list.render(
      [
        { id: null, label: 'Barchasi', imageFile: null },
        { id: 3, label: '1-ovqatlar', imageFile: 'a.jpg' },
      ],
      3,
    );
    const tiles = [...list.el.querySelectorAll<HTMLButtonElement>('.category-tile')];
    expect(tiles.map((b) => b.textContent)).toEqual(['Barchasi', '1-ovqatlar']);
    expect(tiles.map((b) => b.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(tiles[0]!.querySelector('img')).toBeNull();
    const img = tiles[1]!.querySelector('img')!;
    expect(img.loading).toBe('lazy');
    expect(img.decoding).toBe('async');
    tiles[0]!.click();
    expect(picked).toEqual([null]);
    list.setOrientation('vertical');
    expect(list.el.getAttribute('aria-orientation')).toBe('vertical');
  });

  it('dish card: disabled stays unclickable; pictures off draws a text tile', () => {
    let added = 0;
    const card = menuItemCard({
      name: 'Osh',
      price: '35 000',
      badge: 'Smenada yo‘q',
      out: true,
      disabled: true,
      imageFile: null,
      onAdd: () => added++,
    });
    expect(card.classList.contains('is-out')).toBe(true);
    expect(card.querySelector('.dish-image')).not.toBeNull();
    expect(card.querySelector('.badge-muted')!.textContent).toBe('Smenada yo‘q');
    card.click();
    expect(added).toBe(0);

    const plain = menuItemCard({
      name: 'Choy',
      price: '3 000',
      badge: 'Cheksiz',
      out: false,
      disabled: false,
      imageFile: undefined,
      onAdd: () => added++,
    });
    expect(plain.classList.contains('no-image')).toBe(true);
    expect(plain.querySelector('.dish-image')).toBeNull();
    plain.click();
    expect(added).toBe(1);
  });

  it('grid shows the empty text without cards and scrolls back to the top', () => {
    const grid = createMenuGrid();
    grid.render([]);
    expect(grid.el.querySelector('.empty-inline')).not.toBeNull();
    grid.el.scrollTop = 120;
    grid.resetScroll();
    expect(grid.el.scrollTop).toBe(0);
  });

  it('layout toggle marks the current layout and reports a press', () => {
    const chosen: string[] = [];
    const toggle = layoutToggle('horizontal', (l) => chosen.push(l));
    const pressed = () =>
      [...toggle.el.querySelectorAll('[aria-pressed="true"]')].map(
        (b) => (b as HTMLElement).dataset['layout'],
      );
    expect(pressed()).toEqual(['horizontal']);
    toggle.el.querySelector<HTMLButtonElement>('[data-layout="vertical"]')!.click();
    expect(chosen).toEqual(['vertical']);
    toggle.set('vertical');
    expect(pressed()).toEqual(['vertical']);
  });
});
