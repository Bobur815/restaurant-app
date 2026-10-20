import { PERMISSIONS, ROLE_DEFAULTS, ROLES, type Permission, type Role } from '@shared/permissions';
import type { UserDto } from '@shared/types';
import { api } from '../../api';
import {
  checkboxField,
  checked,
  clearErrors,
  field,
  formError,
  selectField,
  showFormError,
  value,
} from '../../components/forms';
import { confirmDialog, openModal } from '../../components/modal';
import { button, pageHeader } from '../../components/page';
import { phoneField } from '../../components/phone-field';
import { pinField, pinsMatch } from '../../components/pin-field';
import { showRecoveryCode } from '../../components/recovery-code';
import { toast, toastError } from '../../components/toast';
import { t } from '../../i18n';
import { appStore } from '../../store/app';
import { html } from '../../ui/html';
import { icon } from '../../ui/icons';
import { formatDateTime } from '../../utils/format';
import { formatPhone } from '@shared/utils/phone';
import type { View } from '../types';

const roleOptions = () => ROLES.map((r) => ({ value: r, label: t(`nav.role${r}`) }));

/**
 * Users: who works here, their phone, role and permissions, and their login PIN. Only a user
 * with the `users` permission gets here, and only they set PINs (nobody learns another's PIN by
 * choosing it). A PIN is unique, so it alone says who logs in.
 */
