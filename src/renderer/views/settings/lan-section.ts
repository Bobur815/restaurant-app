import type { LanDeviceDto, LanStatusDto } from '@shared/types';
import { formatAgo } from '@shared/utils/format';
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
import { withInfo } from '../../components/info-hint';
import { leaveMain } from '../../components/lan-link';
import { confirmDialog } from '../../components/modal';
import { button, pageHeader } from '../../components/page';
import { toast, toastError } from '../../components/toast';
import { currentLanguage, t } from '../../i18n';
import { appStore } from '../../store/app';
import { html } from '../../ui/html';
import { icon } from '../../ui/icons';
import type { View } from '../types';
import { openPairModal, type PairModal } from './lan-pair-modal';
import { submitButton } from './settings-ui';

/**
 * Settings -> Yo'ldosh kassalar (F12 satellites, F20 waiter phones; layout from
 * docs/designs/till). On the main till: "Kassa qo'shish" / "Telefon qo'shish (ofitsiant)" open
 * the pairing dialog, the paired devices with their line ("Onlayn" while connected, else how long
 * ago) and "Uzish", and the network settings (switch, port, firewall) folded underneath. On a
 * satellite: its main till and "leave".
 */
export const lanSection: View = () => {
  const el = document.createElement('section');
  el.className = 'page';
  const head = document.createElement('div');
  const body = document.createElement('div');
  el.append(head, body);

  let last: LanStatusDto | null = null;
  let modal: PairModal | null = null;
  /** The network card is rebuilt only when what it shows changes (a phone reconnecting must not wipe a port being typed). */
  let netKey = '';
  let netCard: HTMLDetailsElement | null = null;
  const devicesHost = document.createElement('div');
  /** Header and table are rebuilt only when they change, so a presence event keeps the focus. */
  let headKey = '';
  let devicesKey = '';
  /** Replies to `lan:status` can cross; only the newest request's answer is shown. */
  let requestNo = 0;
  /** The code the owner just cancelled: a late reply still carrying it must not reopen it. */
  let cancelledCode: string | null = null;

  const satelliteView = () => {
    modal?.dismiss();
    modal = null;
    const link = appStore.get().lan!;
    const leave = button(t('lan.leave'), 'danger', () => void leaveMain());
    head.replaceChildren(pageHeader(t('settings.sectionLan')));
    body.replaceChildren(
      html`<div class="card form-card">
        <h2 class="card-title">${withInfo(t('lan.satelliteTitle'), t('lan.satelliteHint'))}</h2>
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

  const pair = async (kind: 'till' | 'waiter') => {
    try {
      show(await api.lan.pairingCode({ kind }));
    } catch (error) {
      toastError(error);
    }
  };

  const cancelCode = async () => {
    try {
      show(await api.lan.cancelPairing());
    } catch (error) {
      toastError(error);
    }
  };

  const unlink = async (d: LanDeviceDto) => {
    const ok = await confirmDialog({
      title: t('lan.unlink'),
      message: t('lan.unlinkConfirm', { name: d.name }),
      confirmLabel: t('lan.unlink'),
      danger: true,
    });
    if (!ok) return;
    try {
      show(await api.lan.revoke({ deviceId: d.id }));
    } catch (error) {
      toastError(error);
    }
  };

  const header = (s: LanStatusDto, tills: number, phones: number) => {
    const tillFull = s.deviceLimit !== null && tills >= s.deviceLimit;
    const addTill = button(t('lan.addTill'), 'secondary', () => void pair('till'));
    addTill.prepend(icon('till', 18));
    addTill.disabled = !s.enabled || tillFull || s.pairing !== null;
    if (!s.enabled) addTill.title = t('lan.enableFirst');
    else if (tillFull) addTill.title = t('lan.limit', { count: s.deviceLimit });

    const phoneFull = phones >= s.waiterLimit;
    const addPhone = button(
      t('lan.addPhone'),
      s.waiterApp ? 'primary' : 'secondary',
      () => void pair('waiter'),
    );
    addPhone.prepend(icon(s.waiterApp ? 'phone' : 'lock', 18));
    addPhone.disabled = !s.waiterApp || !s.enabled || phoneFull || s.pairing !== null;
    if (!s.waiterApp) addPhone.title = t('lan.planBannerTitle');
    else if (!s.enabled) addPhone.title = t('lan.enableFirst');
    else if (phoneFull)
      addPhone.title = t('lan.phoneLimit', { used: phones, limit: s.waiterLimit });

    return html`<header class="page-header lan-header">
      <div>
        <h1>${t('settings.sectionLan')}</h1>
        <p class="lan-subtitle">${t('lan.pageSubtitle')}</p>
      </div>
      <div class="page-actions">${addTill}${addPhone}</div>
    </header>`;
  };

  const planBanner = () => {
    const see = document.createElement('a');
    see.className = 'btn btn-secondary lan-banner-action';
    see.href = '#/settings/subscription';
    see.textContent = t('lan.seePlans');
    return html`<div class="lan-banner" role="note">
      ${icon('lock', 22)}
      <div>
        <p class="lan-banner-title">${t('lan.planBannerTitle')}</p>
        <p>${t('lan.planBannerBody')}</p>
      </div>
      ${see}
    </div>`;
  };

  const lastContact = (d: LanDeviceDto) => {
    if (d.online) return html`<span class="lan-online">${t('lan.online')}</span>`;
    if (!d.lastSeenAt) return '—';
    return formatAgo(d.lastSeenAt, new Date(), currentLanguage());
  };

  const devicesCard = (devices: LanDeviceDto[]) => {
    if (devices.length === 0) {
      return html`<div class="card"><p class="muted empty-inline">${t('lan.noDevices')}</p></div>`;
    }
    const rows = devices.map((d) => {
      const phone = d.kind === 'waiter';
      const sub = phone && d.userName ? t('lan.phoneUser', { name: d.userName }) : d.lastIp;
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'btn btn-ghost lan-unlink';
      action.append(icon('unlink', 18), t('lan.unlink'));
      action.addEventListener('click', () => void unlink(d));
      return html`<tr>
        <td>
          <span class="lan-kind"
            ><span class="lan-kind-tile">${icon(phone ? 'phone' : 'till', 18)}</span>${t(
              phone ? 'lan.kindPhone' : 'lan.kindTill',
            )}</span
          >
        </td>
        <td>
          <span class="lan-name">${d.name}</span>
          ${sub ? html`<span class="lan-sub">${sub}</span>` : ''}
        </td>
        <td class="lan-seen" data-device="${String(d.id)}">${lastContact(d)}</td>
        <td class="row-actions">${action}</td>
      </tr>`;
    });
    return html`<div class="card lan-devices">
      <table class="lines-table lan-table">
        <thead>
          <tr>
            <th>${t('lan.kind')}</th>
            <th>${t('lan.deviceName')}</th>
            <th>${t('lan.lastSeen')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>`;
  };

  const networkCard = (s: LanStatusDto) => {
    const key = JSON.stringify([s.enabled, s.port, s.serving, s.error, s.addresses]);
    if (netCard && key === netKey) return netCard;
    const wasOpen = netCard?.open;
    netKey = key;

    const details = document.createElement('details');
    details.className = 'card lan-net';
    details.open = wasOpen ?? !s.enabled;
    const form = document.createElement('form');
    form.className = 'form-card';
    form.noValidate = true;
    const port = String(s.port);
    const firewall = `New-NetFirewallRule -DisplayName "SavdoChef yoldosh kassalar" -Direction Inbound -Protocol TCP -LocalPort ${port} -Action Allow -Profile Private -RemoteAddress LocalSubnet`;
    form.append(
      html`<p class="muted small">${t('lan.mainHint')}</p>
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
        netCard = null;
        show(next);
      } catch (error) {
        showFormError(form, error);
      }
    });
    details.append(
      html`<summary class="lan-net-summary">
        ${icon('sliders', 18)}${t('lan.netSettings')}
      </summary>`,
      form,
    );
    netCard = details;
    return details;
  };

  /** The pairing dialog follows the till: open while a code is, closed when it is used or gone. */
  const syncModal = (s: LanStatusDto) => {
    if (s.pairing && modal?.code !== s.pairing.code && s.pairing.code !== cancelledCode) {
      modal?.dismiss();
      const code = s.pairing.code;
      modal = openPairModal(s, () => {
        modal = null;
        cancelledCode = code;
        void cancelCode();
      });
    } else if (!s.pairing && modal) {
      modal.dismiss();
      modal = null;
    }
    // A device more than before while a code was open: that code was just used.
    if (last?.pairing && !s.pairing && s.devices.length > last.devices.length) {
      const known = new Set(last.devices.map((d) => d.id));
      const fresh = s.devices.find((d) => !known.has(d.id));
      if (fresh) toast(t('lan.paired', { name: fresh.name }), 'success');
    }
  };

  const show = (s: LanStatusDto) => {
    syncModal(s);
    last = s;
    const devices = s.devices.filter((d) => !d.revoked);
    const tills = devices.filter((d) => d.kind === 'till').length;
    const phones = devices.length - tills;
    const address = s.addresses[0] ? `${s.addresses[0]}:${s.port}` : t('lan.noAddress');

    const hk = JSON.stringify([
      currentLanguage(),
      s.enabled,
      s.waiterApp,
      s.waiterLimit,
      s.deviceLimit,
      s.pairing?.code ?? null,
      tills,
      phones,
    ]);
    if (hk !== headKey) {
      headKey = hk;
      head.replaceChildren(header(s, tills, phones));
    }
    const dk = JSON.stringify(devices);
    if (dk !== devicesKey) {
      devicesKey = dk;
      devicesHost.replaceChildren(devicesCard(devices));
    }
    body.replaceChildren(
      s.waiterApp ? '' : planBanner(),
      s.enabled
        ? ''
        : html`<p class="notice notice-warning">
            ${icon('warning')}<span>${t('lan.enableFirst')}</span>
          </p>`,
      html`<p class="lan-meta">
        <span>${t('lan.thisTill')}: <strong>${t('lan.mainTill')}</strong> · ${address}</span>
        <span>${t('lan.deviceCount', { total: devices.length, tills, phones })}</span>
      </p>`,
      devicesHost,
      networkCard(s),
    );
  };

  const load = async () => {
    if (appStore.get().lan?.role === 'satellite') return satelliteView();
    const mine = ++requestNo;
    try {
      const s = await api.lan.status();
      if (mine === requestNo) show(s);
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
  // "5 daqiqa oldin" moves on by itself.
  // Only the text of those cells changes, so the focus stays where it is.
  const ago = window.setInterval(() => {
    if (!last || appStore.get().lan?.role === 'satellite') return;
    for (const d of last.devices) {
      const cell = devicesHost.querySelector<HTMLElement>(`.lan-seen[data-device="${d.id}"]`);
      if (cell && !d.online && d.lastSeenAt) {
        cell.textContent = formatAgo(d.lastSeenAt, new Date(), currentLanguage());
      }
    }
  }, 30_000);
  return {
    el,
    destroy: () => {
      stop();
      stopStore();
      window.clearInterval(ago);
      // Leaving the page (lock, logout, another section) with the dialog open: the code goes too.
      if (modal) {
        modal.dismiss();
        modal = null;
        void api.lan.cancelPairing().catch(() => undefined);
      }
    },
  };
};
