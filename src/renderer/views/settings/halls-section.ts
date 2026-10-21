import type { DiningTableDto, HallDto } from '@shared/types';
import { api } from '../../api';
import {
  checkboxField,
  checked,
  field,
  formError,
  selectField,
  showFormError,
  value,
} from '../../components/forms';
import { confirmDialog, openModal } from '../../components/modal';
import { button, pageHeader } from '../../components/page';
import { toast, toastError } from '../../components/toast';
import { t } from '../../i18n';
import { licensed } from '../../store/app';
import { html } from '../../ui/html';
import { icon } from '../../ui/icons';
import type { View } from '../types';
import { iconButton } from './settings-ui';

/** Optional whole number from a form field: '' -> null. */
const optionalInt = (form: ParentNode, name: string): number | null => {
  const v = value(form, name).trim();
  return v === '' ? null : Number(v);
};

/** Runs a dialog's save; keeps the dialog open and shows the error on failure. */
async function trySave(form: HTMLElement, save: () => Promise<unknown>): Promise<boolean> {
  try {
    await save();
    toast(t('halls.saved'), 'success');
    return true;
  } catch (error) {
    showFormError(form, error);
    return false;
  }
}

function hallModal(hall: HallDto | null): Promise<void> {
  const form = document.createElement('div');
  form.append(
    html`${field({
      name: 'name',
      label: t('halls.hallName'),
      value: hall?.name ?? '',
      required: true,
    })}
    ${formError()}`,
  );
  const modal = openModal({
    title: hall ? t('halls.editHall') : t('halls.addHall'),
    body: form,
    size: 'sm',
    initialFocus: () => form.querySelector('input'),
    actions: [
      { label: t('app.cancel') },
      {
        label: t('app.save'),
        kind: 'primary',
        submit: true,
        onClick: () =>
          trySave(form, () =>
            hall
              ? api.halls.update({ id: hall.id, name: value(form, 'name') })
              : api.halls.create({ name: value(form, 'name') }),
          ),
      },
    ],
  });
  return modal.closed;
}

function tableModal(
  table: DiningTableDto | null,
  hall: HallDto,
  halls: HallDto[],
  nextNumber: number,
): Promise<void> {
  const form = document.createElement('div');
  const activeHalls = halls.filter((h) => h.isActive || h.id === hall.id);
  form.append(
    html`<div class="form-row">
        ${field({
          name: 'number',
          label: t('halls.number'),
          type: 'number',
          inputmode: 'numeric',
          min: 1,
          max: 999,
          value: String(table?.number ?? nextNumber),
          required: true,
        })}
        ${field({
          name: 'seats',
          label: t('halls.seats'),
          type: 'number',
          inputmode: 'numeric',
          min: 1,
          max: 100,
          value: table?.seats ? String(table.seats) : '',
        })}
      </div>
      ${field({ name: 'label', label: t('halls.label'), value: table?.label ?? '' })}
      ${selectField({
        name: 'hallId',
        label: t('halls.hall'),
        value: String(table?.hallId ?? hall.id),
        options: activeHalls.map((h) => ({ value: String(h.id), label: h.name })),
      })}
      ${table
        ? checkboxField({ name: 'isActive', label: t('halls.active'), checked: table.isActive })
        : ''}
      ${formError()}`,
  );

  const actions = [
    { label: t('app.cancel') },
    {
      label: t('app.save'),
      kind: 'primary' as const,
      submit: true,
      onClick: () =>
        trySave(form, () => {
          const data = {
            number: Number(value(form, 'number')),
            seats: optionalInt(form, 'seats'),
            label: value(form, 'label') || null,
            hallId: Number(value(form, 'hallId')),
          };
          return table
            ? api.tables.update({ id: table.id, ...data, isActive: checked(form, 'isActive') })
            : api.tables.create(data);
        }),
    },
  ];
  const modal = openModal({
    title: table ? t('halls.editTable') : t('halls.addTable'),
    body: form,
    size: 'sm',
    initialFocus: () => form.querySelector('input'),
    actions: table
      ? [
          {
            label: t('halls.delete'),
            kind: 'danger' as const,
            onClick: async () => {
              const ok = await confirmDialog({
                title: t('halls.deleteTableTitle'),
                message: t('halls.deleteTableConfirm', { n: table.number }),
                confirmLabel: t('halls.delete'),
                danger: true,
              });
              if (!ok) return false;
              try {
                await api.tables.delete({ id: table.id });
                toast(t('halls.deleted'), 'success');
              } catch (error) {
                showFormError(form, error);
                return false;
              }
            },
          },
          ...actions,
        ]
      : actions,
  });
  return modal.closed;
}

