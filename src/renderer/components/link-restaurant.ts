import type { LicensePlansDto, LicenseStatusDto } from '@shared/license';
import { formatMoney } from '@shared/utils/format';
import { api } from '../api';
import { appStore } from '../store/app';
import { t } from '../i18n';
import { html } from '../ui/html';
import { qrSvg } from '../ui/qr';
import { clearErrors, field, showFormError, value } from './forms';
import { phoneField } from './phone-field';

/**
 * Linking this till to its restaurant on the posgro server (feature F5): a new restaurant signs up
 * (phone proved through the Telegram bot, 14-day trial), an existing one links with the phone and
 * an activation code from the super admin. Used by the setup wizard and Settings → Obuna.
 */
export function linkRestaurant(options: {
  onLinked(status: LicenseStatusDto): void;
  /** Prefills the sign-up form (the setup wizard's restaurant name). */
  restaurantName?: string;
}): { el: HTMLElement; destroy(): void } {
  const el = document.createElement('div');
  el.className = 'link-restaurant';
  let pollTimer: number | undefined;
  const stopPolling = () => window.clearInterval(pollTimer);

  const tabs = document.createElement('div');
  tabs.className = 'segmented link-tabs';
  tabs.setAttribute('role', 'radiogroup');
  const body = document.createElement('div');
  const tabButton = (label: string, onPick: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.textContent = label;
    b.addEventListener('click', () => {
      for (const x of tabs.children) x.setAttribute('aria-checked', String(x === b));
      stopPolling();
      onPick();
    });
    return b;
  };
  const newTab = tabButton(t('license.tabNew'), () => void renderNew());
  const existingTab = tabButton(t('license.tabExisting'), renderExisting);
  tabs.append(newTab, existingTab);
  el.append(tabs, body);

  // ── New restaurant ─────────────────────────────────────────────────────────────────────────

  const planCards = (plans: LicensePlansDto) => {
    const wrap = document.createElement('div');
    wrap.className = 'plan-cards';
    for (const p of plans.plans) {
      const price =
        p.price > 0
          ? `${formatMoney(p.price, appStore.get().language, false)} ${t(p.period === 'once' ? 'license.once' : 'license.perMonth')}`
          : t('license.priceLater');
      const features = p.features.length
        ? p.features.map((f) => t(`license.feature.${f}`)).join(', ')
        : '—';
      wrap.append(
        html`<div class="plan-card">
          <strong>${p.label}</strong>
          <span class="plan-price">${price}</span>
          <span class="muted small"
            >${p.terminals === null
              ? t('license.tillsUnlimited')
              : t('license.tills', { n: p.terminals })}</span
          >
          <span class="small">${features}</span>
        </div>`,
      );
    }
    return wrap;
  };

  async function renderNew(): Promise<void> {
    body.replaceChildren(html`<p class="muted">${t('app.loading')}</p>`);
    let plans: LicensePlansDto;
    try {
      plans = await api.license.plans();
    } catch {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn btn-secondary';
      retry.textContent = t('license.retry');
      retry.addEventListener('click', () => void renderNew());
      body.replaceChildren(
        html`<div class="notice notice-warning">${t('license.offline')}</div>`,
        retry,
      );
      return;
    }

    const phone = phoneField({ name: 'phone', label: t('license.phone') });
    const form = document.createElement('form');
    form.noValidate = true;
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn btn-primary btn-block';
    submit.textContent = t('license.verifyByTelegram');
    form.append(
      html`${plans.trial.enabled
          ? html`<p class="notice notice-success">
              ${t('license.trialNote', { days: plans.trial.days })}
            </p>`
          : ''}
        ${planCards(plans)}
        ${field({
          name: 'restaurantName',
          label: t('license.restaurantName'),
          required: true,
          value: options.restaurantName ?? '',
        })}
        ${field({
          name: 'ownerName',
          label: t('license.ownerName'),
          required: true,
          autocomplete: 'name',
        })}
        ${phone.el} ${field({ name: 'address', label: t('license.address') })}
        <p class="muted small">${t('license.privacy')}</p>
        <div class="form-error" role="alert"></div>
        ${submit}`,
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(form);
      submit.disabled = true;
      try {
        const started = await api.license.signupStart({ phone: phone.input.value });
        renderVerify(started, {
          restaurantName: value(form, 'restaurantName'),
          ownerName: value(form, 'ownerName'),
          address: value(form, 'address') || undefined,
        });
      } catch (error) {
        showFormError(form, error);
      } finally {
        submit.disabled = false;
      }
    });
    body.replaceChildren(form);
  }

  function renderVerify(
    started: { verificationId: string; botLink: string | null },
    details: { restaurantName: string; ownerName: string; address?: string },
  ): void {
    const status = document.createElement('p');
    status.className = 'muted';
    status.setAttribute('role', 'status');
    status.textContent = started.botLink ? t('license.waitingContact') : t('license.telegramNoBot');

    const form = document.createElement('form');
    form.noValidate = true;
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn btn-primary btn-block';
    submit.textContent = t('license.finish');
    const restart = document.createElement('button');
    restart.type = 'button';
    restart.className = 'btn btn-ghost btn-block';
    restart.textContent = t('license.restart');
    restart.addEventListener('click', () => {
      stopPolling();
      void renderNew();
    });

    const qr = document.createElement('div');
    qr.className = 'telegram-qr';
    if (started.botLink) {
      const link = document.createElement('code');
      link.className = 'telegram-link';
      link.textContent = started.botLink;
      try {
        qr.append(qrSvg(started.botLink, 200));
      } catch {
        // No QR for a link it cannot encode: the link itself is still there to open.
      }
      qr.append(link);
    }
    form.append(
      html`<p>${t('license.telegramSteps')}</p>`,
      qr,
      status,
      field({
        name: 'code',
        label: t('license.code'),
        required: true,
        inputmode: 'numeric',
        autocomplete: 'one-time-code',
      }),
      html`<div class="form-error" role="alert"></div>`,
      submit,
      restart,
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(form);
      submit.disabled = true;
      try {
        const linked = await api.license.signupComplete({
          verificationId: started.verificationId,
          code: value(form, 'code'),
          ...details,
        });
        stopPolling();
        options.onLinked(linked);
      } catch (error) {
        showFormError(form, error);
      } finally {
        submit.disabled = false;
      }
    });
    body.replaceChildren(form);

    if (started.botLink) {
      stopPolling();
      pollTimer = window.setInterval(async () => {
        try {
          const s = await api.license.signupStatus({ verificationId: started.verificationId });
          if (s.expired) {
            status.textContent = t('license.expired');
            stopPolling();
          } else if (s.contactConfirmed) {
            status.textContent = t('license.codeSent');
            status.className = 'notice notice-success';
            stopPolling();
            form.querySelector<HTMLInputElement>('[name=code]')?.focus();
          }
        } catch {
          // Offline for a moment: the next tick tries again.
        }
      }, 3000);
    }
  }

  // ── Existing restaurant ────────────────────────────────────────────────────────────────────

  function renderExisting(): void {
    const phone = phoneField({ name: 'phone', label: t('license.phone') });
    const form = document.createElement('form');
    form.noValidate = true;
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn btn-primary btn-block';
    submit.textContent = t('license.activate');
    form.append(
      html`<p class="muted small">${t('license.activationHint')}</p>
        ${phone.el}
        ${field({
          name: 'activationCode',
          label: t('license.activationCode'),
          required: true,
          autocomplete: 'off',
        })}
        <div class="form-error" role="alert"></div>
        ${submit}`,
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(form);
      submit.disabled = true;
      try {
        options.onLinked(
          await api.license.activate({
            phone: phone.input.value,
            activationCode: value(form, 'activationCode'),
          }),
        );
      } catch (error) {
        showFormError(form, error);
      } finally {
        submit.disabled = false;
      }
    });
    body.replaceChildren(form);
  }

  newTab.click();
  return { el, destroy: stopPolling };
}