export const usersView: View = () => {
  const el = document.createElement('section');
  el.className = 'page';
  const list = document.createElement('div');
  list.className = 'card';
  const recovery = document.createElement('div');

  /**
   * The owner's recovery code (forgotten administrator PIN). Only its hash is kept, so the code
   * cannot be shown again: a new one replaces it.
   */
  const renderRecovery = (hasCode: boolean) => {
    recovery.className = `notice ${hasCode ? 'notice-info' : 'notice-warning'} recovery-notice`;
    const renew = button(
      hasCode ? t('recovery.renew') : t('recovery.create'),
      hasCode ? 'secondary' : 'primary',
      async () => {
        if (
          hasCode &&
          !(await confirmDialog({ title: t('recovery.renew'), message: t('recovery.renewConfirm') }))
        )
          return;
        try {
          const { recoveryCode } = await api.auth.newRecoveryCode();
          await showRecoveryCode(recoveryCode);
          renderRecovery(true);
        } catch (e) {
          toastError(e);
        }
      },
    );
    recovery.replaceChildren(
      html`${icon(hasCode ? 'lock' : 'warning')}<span
          >${hasCode ? t('recovery.hasCode') : t('recovery.noCode')}</span
        >${renew}`,
    );
  };
  void api.auth
    .recoveryStatus()
    .then((s) => renderRecovery(s.hasCode))
    .catch(toastError);
  el.append(
    pageHeader(
      t('users.title'),
      button(t('users.add'), 'primary', () => userModal(null)),
    ),
    recovery,
    list,
  );

  let users: UserDto[] = [];

  const permissionSummary = (u: UserDto) => {
    const names = u.permissions.map((p) => t(`permissions.${p}`)).join(', ');
    return html`<span class="badge badge-muted" title="${names}"
      >${t('users.permissionCount', { n: u.permissions.length, total: PERMISSIONS.length })}</span
    >`;
  };

  const render = () => {
    const me = appStore.get().user!;
    list.replaceChildren(
      html`<div class="table-wrap">
        <table class="lines-table">
          <thead>
            <tr>
              <th>${t('users.fullName')}</th>
              <th>${t('users.phone')}</th>
              <th>${t('users.role')}</th>
              <th>${t('users.permissions')}</th>
              <th>${t('users.status')}</th>
              <th>${t('users.pin')}</th>
              <th>${t('users.lastLogin')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${users.map(
              (u) =>
                html`<tr class="${u.isActive ? '' : 'is-inactive'}">
                  <td class="strong">
                    ${u.fullName}${u.id === me.id
                      ? html` <span class="muted">(${t('users.you')})</span>`
                      : ''}
                  </td>
                  <td>${u.phone ? formatPhone(u.phone) : '—'}</td>
                  <td>${t(`nav.role${u.role}`)}</td>
                  <td>${permissionSummary(u)}</td>
                  <td>
                    <span class="badge ${u.isActive ? 'badge-success' : 'badge-muted'}"
                      >${u.isActive ? t('users.active') : t('users.inactive')}</span
                    >
                  </td>
                  <td>
                    <span class="badge ${u.hasPin ? 'badge-success' : 'badge-warning'}"
                      >${u.hasPin ? t('users.pinSet') : t('users.pinNone')}</span
                    >
                  </td>
                  <td class="muted">
                    ${u.lastLoginAt ? formatDateTime(u.lastLoginAt) : t('users.never')}
                  </td>
                  <td class="row-actions">
                    ${button(t('users.edit'), 'ghost', () => userModal(u))}
                  </td>
                </tr>`,
            )}
          </tbody>
        </table>
      </div>`,
    );
  };

  const load = async () => {
    try {
      users = await api.users.list();
      render();
    } catch (e) {
      toastError(e);
    }
  };

  /** Create (user null) or edit. Changing the role ticks that role's default permissions. */
  function userModal(user: UserDto | null) {
    const isMe = user?.id === appStore.get().user!.id;
    const form = document.createElement('div');
    form.className = 'user-form';
    const phone = phoneField({ name: 'phone', label: t('users.phone'), value: user?.phone });

    const boxes = PERMISSIONS.map((p) =>
      checkboxField({
        name: `perm.${p}`,
        label: t(`permissions.${p}`),
        checked: (user?.permissions ?? ROLE_DEFAULTS.STAFF).includes(p),
      }),
    );
    const tick = (perms: readonly Permission[]) => {
      for (const p of PERMISSIONS) {
        form.querySelector<HTMLInputElement>(`[name="perm.${p}"]`)!.checked = perms.includes(p);
      }
    };

    const pinFields = html`<div class="form-row">
      ${pinField('pin', user?.hasPin ? t('users.newPin') : t('users.pin'))}
      ${pinField('pinRepeat', t('users.pinRepeat'))}
    </div>`;

    form.append(
      html`<div class="form-row">
          ${field({
            name: 'fullName',
            label: t('users.fullName'),
            value: user?.fullName ?? '',
            required: true,
            autocomplete: 'off',
          })}${phone.el}
        </div>
        ${selectField({
          name: 'role',
          label: t('users.role'),
          value: user?.role ?? 'STAFF',
          options: roleOptions(),
        })}
        <fieldset class="permission-grid">
          <legend>${t('users.permissions')}</legend>
          ${boxes}
        </fieldset>
        <fieldset>
          <legend>${t('users.pin')}</legend>
          <p class="muted small">${user?.hasPin ? t('users.pinKeepHint') : t('users.pinHint')}</p>
          ${pinFields}
          ${user?.hasPin ? checkboxField({ name: 'removePin', label: t('users.removePin') }) : ''}
        </fieldset>
        ${user && !isMe
          ? checkboxField({ name: 'isActive', label: t('users.isActive'), checked: user.isActive })
          : ''}
        ${formError()}`,
    );
    const roleSelect = form.querySelector<HTMLSelectElement>('[name="role"]')!;
    roleSelect.addEventListener('change', () => tick(ROLE_DEFAULTS[roleSelect.value as Role]));

    const save = async () => {
      clearErrors(form);
      const removePin = checked(form, 'removePin');
      const typedPin = value(form, 'pin');
      if ((typedPin || value(form, 'pinRepeat')) && !removePin) {
        if (!pinsMatch(form, 'pin', 'pinRepeat')) return false;
      }
      const permissions = PERMISSIONS.filter((p) => checked(form, `perm.${p}`));
      const common = {
        fullName: value(form, 'fullName'),
        phone: phone.input.value,
        role: roleSelect.value as Role,
        permissions,
      };
      try {
        if (user) {
          await api.users.update({
            id: user.id,
            ...common,
            ...(isMe ? {} : { isActive: checked(form, 'isActive') }),
            ...(removePin ? { pin: null } : typedPin ? { pin: typedPin } : {}),
          });
          toast(t('users.saved'), 'success');
        } else {
          await api.users.create({ ...common, pin: typedPin || null });
          toast(t('users.created'), 'success');
        }
        await load();
      } catch (e) {
        showFormError(form, e);
        return false;
      }
    };

    openModal({
      title: user ? `${t('users.edit')}: ${user.fullName}` : t('users.add'),
      body: form,
      size: 'lg',
      actions: [
        { label: t('app.cancel') },
        { label: t('app.save'), kind: 'primary', submit: true, onClick: save },
      ],
    });
  }

  void load();
  const stop = api.events.subscribe((e) => {
    if (e.type === 'users-changed') void load();
  });
  return { el, destroy: stop };
};
