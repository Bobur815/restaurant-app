import type { SessionCloseResult, SessionDto } from '@shared/types';
import { dec, isDecimalString, toQtyString } from '@shared/utils/decimal';
import { api } from '../../api';
import { formError } from '../../components/forms';
import { openModal } from '../../components/modal';
import { errorMessage, toast } from '../../components/toast';
import { t } from '../../i18n';
import { appStore } from '../../store/app';
import { html } from '../../ui/html';
import { formatMoney, formatQty, localName, toInputDecimal } from '../../utils/format';
import { button } from '../../components/page';
import { differenceText, moneyIn, printShiftReport } from './cash-panel';

/**
 * Close the shift: the cash counted in the drawer (feature F6: expected and shortage/overage shown
 * as it is typed, Z-report printed after the close), then per dish with a leftover how much
 * carries to the next shift and how much is written off. As in legacy, the two fields are kept in
 * step (carry + write-off = leftover). Unlimited (∞) dishes have no leftover.
 */
export async function closeShiftModal(session: SessionDto): Promise<SessionCloseResult | null> {
  const lang = appStore.get().language;
  const leftovers = session.items.filter((i) => !i.unlimited && dec(i.remainingQuantity).gt(0));
  const summary = await api.sessions.cashSummary({ id: session.id });

  // ── the drawer ─────────────────────────────────────────────────────────────────────────────
  const counted = document.createElement('input');
  counted.type = 'text';
  counted.inputMode = 'decimal';
  counted.id = 'counted-cash';
  counted.className = 'counted-cash';
  const diffLine = document.createElement('p');
  diffLine.className = 'cash-diff';
  diffLine.setAttribute('role', 'status');
  const renderDiff = () => {
    const raw = moneyIn(counted.value);
    if (!raw || !isDecimalString(raw) || raw.startsWith('-')) {
      diffLine.textContent = '';
      diffLine.className = 'cash-diff';
      return;
    }
    const d = differenceText(dec(raw).minus(summary.expectedCash).toFixed());
    diffLine.textContent = `${d.label}: ${d.text}`;
    diffLine.className = `cash-diff ${d.cls}`;
  };
  counted.addEventListener('input', renderDiff);
  const printZ = document.createElement('input');
  printZ.type = 'checkbox';
  printZ.checked = true;
  const drawer = html`<div class="close-cash">
    <div class="close-cash-expected">
      <span class="muted">${t('cash.expected')}</span>
      <strong>${formatMoney(summary.expectedCash, lang)}</strong>
    </div>
    <div class="field">
      <label for="counted-cash">${t('cash.countedField')}</label>
      ${counted}
    </div>
    ${diffLine}
    <label class="check-field">${printZ}<span>${t('cash.printZ')}</span></label>
  </div>`;

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
    ? html`${drawer}
        <h3 class="section-title">${t('sessions.leftoversTitle')}</h3>
        <p class="muted">${t('sessions.closeHint')}</p>
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
    : html`${drawer}
        <p class="notice notice-info">${t('sessions.noLeftovers')}</p>
        ${error}`;

  let result: SessionCloseResult | null = null;
  const modal = openModal({
    title: t('sessions.closeTitle'),
    body,
    size: 'lg',
    initialFocus: () => counted,
    actions: [
      { label: t('app.cancel') },
      {
        label: t('sessions.close'),
        kind: 'danger',
        onClick: async () => {
          error.textContent = '';
          counted.removeAttribute('aria-invalid');
          const countedCash = moneyIn(counted.value);
          if (!countedCash || !isDecimalString(countedCash) || countedCash.startsWith('-')) {
            counted.setAttribute('aria-invalid', 'true');
            error.textContent = t('cash.countedRequired');
            counted.focus();
            return false;
          }
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
            result = await api.sessions.close({ sessionId: session.id, countedCash, actions });
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
  // The Z-report never holds up the close: a printer problem is only a toast.
  if (result && printZ.checked) void printShiftReport(session.id, 'Z');
  return result;
}
