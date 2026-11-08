import type { LanStatusDto } from '@shared/types';
import { formatDateTime } from '@shared/utils/format';
import { api } from '../../api';
import {
  checkboxField,
  checked,
  clearErrors,
  field,
  formError,
  showFormError,
  value,
} from '../../components/forms';
import { leaveMain } from '../../components/lan-link';
import { confirmDialog } from '../../components/modal';
import { button, pageHeader } from '../../components/page';
import { toast, toastError } from '../../components/toast';
import { t } from '../../i18n';
import { appStore } from '../../store/app';
import { html } from '../../ui/html';
import type { View } from '../types';
import { submitButton } from './settings-ui';

/**
 * Feature F12: the till network. On the main till: switch satellites on, the port, this
 * computer's address (for the satellite's form) and the firewall command, a pairing code, and the
 * paired satellites with "Ajratish". On a satellite: its main till and "leave".
 */
export const lanSection: View = () => {
  const el = document.createElement('section');
  el.className = 'page';
  const body = document.createElement('div');
  el.append(pageHeader(t('settings.sectionLan')), body);
  let countdown: number | null = null;

  const satelliteView = () => {
    const link = appStore.get().lan!;
    const leave = button(t('lan.leave'), 'danger', () => void leaveMain());
    body.replaceChildren(
      html`<div class="card form-card">
        <h2 class="card-title">${t('lan.satelliteTitle')}</h2>
        <p class="muted small">${t('lan.satelliteHint')}</p>
        <dl class="kv">
          <dt>${t('lan.mainAddressShort')}</dt>
          <dd>${link.mainUrl ?? ''}</dd>
          <dt>${t('lan.state')}</dt>
          <dd>${t(`lan.state_${link.state ?? 'connecting'}`)}</dd>
          <dt>${t('lan.mainVersion')}</dt>
          <dd>${link.mainVersion ?? '—'}</dd>
        </dl>
        <div class="bulk-actions">${leave}</div>
      </div>`,
    );
  };

  const mainView = (s: LanStatusDto) => {
    if (countdown) window.clearInterval(countdown);
    countdown = null;

    const form = document.createElement('form');
    form.className = 'card form-card';
    form.noValidate = true;
    const port = String(s.port);
    const firewall = `New-NetFirewallRule -DisplayName "SavdoChef yoldosh kassalar" -Direction Inbound -Protocol TCP -LocalPort ${port} -Action Allow -Profile Private -RemoteAddress LocalSubnet`;
    form.append(
      html`<h2 class="card-title">${t('lan.mainTitle')}</h2>
        <p class="muted small">${t('lan.mainHint')}</p>
        ${checkboxField({ name: 'enabled', label: t('lan.enabled'), checked: s.enabled })}
        ${field({
          name: 'port',
          label: t('lan.port'),
          type: 'number',
          value: port,
          min: 1024,
          max: 65535,
          inputmode: 'numeric',
        })}
        <p class="${s.serving ? 'notice notice-success' : 'notice notice-info'}">
          ${s.error ?? (s.serving ? t('lan.serving') : s.enabled ? t('lan.idle') : t('lan.off'))}
        </p>
        <p class="small">
          ${t('lan.addresses')}:
          <strong>${s.addresses.length ? s.addresses.join(', ') : t('lan.noAddress')}</strong>
        </p>
        <details class="small">
          <summary>${t('lan.firewall')}</summary>
          <p class="muted">${t('lan.firewallHint')}</p>
          <code class="code-block">${firewall}</code>
          <p class="muted">${t('lan.firewallRemove')}</p>
          <code class="code-block"
            >Remove-NetFirewallRule -DisplayName "SavdoChef yoldosh kassalar"</code
          >
        </details>
        ${formError()}
        <div class="bulk-actions">${submitButton()}</div>`,
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(form);
      try {
        const next = await api.lan.update({
          enabled: checked(form, 'enabled'),
          port: Number(value(form, 'port')) || s.port,
        });
        toast(t('settings.saved'), 'success');
        mainView(next);
      } catch (error) {
        showFormError(form, error);
      }
    });

    const pairCard = document.createElement('div');
    pairCard.className = 'card';
    if (s.pairing) {
      const left = html`<span class="muted small"></span>`.firstElementChild as HTMLElement;
      const tick = () => {
        const ms = Date.parse(s.pairing!.expiresAt) - Date.now();
        if (ms <= 0) return void load();
        const m = Math.floor(ms / 60000);
        const sec = Math.floor((ms % 60000) / 1000);
        left.textContent = t('lan.codeExpires', { time: `${m}:${String(sec).padStart(2, '0')}` });
      };
      tick();
      countdown = window.setInterval(tick, 1000);
      const cancel = button(t('lan.cancelCode'), 'secondary', async () => {
        try {
          mainView(await api.lan.cancelPairing());
        } catch (error) {
          toastError(error);
        }
      });
      pairCard.append(
        html`<h2 class="card-title">${t('lan.pairTitle')}</h2>
          <p class="muted small">${t('lan.pairSteps', { address: s.addresses[0] ?? '…' })}</p>
          <div class="pair-code" aria-live="polite">${s.pairing.code}</div>`,
        left,
        html`<div class="bulk-actions">${cancel}</div>`,
      );
    } else {
      const get = button(t('lan.getCode'), 'primary', async () => {
        try {
          mainView(await api.lan.pairingCode());
        } catch (error) {
          toastError(error);
        }
      });
      get.disabled = !s.enabled;
      pairCard.append(
        html`<h2 class="card-title">${t('lan.pairTitle')}</h2>
          <p class="muted small">${s.enabled ? t('lan.pairHint') : t('lan.enableFirst')}</p>
          ${s.deviceLimit !== null
            ? html`<p class="muted small">${t('lan.limit', { count: s.deviceLimit })}</p>`
            : ''}
          <div class="bulk-actions">${get}</div>`,
      );
    }

    const devicesCard = document.createElement('div');
    devicesCard.className = 'card';
    const rows = s.devices.map((d) => {
      const tr = document.createElement('tr');
      if (d.revoked) tr.className = 'is-inactive';
      const actions = document.createElement('td');
      actions.className = 'row-actions';
      if (!d.revoked) {
        actions.append(
          button(t('lan.revoke'), 'ghost', async () => {
            const ok = await confirmDialog({
              title: t('lan.revoke'),
              message: t('lan.revokeConfirm', { name: d.name }),
              danger: true,
            });
            if (!ok) return;
            try {
              mainView(await api.lan.revoke({ deviceId: d.id }));
            } catch (error) {
              toastError(error);
            }
          }),
        );
      }
      tr.append(
        html`<td class="strong">${d.name}</td>
          <td>${d.lastIp ?? '—'}</td>
          <td>${d.lastSeenAt ? formatDateTime(d.lastSeenAt) : '—'}</td>
          <td>
            ${d.revoked ? html`<span class="badge badge-muted">${t('lan.revoked')}</span>` : ''}
          </td>`,
        actions,
      );
      return tr;
    });
    devicesCard.append(
      html`<h2 class="card-title">${t('lan.devicesTitle')}</h2>
        ${s.devices.length === 0
          ? html`<p class="muted empty-inline">${t('lan.noDevices')}</p>`
          : html`<table class="lines-table">
              <thead>
                <tr>
                  <th>${t('lan.deviceName')}</th>
                  <th>${t('lan.deviceIp')}</th>
                  <th>${t('lan.lastSeen')}</th>
                  <th></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>`}`,
    );
    body.replaceChildren(form, pairCard, devicesCard);
  };

  const load = async () => {
    if (appStore.get().lan?.role === 'satellite') return satelliteView();
    try {
      mainView(await api.lan.status());
    } catch (error) {
      toastError(error);
    }
  };

  void load();
  const stop = api.events.subscribe((e) => {
    // A satellite follows the store, which lan-link.ts refreshes on the same event.
    if (e.type === 'lan-changed' && appStore.get().lan?.role !== 'satellite') void load();
  });
  const stopStore = appStore.subscribe((st, prev) => {
    if (st.lan !== prev.lan && st.lan?.role === 'satellite') satelliteView();
  });
  return {
    el,
    destroy: () => {
      stop();
      stopStore();
      if (countdown) window.clearInterval(countdown);
    },
  };
};
