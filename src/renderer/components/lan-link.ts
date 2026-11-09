import type { LanLinkDto, UpdateStatusDto } from '@shared/types';
import { compareVersions, versionsCompatible } from '@shared/utils/version';
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

/**
 * Feature F15: the versions differ. When the main till is newer, this till updates itself here
 * (check, download with progress, then install and restart; main allows it without a sign-in in
 * this state only, and only to a release of the main till's series). When this till is the newer
 * one, the main till must be updated instead.
 */
function versionBlock(link: LanLinkDto): HTMLElement {
  const box = document.createElement('div');
  box.className = 'link-update';
  const versions = document.createElement('p');
  versions.className = 'link-versions';
  const text = document.createElement('p');
  text.className = 'muted small';
  const status = document.createElement('p');
  status.className = 'update-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const progress = document.createElement('progress');
  progress.className = 'update-progress';
  progress.max = 100;
  progress.hidden = true;
  const actions = document.createElement('div');
  actions.className = 'bulk-actions';
  box.append(versions, text, status, progress, actions);

  const main = link.mainVersion;
  let own: string | null = null;
  /** The press started a check: go on to the download when it finds the right release. */
  let wantDownload = false;

  const action = (label: string, kind: string, run: () => Promise<unknown>) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn btn-${kind}`;
    b.textContent = label;
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await run();
      } catch (error) {
        toastError(error);
      } finally {
        b.disabled = false;
      }
    });
    return b;
  };
  const update = action(t('lan.updateHere'), 'primary', async () => {
    wantDownload = true;
    render(await api.updater.check());
  });
  const install = action(t('update.install'), 'success', async () => {
    const yes = await confirmDialog({
      title: t('update.installTitle'),
      message: t('update.installConfirm'),
      confirmLabel: t('update.install'),
    });
    if (yes) await api.updater.install();
  });

  function render(s: UpdateStatusDto | null) {
    if (!main || !own) return;
    versions.textContent = t('lan.versions', { main, own });
    if (compareVersions(main, own) < 0) {
      text.textContent = t('lan.updateMainFirst');
      status.hidden = true;
      actions.replaceChildren();
      return;
    }
    text.textContent = t('lan.updateHint');
    status.hidden = false;
    const matches = !!s?.version && versionsCompatible(s.version, main);
    progress.hidden = s?.state !== 'downloading';
    progress.value = s?.percent ?? 0;
    let line = '';
    let buttons: HTMLButtonElement[] = [update];
    switch (s?.state) {
      case undefined:
        break;
      case 'unsupported':
        line = t('update.unsupported');
        buttons = [];
        break;
      case 'checking':
        line = t('update.checking');
        buttons = [];
        break;
      case 'not-available':
        line = t('lan.feedNotYet', { main });
        break;
      case 'available':
        if (!matches) {
          line = t('lan.feedMismatch', { target: s.version ?? '?', main });
        } else {
          line = t('update.available', { version: s.version ?? '' });
          if (wantDownload) {
            wantDownload = false;
            void api.updater.download().catch(toastError);
          }
        }
        break;
      case 'downloading':
        line = t('update.downloading', { version: s.version ?? '', percent: s.percent ?? 0 });
        buttons = [];
        break;
      case 'downloaded':
        line = matches
          ? t('update.downloaded', { version: s.version ?? '' })
          : t('lan.feedMismatch', { target: s.version ?? '?', main });
        buttons = matches ? [install] : [];
        break;
      case 'error':
        line = s.message ?? '';
        break;
      default:
        break;
    }
    // A press goes on to the download once only, from the check it started.
    if (s?.state !== 'checking') wantDownload = false;
    status.textContent = line;
    status.className = `update-status${s?.state === 'error' ? ' is-error' : ''}`;
    actions.replaceChildren(...buttons);
  }

  void Promise.all([api.app.info(), api.updater.status().catch(() => null)])
    .then(([info, s]) => {
      own = info.version;
      render(s);
    })
    .catch(toastError);
  // The updater reports its progress as events; a card that was replaced stops listening.
  const stop = api.events.subscribe((e) => {
    if (!box.isConnected) {
      stop();
      return;
    }
    if (e.type === 'update-changed')
      void api.updater
        .status()
        .then(render)
        .catch(() => undefined);
  });
  return box;
}

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
      ${link.state === 'version' ? versionBlock(link) : ''}
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
