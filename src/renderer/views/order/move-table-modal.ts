import type { OrderDto } from '@shared/types';
import { api, isApiError } from '../../api';
import { openModal } from '../../components/modal';
import { toast, toastError } from '../../components/toast';
import { t } from '../../i18n';
import { html } from '../../ui/html';
import { playClick } from '../../ui/sound';

/**
 * Moves a table's unpaid order to another table (the guests changed seats): one tap on a free
 * table. Only free, shown tables are offered; main checks it again. Resolves the moved order, or
 * null if closed or refused.
 */
export function moveTableModal(
  fromTable: number,
  expectedVersion: number,
): Promise<OrderDto | null> {
  let moved: OrderDto | null = null;
  const body = document.createElement('div');
  body.className = 'move-table';
  body.append(html`<p class="muted small">${t('moveTable.loading')}</p>`);

  const modal = openModal({
    title: t('moveTable.title', { n: fromTable }),
    body,
    size: 'md',
    actions: [{ label: t('app.cancel') }],
  });

  const pick = async (toTable: number, b: HTMLButtonElement) => {
    playClick();
    modal.setBusy(true);
    b.classList.add('is-picked');
    try {
      moved = await api.orders.moveTable({ fromTable, toTable, expectedVersion });
      toast(t('moveTable.done', { from: fromTable, to: toTable }), 'success');
      modal.close();
    } catch (error) {
      toastError(error);
      // Paid, cancelled, moved or edited elsewhere: this version can never succeed; the caller's
      // screen reloads from the change event.
      if (isStale(error)) {
        modal.close();
        return;
      }
      b.classList.remove('is-picked');
      modal.setBusy(false);
      void render(); // the table may have been taken meanwhile
    }
  };

  const isStale = (error: unknown) =>
    isApiError(error, 'CONFLICT') &&
    (error.details as Record<string, unknown> | undefined)?.['reason'] === 'STALE';

  const render = async () => {
    try {
      const [halls, busy] = await Promise.all([api.halls.list({}), api.orders.busyTables()]);
      const taken = new Set(busy.map((b) => b.tableNumber));
      const groups = halls
        .map((h) => ({ hall: h, free: h.tables.filter((x) => !taken.has(x.number)) }))
        .filter((g) => g.free.length > 0);
      if (groups.length === 0) {
        body.replaceChildren(html`<p class="muted">${t('moveTable.noneFree')}</p>`);
        return;
      }
      body.replaceChildren(
        html`<p class="muted small">${t('moveTable.hint')}</p>`,
        ...groups.map((g) => {
          const grid = document.createElement('div');
          grid.className = 'move-table-grid';
          grid.append(
            ...g.free.map((x) => {
              const b = document.createElement('button');
              b.type = 'button';
              b.className = 'move-table-option';
              b.append(
                html`<span class="table-number">${x.number}</span> ${x.label
                    ? html`<span class="table-label">${x.label}</span>`
                    : ''}`,
              );
              b.setAttribute('aria-label', t('tables.table', { n: x.number }));
              b.addEventListener('click', () => void pick(x.number, b));
              return b;
            }),
          );
          return halls.length > 1
            ? html`<h3 class="hall-heading">${g.hall.name}</h3>
                ${grid}`
            : grid;
        }),
      );
    } catch (error) {
      toastError(error);
    }
  };

  void render();
  return modal.closed.then(() => moved);
}
