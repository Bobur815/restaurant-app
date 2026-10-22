import type { LicenseStatusDto } from '@shared/license';
import { dec } from '@shared/utils/decimal';
import { formatDate } from '@shared/utils/format';
import { formatPhone } from '@shared/utils/phone';
import { api } from '../api';
import { t } from '../i18n';
import { appStore } from '../store/app';
import { html } from '../ui/html';
import { qrSvg } from '../ui/qr';
import { formatMoney } from '../utils/format';
import { openModal } from './modal';
import { toast, toastError } from './toast';

/** Something to pay with: a QR, a link or a phone (feature F7). */
export function canPayBill(s: LicenseStatusDto | null): boolean {
  return !!s?.linked && !!s.storeId;
}

/** The next fee's date, only while it is still ahead (an owed charge's date has passed). */
export function upcomingCharge(s: LicenseStatusDto, now = Date.now()): string | null {
  const at = s.account?.nextChargeAt;
  return at && Date.parse(at) > now ? at : null;
}

/** What to pay now: the unpaid charge, else the plan's monthly fee, else nothing known. */
export function amountToPay(s: LicenseStatusDto): { label: string; amount: string } | null {
  const a = s.account;
  if (!a) return null;
  if (dec(a.owed).gt(0)) return { label: t('bill.owed'), amount: a.owed };
  if (a.monthlyFee !== null && dec(a.monthlyFee).gt(0))
    return { label: t('bill.monthlyFee'), amount: a.monthlyFee };
  return null;
}

/** "1234123412341234" as "1234 1234 1234 1234". */
export function groupCardNumber(n: string): string {
  return n.replace(/(\d{4})(?=\d)/g, '$1 ');
}

/**
 * "To'lash": how to pay the monthly bill. Payments are confirmed by hand on the server (the
 * restaurant's ID in the payment note), so the window says what to write and to check in after.
 * The link is shown and drawn as a QR, never opened by the app. With a card to transfer to
 * (feature F8) there are two numbered ways side by side: QR / link, and the card.
 */
export function payBillModal(s: LicenseStatusDto): void {
  const lang = appStore.get().language;
  const p = s.payment;
  const card = p?.card ?? null;
  const qrText = p?.qrPayload || p?.paymentUrl || '';
  // Without a card the first way is shown as before, even with nothing but a phone.
  const showFirst = !!qrText || !card;
  const both = !!qrText && !!card;
  const due = amountToPay(s);
  const next = upcomingCharge(s);

  const body = document.createElement('div');
  body.className = 'pay-bill';
  const qr = qrText ? qrSvg(qrText, 220) : null;
  qr?.setAttribute('aria-label', t('bill.qrLabel'));

  body.append(
    html`${due
        ? html`<div class="pay-bill-amount">
            <span>${due.label}</span><strong>${formatMoney(due.amount, lang)}</strong>
          </div>`
        : ''}
      <div class="${both ? 'pay-bill-options pay-bill-options-two' : 'pay-bill-options'}">
        ${showFirst
          ? html`<section class="pay-bill-option">
              ${both ? html`<h3 class="pay-bill-option-title">${t('bill.optionQr')}</h3>` : ''}
              <div class="pay-bill-main">
                ${qr
                  ? html`<figure class="pay-bill-qr">
                      ${qr}
                      <figcaption class="muted small">
                        ${t(p?.qrPayload ? 'bill.scanBank' : 'bill.scanLink')}
                        ${p?.qrPayload
                          ? html`<code class="pay-bill-qr-text">${p.qrPayload}</code>`
                          : ''}
                      </figcaption>
                    </figure>`
                  : ''}
                <div class="pay-bill-steps">
                  <p class="pay-bill-note">
                    ${t('bill.writeId')}
                    <strong class="pay-bill-id">${s.storeId ?? ''}</strong>
                  </p>
                  ${p?.paymentUrl
                    ? html`<p>
                        <span class="muted small">${t('license.payUrl')}</span><br />
                        <code class="telegram-link">${p.paymentUrl}</code>
                      </p>`
                    : ''}
                </div>
              </div>
            </section>`
          : ''}
        ${card
          ? html`<section class="pay-bill-option pay-bill-card">
              ${both ? html`<h3 class="pay-bill-option-title">${t('bill.optionCard')}</h3>` : ''}
              ${card.image
                ? html`<img
                    class="pay-bill-card-image"
                    src="${`savdochef-img://img/${encodeURIComponent(card.image)}`}"
                    alt="${t('bill.cardNumber')}"
                  />`
                : ''}
              <p>
                <span class="muted small">${t('bill.cardNumber')}</span><br />
                <strong class="pay-bill-card-number">${groupCardNumber(card.number)}</strong>
              </p>
              ${card.holder
                ? html`<p>
                    <span class="muted small">${t('bill.cardHolder')}</span><br />
                    <strong>${card.holder}</strong>
                  </p>`
                : ''}
              <p class="pay-bill-note">
                ${t('bill.cardWriteId')}
                <strong class="pay-bill-id">${s.storeId ?? ''}</strong>
              </p>
            </section>`
          : ''}
      </div>
      <div class="pay-bill-steps">
        ${p?.supportPhone
          ? html`<p>
              <span class="muted small">${t('license.support')}</span><br />
              <strong>${formatPhone(p.supportPhone)}</strong>
            </p>`
          : ''}
        ${!qrText && !card && !p?.supportPhone
          ? html`<p class="notice notice-warning">${t('bill.noDetails')}</p>`
          : ''}
        ${next
          ? html`<p class="muted small">${t('bill.nextCharge', { date: formatDate(next) })}</p>`
          : ''}
        <p class="muted small">${t('bill.afterPaying')}</p>
      </div>`,
  );

  openModal({
    title: t('bill.title'),
    body,
    size: both ? 'lg' : 'md',
    actions: [
      { label: t('app.close') },
      {
        label: t('license.checkNow'),
        kind: 'primary',
        onClick: async () => {
          try {
            const fresh = await api.license.checkNow();
            appStore.set({ license: fresh });
            if (!fresh.lastError) toast(t('license.checked'), 'success');
            else toast(t('license.lastError', { error: fresh.lastError }), 'error', 8000);
          } catch (error) {
            toastError(error);
          }
          return false; // stays open: the cashier may still be paying
        },
      },
    ],
  });
}
