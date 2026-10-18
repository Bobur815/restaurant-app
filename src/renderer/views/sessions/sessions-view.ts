import type { SessionDto } from '@shared/types';
import { api } from '../../api';
import { confirmDialog, openModal } from '../../components/modal';
import { button, pageHeader } from '../../components/page';
import { toast, toastError } from '../../components/toast';
import { t } from '../../i18n';
import { isAdmin } from '../../router/routes';
import { appStore } from '../../store/app';
import { html } from '../../ui/html';
import { icon } from '../../ui/icons';
import { formatDateTime, formatQty, localName } from '../../utils/format';
import type { View } from '../types';
import { closeShiftModal } from './close-modal';
import { shiftQuantitiesModal } from './quantities-modal';

function itemsTable(session: SessionDto): HTMLElement {
  const lang = appStore.get().language;
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.append(
    html`<table class="lines-table">
      <thead>
        <tr>
          <th>${t('sessions.dish')}</th>
          <th class="num">${t('sessions.initial')}</th>
          <th class="num">${t('sessions.sold')}</th>
          <th class="num">${t('sessions.remaining')}</th>
        </tr>
      </thead>
      <tbody>
        ${session.items.map(
          (i) =>
            html`<tr>
              <td class="line-name">${localName(i, lang)}</td>
              <td class="num">${formatQty(i.initialQuantity, lang, i.soldByWeight)}</td>
              <td class="num">${formatQty(i.soldQuantity, lang, i.soldByWeight)}</td>
              <td class="num strong">${formatQty(i.remainingQuantity, lang, i.soldByWeight)}</td>
            </tr>`,
        )}
      </tbody>
    </table>`,
  );
  return wrap;
}

/** Shifts (legacy "Smenalar"): the open shift's stock, open/edit/close, and the history. */
export const sessionsView: View = () => {
  const el = document.createElement('section');
  el.className = 'page';
  const current = document.createElement('div');
  const history = document.createElement('div');
  const openButton = button(t('sessions.open'), 'primary', () => void openShift());
  el.append(pageHeader(t('sessions.title'), openButton), current, history);

  let sessions: SessionDto[] = [];

  const openShift = async () => {
    const opened = await shiftQuantitiesModal(null).catch((e: unknown) => (toastError(e), null));
    if (opened) await load();
  };

  const renderCurrent = () => {
    const open = sessions.find((s) => s.status === 'open') ?? null;
    openButton.hidden = !!open;
    current.replaceChildren();
    if (!open) {
      current.className = 'notice notice-warning';
      current.append(html`${icon('warning')}<span>${t('sessions.none')}</span>`);
      return;
    }
    current.className = 'card';
    const edit = button(t('sessions.edit'), 'secondary', async () => {
      const updated = await shiftQuantitiesModal(open).catch((e: unknown) => (toastError(e), null));
      if (updated) await load();
    });
    const close = button(t('sessions.close'), 'danger', async () => {
      const closed = await closeShiftModal(open).catch((e: unknown) => (toastError(e), null));
      if (closed) await load();
    });
    current.append(
      html`<div class="card-header">
        <div>
          <h2>${t('sessions.current', { id: open.id })}</h2>
          <p class="muted">
            ${t('sessions.openedAt', {
              time: formatDateTime(open.openedAt),
              user: open.openedBy ?? '—',
            })}
          </p>
        </div>
        <div class="page-actions">${edit}${close}</div>
      </div>`,
      itemsTable(open),
    );
  };

  const renderHistory = () => {
    const closed = sessions.filter((s) => s.status === 'closed');
    const admin = isAdmin(appStore.get().user!.role);
    const rows = closed.map((s) => {
      const view = button(t('sessions.view'), 'ghost', () =>
        openModal({ title: t('sessions.details', { id: s.id }), body: itemsTable(s), size: 'lg' }),
      );
      const del = admin
        ? button(t('sessions.delete'), 'danger-ghost', async () => {
            const ok = await confirmDialog({
              title: t('sessions.delete'),
              message: t('sessions.deleteConfirm', { id: s.id }),
              danger: true,
            });
            if (!ok) return;
            try {
              await api.sessions.delete({ id: s.id });
              toast(t('sessions.deleted'), 'success');
              await load();
            } catch (e) {
              toastError(e);
            }
          })
        : '';
      return html`<tr>
        <td class="strong">${s.id}</td>
        <td>
          ${formatDateTime(s.openedAt)}
          <div class="muted small">${s.openedBy ?? ''}</div>
        </td>
        <td>
          ${s.closedAt ? formatDateTime(s.closedAt) : '—'}
          <div class="muted small">${s.closedBy ?? ''}</div>
        </td>
        <td class="num">${s.items.length}</td>
        <td class="row-actions">${view}${del}</td>
      </tr>`;
    });
    history.className = 'card';
    history.replaceChildren(
      html`<h2 class="card-title">${t('sessions.history')}</h2>`,
      closed.length
        ? html`<div class="table-wrap">
            <table class="lines-table">
              <thead>
                <tr>
                  <th>${t('sessions.number')}</th>
                  <th>${t('sessions.opened')}</th>
                  <th>${t('sessions.closed')}</th>
                  <th class="num">${t('sessions.items')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>
          </div>`
        : html`<p class="muted">${t('sessions.empty')}</p>`,
    );
  };

  const load = async () => {
    try {
      sessions = await api.sessions.list({ limit: 50 });
      renderCurrent();
      renderHistory();
    } catch (e) {
      toastError(e);
    }
  };

  void load();
  const stop = api.events.subscribe((e) => {
    if (e.type === 'session-changed') void load();
  });
  return { el, destroy: stop };
};
