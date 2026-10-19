import type { Language, Theme } from '@shared/types';
import { api } from '../../api';
import {
  checkboxField,
  checked,
  clearErrors,
  formError,
  selectField,
  showFormError,
  value,
} from '../../components/forms';
import { pageHeader } from '../../components/page';
import { toast, toastError } from '../../components/toast';
import { t } from '../../i18n';
import { html } from '../../ui/html';
import type { View } from '../types';
import { submitButton } from './settings-ui';

/** Shop-wide defaults: language, theme, click sound. */
export const systemSection: View = () => {
  const el = document.createElement('section');
  el.className = 'page';
  const body = document.createElement('div');
  el.append(pageHeader(t('settings.sectionSystem')), body);

  const load = async () => {
    try {
      const settings = await api.settings.get();
      const form = document.createElement('form');
      form.className = 'card form-card';
      form.noValidate = true;
      form.append(
        html`${selectField({
            name: 'language',
            label: t('settings.language'),
            value: settings.language,
            options: [
              { value: 'uz', label: t('settings.uzbek') },
              { value: 'ru', label: t('settings.russian') },
            ],
          })}
          ${selectField({
            name: 'theme',
            label: t('settings.theme'),
            value: settings.theme,
            options: [
              { value: 'system', label: t('nav.themeSystem') },
              { value: 'light', label: t('nav.themeLight') },
              { value: 'dark', label: t('nav.themeDark') },
            ],
          })}
          <p class="muted small">${t('settings.defaultsHint')}</p>
          ${checkboxField({
            name: 'clickSound',
            label: t('settings.clickSound'),
            checked: settings.clickSound,
          })}
          ${formError()}${submitButton()}`,
      );
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearErrors(form);
        try {
          await api.settings.update({
            language: value(form, 'language') as Language,
            theme: value(form, 'theme') as Theme,
            clickSound: checked(form, 'clickSound'),
          });
          toast(t('settings.saved'), 'success');
        } catch (error) {
          showFormError(form, error);
        }
      });
      body.replaceChildren(form);
    } catch (error) {
      toastError(error);
    }
  };

  void load();
  return { el };
};