function rangeModal(hall: HallDto, nextNumber: number): Promise<void> {
  const form = document.createElement('div');
  form.append(
    html`<div class="form-row">
        ${field({
          name: 'from',
          label: t('halls.from'),
          type: 'number',
          inputmode: 'numeric',
          min: 1,
          max: 999,
          value: String(nextNumber),
          required: true,
        })}
        ${field({
          name: 'to',
          label: t('halls.to'),
          type: 'number',
          inputmode: 'numeric',
          min: 1,
          max: 999,
          value: String(nextNumber + 4),
          required: true,
        })}
      </div>
      ${formError()}`,
  );
  const modal = openModal({
    title: `${t('halls.addRange')}: ${hall.name}`,
    body: form,
    size: 'sm',
    initialFocus: () => form.querySelector('input'),
    actions: [
      { label: t('app.cancel') },
      {
        label: t('app.save'),
        kind: 'primary',
        submit: true,
        onClick: async () => {
          try {
            const created = await api.tables.createRange({
              hallId: hall.id,
              from: Number(value(form, 'from')),
              to: Number(value(form, 'to')),
            });
            toast(t('halls.rangeAdded', { count: created.length }), 'success');
          } catch (error) {
            showFormError(form, error);
            return false;
          }
        },
      },
    ],
  });
  return modal.closed;
}

/**
 * Halls and their tables (admin): add, rename, reorder and hide halls; add tables one by one or as
 * a range, edit, move between halls, hide or delete them. The main process enforces the rules
 * (unique numbers, nothing removed from under an unpaid order or out of history).
 */
