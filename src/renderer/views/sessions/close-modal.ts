import type { SessionCloseResult, SessionDto } from '@shared/types';
import { dec, isDecimalString, toQtyString } from '@shared/utils/decimal';
import { api } from '../../api';
import { formError } from '../../components/forms';
import { openModal } from '../../components/modal';
import { errorMessage, toast } from '../../components/toast';
import { t } from '../../i18n';
import { appStore } from '../../store/app';
import { html } from '../../ui/html';
import { formatQty, localName, toInputDecimal } from '../../utils/format';
import { button } from '../../components/page';

/**
 * Close the shift: per dish with a leftover, how much carries to the next shift and how much is
 * written off. As in legacy, the two fields are kept in step (carry + write-off = leftover).
 */
export async function closeShiftModal(session: SessionDto): Promise<SessionCloseResult | null> {
  const lang = appStore.get().language;
  const leftovers = session.items.filter((i) => dec(i.remainingQuantity).gt(0));

  const rows = leftovers.map((item) => {
    const remaining = dec(item.remainingQuantity);
    const carry = document.createElement('input');
    const write = document.createElement('input');
    const note = document.createElement('input');
    for (const [input, label] of [
      [carry, t('sessions.carry')],
      [write, t('sessions.writeOff')],
    ] as const) {
      input.type = 'text';
      input.inputMode = 'decimal';
      input.className = 'qty-field';
      input.setAttribute('aria-label', `${label}: ${localName(item, lang)}`);
    }
    note.type = 'text';
    note.className = 'note-field';
    note.maxLength = 200;
    note.setAttribute('aria-label', `${t('sessions.note')}: ${localName(item, lang)}`);
    carry.value = toInputDecimal(item.remainingQuantity);
    write.value = '0';

    const parse = (input: HTMLInputElement) => {
      const v = input.value.trim().replace(',', '.');
      return isDecimalString(v) && !v.startsWith('-') ? dec(v) : null;
    };
    const keepInStep = (changed: HTMLInputElement, other: HTMLInputElement) => {
      const v = parse(changed);
      if (v === null) return;
      const clamped = v.gt(remaining) ? remaining : v;
      if (!clamped.equals(v)) changed.value = toInputDecimal(toQtyString(clamped));
      other.value = toInputDecimal(toQtyString(remaining.minus(clamped)));
    };
    carry.addEventListener('input', () => keepInStep(carry, write));
    write.addEventListener('input', () => keepInStep(write, carry));

    const tr = document.createElement('tr');
    tr.append(
      html`<td class="line-name">${localName(item, lang)}</td>
        <td class="num strong">${formatQty(item.remainingQuantity, lang, item.soldByWeight)}</td>
        <td class="num">${carry}</td>
        <td class="num">${write}</td>
        <td>${note}</td>`,
    );
    return { item, carry, write, note, tr, parse };
  });

  const allTo = (target: 'carry' | 'write') => () => {
    for (const r of rows) {
      r.carry.value = target === 'carry' ? toInputDecimal(r.item.remainingQuantity) : '0';
      r.write.value = target === 'write' ? toInputDecimal(r.item.remainingQuantity) : '0';
    }
  };

  const error = formError();
  const body = leftovers.length
    ? html`<p class="muted">${t('sessions.closeHint')}</p>
        <div class="bulk-actions">
          ${button(t('sessions.allCarry'), 'secondary', allTo('carry'))}${button(
            t('sessions.allWriteOff'),
            'secondary',
            allTo('write'),
          )}
        </div>
        <div class="modal-table">
          <table class="lines-table">
            <thead>
              <tr>
                <th>${t('sessions.dish')}</th>
                <th class="num">${t('sessions.remaining')}</th>
                <th class="num">${t('sessions.carry')}</th>
                <th class="num">${t('sessions.writeOff')}</th>
                <th>${t('sessions.note')}</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((r) => r.tr)}
            </tbody>
          </table>
        </div>
        ${error}`
    : html`<p class="notice notice-info">${t('sessions.noLeftovers')}</p>
        ${error}`;

  let result: SessionCloseResult | null = null;
  const modal = openModal({
    title: t('sessions.closeTitle'),
    body,
    size: 'lg',
    actions: [
      { label: t('app.cancel') },
      {
        label: t('sessions.close'),
        kind: 'danger',
        onClick: async () => {
          error.textContent = '';
          const actions = [];
          for (const r of rows) {
            const carry = r.parse(r.carry);
            const write = r.parse(r.write);
            if (!carry || !write || carry.plus(write).gt(r.item.remainingQuantity)) {
              (carry ? r.write : r.carry).setAttribute('aria-invalid', 'true');
              error.textContent = t('sessions.invalidQty');
              return false;
            }
            actions.push({
              menuItemId: r.item.menuItemId,
              carryQuantity: toQtyString(carry),
              writeOffQuantity: toQtyString(write),
              note: r.note.value.trim(),
            });
          }
          try {
            result = await api.sessions.close({ sessionId: session.id, actions });
            toast(
              t('sessions.closedToast', {
                carried: result.carried.length,
                written: result.writtenOff.length,
              }),
              'success',
            );
          } catch (e) {
            error.textContent = errorMessage(e);
            return false;
          }
        },
      },
    ],
  });
  await modal.closed;
  return result;
}
