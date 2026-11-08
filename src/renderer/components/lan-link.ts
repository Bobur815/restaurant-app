import type { LanLinkDto } from '@shared/types';
import { api } from '../api';
import { t } from '../i18n';
import { appStore } from '../store/app';
import { html } from '../ui/html';
import { icon } from '../ui/icons';
import { formatDateTime } from '@shared/utils/format';
import { clearErrors, field, formError, showFormError, value } from './forms';
import { confirmDialog, openModal } from './modal';
import { toastError } from './toast';

/**
 * Feature F12 in the renderer: joining a main till, and what a satellite shows when its line to the
 * main till is down. Everything else in the renderer is the same on a satellite: its main process
 * forwards the calls.
 */

/** The main till's address and pairing code; resolves when the satellite joined (it restarts). */
export function joinMainForm(): { el: HTMLElement } {
  const form = document.createElement('form');
  form.className = 'join-main';
  form.noValidate = true;
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn-primary btn-block';
  submit.textContent = t('lan.join');
  form.append(
    html`<p class="muted small">${t('lan.joinHint')}</p>
      ${field({
        name: 'mainAddress',
        label: t('lan.mainAddress'),
        required: true,
        inputmode: 'decimal',
      })}
      ${field({ name: 'code', label: t('lan.code'), required: true, inputmode: 'numeric' })}
      ${formError()} ${submit}`,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    submit.disabled = true;
    try {
      await api.lan.join({ mainAddress: value(form, 'mainAddress'), code: value(form, 'code') });
      form.replaceChildren(html`<p class="notice notice-info">${t('lan.restarting')}</p>`);
    } catch (error) {
      showFormError(form, error);
      submit.disabled = false;
    }
  });
  return { el: form };
}

export function joinMainModal(): void {
  openModal({ title: t('lan.joinTitle'), body: joinMainForm().el, size: 'sm' });
}

export async function leaveMain(): Promise<void> {
  const ok = await confirmDialog({
    title: t('lan.leave'),
    message: t('lan.leaveConfirm'),
    danger: true,
  });
  if (!ok) return;
  try {
    await api.lan.leave();
  } catch (error) {
    toastError(error);
  }
}

const STATE_TEXT: Record<string, string> = {
  connecting: 'lan.stateConnecting',
  unreachable: 'lan.stateUnreachable',
  unpaired: 'lan.stateUnpaired',
  superseded: 'lan.stateSuperseded',
  version: 'lan.stateVersion',
};

/** The card a satellite shows instead of the app while it cannot work with its main till. */
function waitingCard(link: LanLinkDto): HTMLElement {
  const card = document.createElement('div');
  card.className = 'auth-card link-card';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn btn-primary';
  retry.textContent = t('lan.retry');
  retry.addEventListener('click', () => void refreshLink());
  const rejoin = document.createElement('button');
  rejoin.type = 'button';
  rejoin.className = 'btn btn-secondary';
  rejoin.textContent = t('lan.rejoin');
  rejoin.addEventListener('click', joinMainModal);
  const leave = document.createElement('button');
  leave.type = 'button';
  leave.className = 'btn btn-ghost';
  leave.textContent = t('lan.leave');
  leave.addEventListener('click', () => void leaveMain());
  // What main allows whoever stands here (register.ts): re-pair with the same restaurant when the
  // main till refuses or another till answers; leave when the main till refuses. Not while it is
  // merely unreachable (a pulled cable must not open anything).
  const mayRejoin =
    link.state === 'unpaired' || link.state === 'superseded' || link.state === 'version';
  const mayLeave = link.state === 'unpaired' || link.state === 'version';
  card.append(
    html`<div class="link-icon">${icon('warning', 40)}</div>
      <h1>${t('lan.waitingTitle')}</h1>
      <p>${t(STATE_TEXT[link.state ?? 'connecting'] ?? 'lan.stateUnreachable')}</p>
      <p class="muted small">
        ${t('lan.mainAt', { address: link.mainUrl ?? '' })}${link.lastContactAt
          ? ` · ${t('lan.lastContact', { time: formatDateTime(link.lastContactAt) })}`
          : ''}
      </p>
      ${link.state === 'unreachable' ? html`<p class="muted small">${t('lan.checkHint')}</p>` : ''}
      <div class="bulk-actions">${retry}${mayRejoin ? rejoin : ''}${mayLeave ? leave : ''}</div>`,
  );
  return card;
}

async function refreshLink(): Promise<LanLinkDto | null> {
  try {
    const link = await api.lan.link();
    appStore.set({ lan: link });
    return link;
  } catch {
    return appStore.get().lan;
  }
}

/** A satellite that is not working with its main till right now. */
export function linkDown(link: LanLinkDto | null): boolean {
  return !!link && link.role === 'satellite' && link.state !== 'online';
}

/**
 * Covers the app while a satellite's line is down (the open order stays underneath, untouched),
 * and lifts when it is back. A short flap (under 1.5 s) shows nothing.
 */
export function watchLink(): void {
  let overlay: HTMLElement | null = null;
  let timer: number | null = null;
  const render = () => {
    const link = appStore.get().lan;
    if (!linkDown(link)) {
      if (timer) window.clearTimeout(timer);
      timer = null;
      overlay?.remove();
      overlay = null;
      return;
    }
    const show = () => {
      timer = null;
      const fresh = appStore.get().lan;
      if (!linkDown(fresh)) return;
      const next = document.createElement('div');
      next.className = 'link-overlay';
      next.setAttribute('role', 'alertdialog');
      next.append(waitingCard(fresh!));
      if (overlay) overlay.replaceWith(next);
      else document.body.append(next);
      overlay = next;
    };
    if (overlay) show();
    else if (!timer) timer = window.setTimeout(show, 1500);
  };
  appStore.subscribe((s, prev) => {
    if (s.lan !== prev.lan || s.language !== prev.language) render();
  });
  api.events.subscribe((e) => {
    if (e.type === 'lan-changed') void refreshLink();
  });
  render();
}

/**
 * Boot on a satellite whose main till does not answer yet: the waiting card until it does, then
 * the caller continues (it reloads what it needs from the main till).
 */
export function waitForMain(root: HTMLElement, link: LanLinkDto): Promise<void> {
  return new Promise((resolve) => {
    const page = document.createElement('div');
    page.className = 'auth-page';
    page.append(waitingCard(link));
    root.replaceChildren(page);
    const stop = api.events.subscribe(async (e) => {
      if (e.type !== 'lan-changed') return;
      const fresh = await refreshLink();
      if (fresh && !linkDown(fresh)) {
        stop();
        resolve();
      } else if (fresh) {
        page.replaceChildren(waitingCard(fresh));
      }
    });
  });
}