export const hallsSection: View = () => {
  const el = document.createElement('section');
  el.className = 'page';
  const list = document.createElement('div');
  list.className = 'hall-list';

  const showHidden = document.createElement('label');
  showHidden.className = 'check-inline';
  const showHiddenBox = document.createElement('input');
  showHiddenBox.type = 'checkbox';
  showHidden.append(showHiddenBox, document.createTextNode(t('halls.showHidden')));

  let halls: HallDto[] = [];

  /** A second active hall is a plan feature (F5); the first one never is. */
  const mayAddHall = () => licensed('multiHall') || !halls.some((h) => h.isActive);
  const addHallButton = button(
    t('halls.addHall'),
    'primary',
    () => void hallModal(null).then(load),
  );
  const planNote = document.createElement('p');
  planNote.className = 'muted small';
  planNote.textContent = t('halls.oneHallOnly');

  el.append(
    pageHeader(t('settings.sectionHalls'), showHidden, addHallButton),
    html`<p class="muted small">${t('halls.hint')}</p>`,
    planNote,
    list,
  );

  /** The next number after every table that exists, hidden ones included. */
  const nextNumber = () =>
    Math.min(999, Math.max(0, ...halls.flatMap((h) => h.tables.map((x) => x.number))) + 1);

  /** Moves a hall one place up or down (all positions saved in one call). */
  const move = async (index: number, delta: -1 | 1) => {
    const order = halls.slice();
    const [moved] = order.splice(index, 1);
    order.splice(index + delta, 0, moved!);
    try {
      await api.halls.reorder({ ids: order.map((h) => h.id) });
    } catch (error) {
      toastError(error);
    }
    await load();
  };

  const setHallActive = async (hall: HallDto, isActive: boolean) => {
    try {
      await api.halls.update({ id: hall.id, isActive });
      toast(t('halls.saved'), 'success');
    } catch (error) {
      toastError(error);
    }
    await load();
  };

  const removeHall = async (hall: HallDto) => {
    const ok = await confirmDialog({
      title: t('halls.deleteHallTitle'),
      message: t('halls.deleteHallConfirm', { name: hall.name }),
      confirmLabel: t('halls.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.halls.delete({ id: hall.id });
      toast(t('halls.deleted'), 'success');
    } catch (error) {
      toastError(error);
    }
    await load();
  };

  const render = () => {
    addHallButton.hidden = !mayAddHall();
    planNote.hidden = licensed('multiHall');
    const visible = showHiddenBox.checked ? halls : halls.filter((h) => h.isActive);
    if (visible.length === 0) {
      list.replaceChildren(html`<p class="empty-state">${t('halls.noHalls')}</p>`);
      return;
    }
    list.replaceChildren(
      ...visible.map((hall) => {
        const index = halls.indexOf(hall);
        const tables = showHiddenBox.checked ? hall.tables : hall.tables.filter((x) => x.isActive);
        const card = document.createElement('article');
        card.className = `card hall-card${hall.isActive ? '' : ' is-inactive'}`;

        const actions = document.createElement('div');
        actions.className = 'hall-actions';
        actions.append(
          iconButton(t('halls.moveUp'), icon('up'), () => void move(index, -1)),
          iconButton(t('halls.moveDown'), icon('down'), () => void move(index, 1)),
          iconButton(t('halls.editHall'), icon('edit'), () => void hallModal(hall).then(load)),
        );
        if (hall.isActive)
          actions.append(
            iconButton(t('halls.hide'), icon('hide'), () => void setHallActive(hall, false)),
          );
        else if (mayAddHall())
          actions.append(
            iconButton(t('halls.show'), icon('show'), () => void setHallActive(hall, true)),
          );
        if (hall.tables.length === 0)
          actions.append(iconButton(t('halls.delete'), icon('trash'), () => void removeHall(hall)));
        (actions.children[0] as HTMLButtonElement).disabled = index === 0;
        (actions.children[1] as HTMLButtonElement).disabled = index === halls.length - 1;

        const grid = document.createElement('div');
        grid.className = 'hall-tables';
        for (const table of tables) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = `hall-table${table.isActive ? '' : ' is-inactive'}`;
          b.append(
            html`<span class="hall-table-number">${table.number}</span> ${table.label
                ? html`<span class="hall-table-label">${table.label}</span>`
                : ''}
              ${table.seats
                ? html`<span class="hall-table-meta"
                    >${t('halls.seatsShort', { count: table.seats })}</span
                  >`
                : ''}
              ${table.isActive
                ? ''
                : html`<span class="badge badge-muted">${t('halls.hidden')}</span>`}`,
          );
          b.setAttribute('aria-label', t('tables.table', { n: table.number }));
          b.addEventListener(
            'click',
            () => void tableModal(table, hall, halls, nextNumber()).then(load),
          );
          grid.append(b);
        }
        if (tables.length === 0)
          grid.append(html`<p class="muted small">${t('halls.noTables')}</p>`);

        const footer = document.createElement('div');
        footer.className = 'bulk-actions';
        if (hall.isActive) {
          footer.append(
            button(
              t('halls.addTable'),
              'secondary',
              () => void tableModal(null, hall, halls, nextNumber()).then(load),
            ),
            button(
              t('halls.addRange'),
              'ghost',
              () => void rangeModal(hall, nextNumber()).then(load),
            ),
          );
        }

        card.append(
          html`<header class="hall-header">
            <div>
              <h2 class="card-title">
                ${hall.name}
                ${hall.isActive
                  ? ''
                  : html`<span class="badge badge-muted">${t('halls.hidden')}</span>`}
              </h2>
              <span class="muted small"
                >${t('halls.tables', { count: hall.tables.filter((x) => x.isActive).length })}</span
              >
            </div>
            ${actions}
          </header>`,
          grid,
          footer,
        );
        return card;
      }),
    );
  };

  async function load() {
    try {
      halls = await api.halls.list({ includeInactive: true });
      render();
    } catch (error) {
      toastError(error);
    }
  }

  showHiddenBox.addEventListener('change', render);
  void load();
  const stop = api.events.subscribe((e) => {
    if (e.type === 'halls-changed') void load();
  });
  return { el, destroy: stop };
};
