import { isPrivateIPv4, waiterPairingQrText } from '@shared/lan-waiter';
import type { LanStatusDto } from '@shared/types';
import { openModal } from '../../components/modal';
import { t } from '../../i18n';
import { html } from '../../ui/html';
import { icon } from '../../ui/icons';
import { qrSvg } from '../../ui/qr';

/**
 * F20-T: the pairing dialog of Settings -> Yo'ldosh kassalar (docs/designs/till): a waiter phone
 * gets the QR on the left and the code to type by hand on the right; a till gets the code and
 * the steps only. The code is the main till's; this dialog only shows it and counts it down.
 */

export interface PairModal {
  /** The code this dialog shows. */
  readonly code: string;
  /** Closes it without cancelling the code (it was used, ran out or was cancelled). */
  dismiss(): void;
}

export function openPairModal(s: LanStatusDto, onCancel: () => void): PairModal {
  const pairing = s.pairing!;
  const phone = pairing.kind === 'waiter';
  // Only the shop network's addresses: the phone refuses a QR that points anywhere else.
  const hosts = s.addresses.filter(isPrivateIPv4).slice(0, 8);
  const address = hosts.length ? `${hosts[0]}:${s.port}` : t('lan.noAddress');

  const left = document.createElement('span');
  const tick = () => {
    const ms = Math.max(0, Date.parse(pairing.expiresAt) - Date.now());
    const m = Math.floor(ms / 60000);
    const sec = Math.floor((ms % 60000) / 1000);
    left.textContent = t('lan.codeLeft', { time: `${m}:${String(sec).padStart(2, '0')}` });
  };
  tick();
  const timer = window.setInterval(tick, 1000);

  const boxes = [...pairing.code].map((d) => html`<span class="code-box">${d}</span>`);
  const steps = phone
    ? html`<p class="pair-steps-label">${t('lan.phoneOnPhone')}</p>
        <p class="pair-steps">
          <span class="pair-gear">${icon('settings', 16)}</span>${t('lan.phonePath')}
        </p>`
    : html`<p class="pair-steps-label">${t('lan.tillOnTill')}</p>
        <p class="pair-steps">${t('lan.tillPath')}</p>`;

  const info = html`<div class="pair-info">
    ${steps} ${phone ? html`<p class="pair-divider"><span>${t('lan.orManual')}</span></p>` : ''}
    <p class="pair-label">${t('lan.codeLabel')}</p>
    <div class="code-boxes" aria-live="polite" aria-label="${pairing.code.split('').join(' ')}">
      ${boxes}
    </div>
    <p class="pair-label">${t('lan.phoneAddress')}</p>
    <p class="pair-address">${address}</p>
    <p class="pair-left">${icon('clock', 18)}${left}</p>
  </div>`;

  const body = document.createElement('div');
  body.className = phone ? 'pair-modal' : 'pair-modal pair-modal-till';
  if (phone) {
    const qrTile = document.createElement('div');
    qrTile.className = 'pair-qr-tile';
    if (hosts.length) {
      const qr = qrSvg(waiterPairingQrText(hosts, s.port, pairing.code), 240);
      qr.setAttribute('role', 'img');
      qr.setAttribute('aria-label', t('lan.phoneQrLabel'));
      qrTile.append(qr);
    } else {
      qrTile.append(html`<p class="muted small">${t('lan.noAddress')}</p>`);
    }
    body.append(qrTile);
  }
  body.append(info);

  let quiet = false;
  const modal = openModal({
    title: phone ? t('lan.phoneTitle') : t('lan.pairTitle'),
    body,
    size: phone ? 'lg' : 'md',
    actions: [{ label: t('app.cancel'), kind: 'secondary' }],
  });
  void modal.closed.then(() => {
    window.clearInterval(timer);
    // Escape, X or "Bekor qilish": the code goes too, so nobody pairs with a code left open.
    if (!quiet) onCancel();
  });

  return {
    code: pairing.code,
    dismiss: () => {
      quiet = true;
      modal.close();
    },
  };
}
