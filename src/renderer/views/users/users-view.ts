import type { Role, UserDto } from '@shared/types';
import { api } from '../../api';
import {
  checkboxField,
  checked,
  clearErrors,
  field,
  formError,
  selectField,
  setFieldError,
  showFormError,
  value,
} from '../../components/forms';
import { openModal } from '../../components/modal';
import { button, pageHeader } from '../../components/page';
import { toast, toastError } from '../../components/toast';
import { t } from '../../i18n';
import { appStore } from '../../store/app';
import { html } from '../../ui/html';
import { formatDateTime } from '../../utils/format';
import type { View } from '../types';

const roleOptions = () => [
  { value: 'STAFF', label: t('nav.roleSTAFF') },
  { value: 'ADMIN', label: t('nav.roleADMIN') },
];

const passwordOf = (form: ParentNode, name: string) =>
  form.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value;

/** Users (admin): who can log in, with which role. */
export const usersView: View = () => {
  const el = document.createElement('section');
  el.className = 'page';
  const list = document.createElement('div');
  list.className = 'card';
  el.append(
    pageHeader(
      t('users.title'),
      button(t('users.add'), 'primary', () => void createUser()),
    ),
    list,
  );

  let users: UserDto[] = [];

  const render = () => {
    const me = appStore.get().user!;
    list.replaceChildren(
      html`<div class="table-wrap">
        <table class="lines-table">
          <thead>
            <tr>
              <th>${t('users.username')}</th>
              <th>${t('users.fullName')}</th>
              <th>${t('users.role')}</th>
              <th>${t('users.status')}</th>
              <th>${t('users.lastLogin')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${users.map(
              (u) =>
                html`<tr class="${u.isActive ? '' : 'is-inactive'}">
                  <td class="strong">
                    ${u.username}${u.id === me.id
                      ? html` <span class="muted">(${t('users.you')})</span>`
                      : ''}
                  </td>
                  <td>${u.fullName ?? '—'}</td>
                  <td>${t(`nav.role${u.role}`)}</td>
                  <td>
                    <span class="badge ${u.isActive ? 'badge-success' : 'badge-muted'}"
                      >${u.isActive ? t('users.active') : t('users.inactive')}</span
                    >
                  </td>
                  <td class="muted">
                    ${u.lastLoginAt ? formatDateTime(u.lastLoginAt) : t('users.never')}
                  </td>
                  <td class="row-actions">
                    ${button(t('users.edit'), 'ghost', () => void editUser(u))}${button(
                      t('users.resetPassword'),
                      'ghost',
                      () => void resetPassword(u),
                    )}
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

  function passwordsMatch(form: HTMLElement, a: string, b: string): boolean {
    clearErrors(form);
    if (passwordOf(form, a) === passwordOf(form, b)) return true;
    setFieldError(form, b, t('errors.passwordsDiffer'));
    return false;
  }

  function createUser() {
    const form = document.createElement('div');
    form.append(
      html`<div class="form-row">
          ${field({
            name: 'username',
            label: t('users.username'),
            required: true,
            autocomplete: 'off',
          })}${field({ name: 'fullName', label: t('users.fullName') })}
        </div>
        ${selectField({
          name: 'role',
          label: t('users.role'),
          value: 'STAFF',
          options: roleOptions(),
        })}
        <div class="form-row">
          ${field({
            name: 'password',
            label: t('users.password'),
            type: 'password',
            autocomplete: 'new-password',
          })}${field({
            name: 'passwordRepeat',
            label: t('users.passwordRepeat'),
            type: 'password',
            autocomplete: 'new-password',
          })}
        </div>
        ${formError()}`,
    );
    openModal({
      title: t('users.add'),
      body: form,
      actions: [
        { label: t('app.cancel') },
        {
          label: t('app.save'),
          kind: 'primary',
          submit: true,
          onClick: async () => {
            if (!passwordsMatch(form, 'password', 'passwordRepeat')) return false;
            try {
              await api.users.create({
                username: value(form, 'username'),
                fullName: value(form, 'fullName') || null,
                role: value(form, 'role') as Role,
                password: passwordOf(form, 'password'),
              });
              toast(t('users.created'), 'success');
              await load();
            } catch (e) {
              showFormError(form, e);
              return false;
            }
          },
        },
      ],
    });
  }

  function editUser(user: UserDto) {
    const form = document.createElement('div');
    form.append(
      html`${field({ name: 'fullName', label: t('users.fullName'), value: user.fullName ?? '' })}
      ${selectField({
        name: 'role',
        label: t('users.role'),
        value: user.role,
        options: roleOptions(),
      })}
      ${checkboxField({ name: 'isActive', label: t('users.isActive'), checked: user.isActive })}
      ${formError()}`,
    );
    openModal({
      title: `${t('users.edit')}: ${user.username}`,
      body: form,
      size: 'sm',
      actions: [
        { label: t('app.cancel') },
        {
          label: t('app.save'),
          kind: 'primary',
          submit: true,
          onClick: async () => {
            try {
              await api.users.update({
                id: user.id,
                fullName: value(form, 'fullName') || null,
                role: value(form, 'role') as Role,
                isActive: checked(form, 'isActive'),
              });
              toast(t('users.saved'), 'success');
              await load();
            } catch (e) {
              showFormError(form, e);
              return false;
            }
          },
        },
      ],
    });
  }

  function resetPassword(user: UserDto) {
    const form = document.createElement('div');
    form.append(
      html`${field({
        name: 'newPassword',
        label: t('users.newPassword'),
        type: 'password',
        autocomplete: 'new-password',
      })}
      ${field({
        name: 'passwordRepeat',
        label: t('users.passwordRepeat'),
        type: 'password',
        autocomplete: 'new-password',
      })}
      ${formError()}`,
    );
    openModal({
      title: `${t('users.resetPassword')}: ${user.username}`,
      body: form,
      size: 'sm',
      actions: [
        { label: t('app.cancel') },
        {
          label: t('app.save'),
          kind: 'primary',
          submit: true,
          onClick: async () => {
            if (!passwordsMatch(form, 'newPassword', 'passwordRepeat')) return false;
            try {
              await api.users.resetPassword({
                id: user.id,
                newPassword: passwordOf(form, 'newPassword'),
              });
              toast(t('users.passwordReset'), 'success');
            } catch (e) {
              showFormError(form, e);
              return false;
            }
          },
        },
      ],
    });
  }

  void load();
  const stop = api.events.subscribe((e) => {
    if (e.type === 'users-changed') void load();
  });
  return { el, destroy: stop };
};
