import { LICENSE_FEATURES, type LicenseStatusDto } from '@shared/license';
import { formatDate, formatDateTime } from '@shared/utils/format';
import { formatPhone } from '@shared/utils/phone';
import { api } from '../../api';
import { dec } from '@shared/utils/decimal';
import { linkRestaurant } from '../../components/link-restaurant';
import { payBillModal, upcomingCharge } from '../../components/pay-bill';
import { button, pageHeader } from '../../components/page';
import { toast, toastError } from '../../components/toast';
import { t } from '../../i18n';
import { appStore } from '../../store/app';
import { html } from '../../ui/html';
import { icon } from '../../ui/icons';
import { formatMoney } from '../../utils/format';
import type { View } from '../types';

/**
 * Settings → Obuna (feature F5): the restaurant this till belongs to, its plan and what it
 * includes, where the subscription stands, the 14-day check-in, how to pay, and linking.
 * Main decides all of it (main/license); this only shows `license:status`.
 */
export const subscriptionSection: View = () => {
  const el = document.createElement('section');
  el.className = 'page';
  const body = document.createElement('div');
  el.append(pageHeader(t('license.sectionTitle')), body);
  let link: { destroy(): void } | null = null;
  let relinkOpen = false;

  const row = (label: string, value: string | Node) =>
    html`<div class="meta-row"><span class="muted">${label}</span><strong>${value}</strong></div>`;

  const statusCard = (s: LicenseStatusDto) => {
    const checkButton = button(t('license.checkNow'), 'secondary', async () => {
      checkButton.disabled = true;
      try {
        const fresh = await api.license.checkNow();
        appStore.set({ license: fresh });
        if (!fresh.lastError) toast(t('license.checked'), 'success');
      } catch (error) {
        toastError(error);
      } finally {
        checkButton.disabled = false;
      }
    });
    const readonly = s.mode === 'readonly';
    const features = document.createElement('ul');
    features.className = 'license-features';
    for (const f of LICENSE_FEATURES) {
      const on = s.features.includes(f);
      features.append(
        html`<li class="badge ${on ? 'badge-success' : 'badge-muted'}">
          ${icon(on ? 'check' : 'close', 14)}${t(`license.feature.${f}`)}
        </li>`,
      );
    }
    return html`<div class="card form-card">
      ${s.storeName ? html`<h2>${s.storeName}</h2>` : ''}
      <p
        class="notice ${readonly
          ? 'notice-warning'
          : s.reason === 'warning' || s.reason === 'grace'
            ? 'notice-warning'
            : 'notice-info'}"
      >
        ${t(`license.reason.${s.reason}`)}${s.daysLeft !== null && s.daysLeft > 0
          ? ` · ${t('license.daysLeft', { n: s.daysLeft })}`
          : ''}
      </p>
      ${s.plan ? row(t('license.plan'), t(`license.planNames.${s.plan}`)) : ''}
      ${s.trialEndsAt ? row(t('license.trialEnds'), formatDate(s.trialEndsAt)) : ''}
      ${s.expiresAt && !s.trialEndsAt ? row(t('license.paidUntil'), formatDate(s.expiresAt)) : ''}
      ${s.lastCheckinAt ? row(t('license.lastCheckin'), formatDateTime(s.lastCheckinAt)) : ''}
      ${s.checkinBy ? row(t('license.checkinBy'), formatDate(s.checkinBy)) : ''}
      ${row(t('license.tillId'), s.terminalId.slice(0, 8))}
      ${s.lastError
        ? html`<p class="notice notice-warning">
            ${t('license.lastError', { error: s.lastError })}
          </p>`
        : ''}
      <h3>${t('license.features')}</h3>
      ${features}
      <div class="form-actions">${s.linked ? checkButton : ''}</div>
    </div>`;
  };

  /** Balance, bill and the latest top-ups and charges (feature F7), as of the last check-in. */
  const accountCard = (s: LicenseStatusDto) => {
    const lang = appStore.get().language;
    const m = (v: string) => formatMoney(v, lang);
    const a = s.account;
    const pay = button(t('bill.pay'), 'primary', () => payBillModal(s));
    const negative = a !== null && dec(a.balance).lt(0);
    const next = upcomingCharge(s);
    return html`<div class="card form-card">
      <h3>${t('bill.title')}</h3>
      ${a
        ? html`<div class="stat-row bill-tiles">
              <div class="stat-tile is-strong ${negative ? 'is-negative' : ''}">
                <span class="stat-label">${t('bill.balance')}</span>
                <strong class="stat-value">${m(a.balance)}</strong>
              </div>
              ${dec(a.owed).gt(0)
                ? html`<div class="stat-tile is-strong is-negative">
                    <span class="stat-label">${t('bill.owed')}</span>
                    <strong class="stat-value">${m(a.owed)}</strong>
                  </div>`
                : ''}
              ${a.monthlyFee !== null
                ? html`<div class="stat-tile">
                    <span class="stat-label">${t('bill.monthlyFee')}</span>
                    <strong class="stat-value">${m(a.monthlyFee)}</strong>
                  </div>`
                : ''}
              ${next
                ? html`<div class="stat-tile">
                    <span class="stat-label">${t('bill.nextChargeAt')}</span>
                    <strong class="stat-value">${formatDate(next)}</strong>
                  </div>`
                : ''}
            </div>
            <p class="muted small">${t('bill.asOf', { time: formatDateTime(a.asOf) })}</p>
            ${a.movements.length
              ? html`<div class="table-wrap">
                  <table class="lines-table bill-movements">
                    <thead>
                      <tr>
                        <th>${t('bill.date')}</th>
                        <th>${t('bill.what')}</th>
                        <th class="num">${t('bill.amount')}</th>
                        <th class="num">${t('bill.balanceAfter')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${a.movements.map(
                        (mv) =>
                          html`<tr>
                            <td>${formatDateTime(mv.at)}</td>
                            <td>${t(`bill.type.${mv.type}`)}</td>
                            <td
                              class="num strong ${dec(mv.amount).lt(0)
                                ? 'is-negative'
                                : 'is-positive'}"
                            >
                              ${dec(mv.amount).gt(0) ? '+' : ''}${m(mv.amount)}
                            </td>
                            <td class="num">${m(mv.balanceAfter)}</td>
                          </tr>`,
                      )}
                    </tbody>
                  </table>
                </div>`
              : html`<p class="muted small">${t('bill.noMovements')}</p>`}`
        : html`<p class="muted small">${t('bill.notYet')}</p>`}
      ${s.payment?.supportPhone
        ? row(t('license.support'), formatPhone(s.payment.supportPhone))
        : ''}
      <div class="form-actions">${pay}</div>
    </div>`;
  };

  const linkCard = (s: LicenseStatusDto) => {
    const card = document.createElement('div');
    card.className = 'card form-card';
    const open = () => {
      link?.destroy();
      const linker = linkRestaurant({
        restaurantName: appStore.get().receipt?.restaurantName,
        onLinked: (status) => {
          appStore.set({ license: status });
          toast(t('license.linked', { name: status.storeName ?? '' }), 'success');
          relinkOpen = false;
          render();
        },
      });
      link = linker;
      card.replaceChildren(
        html`<h3>${s.linked ? t('license.relink') : t('license.linkTitle')}</h3>`,
        linker.el,
      );
    };
    if (!s.linked || relinkOpen) {
      open();
    } else {
      card.append(
        html`<p class="muted small">${t('license.relinkHint')}</p>`,
        button(t('license.relink'), 'ghost', () => {
          relinkOpen = true;
          open();
        }),
      );
    }
    return card;
  };

  const render = () => {
    const s = appStore.get().license;
    link?.destroy();
    link = null;
    if (!s) {
      body.replaceChildren(html`<p class="muted">${t('app.loading')}</p>`);
      return;
    }
    if (!s.linked) {
      body.replaceChildren(
        html`<p class="notice notice-warning">${t(`license.reason.${s.reason}`)}</p>`,
        linkCard(s),
      );
      return;
    }
    body.replaceChildren(statusCard(s), accountCard(s), linkCard(s));
  };

  render();
  const stop = appStore.subscribe((s, prev) => {
    // While the owner is typing in the link form, a background check-in must not wipe it.
    if (s.license === prev.license) return;
    if (
      !link ||
      s.license?.linked !== prev.license?.linked ||
      s.license?.storeId !== prev.license?.storeId
    )
      render();
  });
  void api.license
    .status()
    .then((license) => appStore.set({ license }))
    .catch(toastError);

  return {
    el,
    destroy: () => {
      stop();
      link?.destroy();
    },
  };
};
