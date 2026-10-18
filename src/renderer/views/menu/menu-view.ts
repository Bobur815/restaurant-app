import type { CategoryDto, MenuItemDto } from '@shared/types';
import { api } from '../../api';
import { confirmDialog } from '../../components/modal';
import { button, pageHeader } from '../../components/page';
import { toast, toastError } from '../../components/toast';
import { t } from '../../i18n';
import { appStore } from '../../store/app';
import { html } from '../../ui/html';
import { icon } from '../../ui/icons';
import { formatMoney } from '../../utils/format';
import type { View } from '../types';
import { categoryModal, dishModal } from './menu-modals';

const imageUrl = (file: string) => `savdochef-img://img/${encodeURIComponent(file)}`;

function thumb(file: string | null): HTMLElement {
  const box = document.createElement('div');
  box.className = 'thumb';
  if (file) {
    const img = document.createElement('img');
    img.src = imageUrl(file);
    img.alt = '';
    img.loading = 'lazy';
    box.append(img);
  } else box.append(icon('noImage', 20));
  return box;
}

/** Menu and categories (admin; legacy menu page + category window). */
export const menuView: View = () => {
  let categories: CategoryDto[] = [];
  let dishes: MenuItemDto[] = [];
  let categoryId: number | null = null;
  let search = '';
  let showInactive = false;

  const el = document.createElement('section');
  el.className = 'page';
  const addDish = button(t('menu.addDish'), 'primary', async () => {
    if (await dishModal(categories, null, categoryId ?? undefined)) await load();
  });
  const catList = document.createElement('div');
  catList.className = 'category-list';
  const table = document.createElement('div');
  table.className = 'table-wrap';

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.placeholder = t('menu.search');
  searchInput.setAttribute('aria-label', t('menu.search'));
  searchInput.addEventListener('input', () => {
    search = searchInput.value.trim().toLocaleLowerCase();
    renderDishes();
  });
  const inactiveToggle = document.createElement('input');
  inactiveToggle.type = 'checkbox';
  inactiveToggle.id = 'menu-show-inactive';
  inactiveToggle.addEventListener('change', () => {
    showInactive = inactiveToggle.checked;
    void load();
  });

  const addCategory = button(t('menu.addCategory'), 'secondary', async () => {
    if (await categoryModal(null)) await load();
  });

  el.append(
    pageHeader(t('menu.title'), addDish),
    html`<div class="split">
      <aside class="card split-side">
        <div class="card-header"><h2>${t('menu.categories')}</h2></div>
        ${catList}${addCategory}
      </aside>
      <div class="card split-main">
        <div class="toolbar">
          <div class="menu-search">${icon('search', 18)}${searchInput}</div>
          <label class="check-field" for="menu-show-inactive"
            >${inactiveToggle}<span>${t('menu.showInactive')}</span></label
          >
        </div>
        ${table}
      </div>
    </div>`,
  );

  const renderCategories = () => {
    const item = (label: string, id: number | null, count: number | null, cat?: CategoryDto) => {
      const row = document.createElement('div');
      row.className = `category-row${categoryId === id ? ' is-active' : ''}${cat && !cat.isActive ? ' is-inactive' : ''}`;
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'category-select';
      select.setAttribute('aria-pressed', String(categoryId === id));
      select.append(
        html`<span>${label}</span>${count !== null
            ? html`<span class="muted small">${t('menu.count', { count })}</span>`
            : ''}`,
      );
      select.addEventListener('click', () => {
        categoryId = id;
        renderCategories();
        renderDishes();
      });
      row.append(select);
      if (cat) {
        const edit = iconButton('edit', t('menu.edit'), async () => {
          if (await categoryModal(cat)) await load();
        });
        const del = iconButton('trash', t('menu.delete'), async () => {
          const ok = await confirmDialog({
            title: t('menu.delete'),
            message: t('menu.deleteCategoryConfirm', { name: cat.nameUz }),
            danger: true,
          });
          if (!ok) return;
          try {
            await api.categories.delete({ id: cat.id });
            toast(t('menu.deleted'), 'success');
            if (categoryId === cat.id) categoryId = null;
            await load();
          } catch (e) {
            toastError(e);
          }
        });
        del.classList.add('danger');
        row.append(edit, del);
      }
      return row;
    };
    catList.replaceChildren(
      item(t('menu.allCategories'), null, null),
      ...categories.map((c) => item(c.nameUz, c.id, c.menuItemCount, c)),
    );
  };

  const typeLabel = (d: MenuItemDto) =>
    d.soldByWeight
      ? t('menu.typeWeight')
      : d.hasPortions
        ? t('menu.typePortion')
        : t('menu.typePiece');

  const renderDishes = () => {
    const lang = appStore.get().language;
    const visible = dishes.filter(
      (d) =>
        (categoryId === null || d.categoryId === categoryId) &&
        (!search || `${d.nameUz} ${d.nameRu ?? ''}`.toLocaleLowerCase().includes(search)),
    );
    if (visible.length === 0) {
      table.replaceChildren(html`<p class="muted empty-inline">${t('menu.empty')}</p>`);
      return;
    }
    const rows = visible.map((d) => {
      const edit = iconButton('edit', t('menu.edit'), async () => {
        if (await dishModal(categories, d)) await load();
      });
      const del = iconButton('trash', t('menu.delete'), async () => {
        const ok = await confirmDialog({
          title: t('menu.delete'),
          message: t('menu.deleteDishConfirm', { name: d.nameUz }),
          danger: true,
        });
        if (!ok) return;
        try {
          const outcome = await api.menu.delete({ id: d.id });
          toast(outcome === 'deleted' ? t('menu.deleted') : t('menu.deactivated'), 'success');
          await load();
        } catch (e) {
          toastError(e);
        }
      });
      del.classList.add('danger');
      return html`<tr class="${d.isActive ? '' : 'is-inactive'}">
        <td class="thumb-cell">${thumb(d.imageFile)}</td>
        <td>
          <div class="line-name">${d.nameUz}</div>
          <div class="muted small">${d.nameRu ?? ''}</div>
        </td>
        <td>${d.categoryNameUz}</td>
        <td>
          ${typeLabel(d)}${d.isActive
            ? ''
            : html` <span class="badge badge-muted">${t('menu.inactive')}</span>`}
        </td>
        <td class="num strong">${formatMoney(d.price, lang)}</td>
        <td class="num muted">${d.costPrice ? formatMoney(d.costPrice, lang) : '—'}</td>
        <td class="row-actions">${edit}${del}</td>
      </tr>`;
    });
    table.replaceChildren(
      html`<table class="lines-table">
        <thead>
          <tr>
            <th></th>
            <th>${t('menu.dishes')}</th>
            <th>${t('menu.category')}</th>
            <th>${t('menu.saleType')}</th>
            <th class="num">${t('menu.price')}</th>
            <th class="num">${t('menu.costPrice')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>`,
    );
  };

  function iconButton(name: Parameters<typeof icon>[0], label: string, onClick: () => void) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.append(icon(name, 18));
    b.addEventListener('click', onClick);
    return b;
  }

  const load = async () => {
    try {
      [categories, dishes] = await Promise.all([
        api.categories.list({ includeInactive: true }),
        api.menu.list({ includeInactive: showInactive }),
      ]);
      renderCategories();
      renderDishes();
    } catch (e) {
      toastError(e);
    }
  };

  void load();
  const stop = api.events.subscribe((e) => {
    if (e.type === 'menu-changed') void load();
  });
  return { el, destroy: stop };
};
