import type { FiscalConfigDto } from '@shared/types';
import { formatNumber } from '@shared/utils/format';
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
import { withInfo } from '../../components/info-hint';
import { button, pageHeader } from '../../components/page';
import { errorMessage, toast } from '../../components/toast';
import { t } from '../../i18n';
import { html } from '../../ui/html';
import type { View } from '../types';
import { submitButton } from './settings-ui';

/**
 * Feature F18: fiscal receipts through REGOS:VCR, which runs on this (the main) till's PC. Where
 * VCR answers, the cassir login and password (kept in main, never shown again), the VAT mode,
 * and the MXIK codes: the default for dishes and those of the service and delivery fees.
 */
export const fiscalSection: View = () => {
  const el = document.createElement('section');
  el.className = 'page';
  const body = document.createElement('div');
  el.append(pageHeader(t('settings.sectionFiscal')), body);

  const render = (c: FiscalConfigDto) => {
    const form = document.createElement('form');
    form.className = 'card form-card';
    form.noValidate = true;
    const result = html`<p class="notice notice-info" hidden></p>`.firstElementChild as HTMLElement;
    const test = button(t('fiscal.test'), 'secondary', async () => {
      test.disabled = true;
      result.hidden = false;
      result.className = 'notice notice-info';
      result.textContent = t('fiscal.testing');
      try {
        const r = await api.fiscal.testConnection();
        result.className = 'notice notice-success';
        result.textContent = t('fiscal.testOk', {
          terminal: r.terminalId,
          version: r.appletVersion,
          z: formatNumber(r.freeZReports, 0),
          unsent: formatNumber(r.freeUnsentReceipts, 0),
        });
      } catch (error) {
        result.className = 'notice notice-error';
        result.textContent = errorMessage(error);
      } finally {
        test.disabled = false;
      }
    });
    const password = field({
      name: 'password',
      label: t('fiscal.password'),
      type: 'password',
      autocomplete: 'new-password',
    });
    password
      .querySelector('input')!
      .setAttribute(
        'placeholder',
        c.hasPassword ? t('fiscal.passwordSaved') : t('fiscal.passwordMissing'),
      );
    form.append(
      html`<h2 class="card-title">${withInfo(t('fiscal.title'), t('fiscal.hint'))}</h2>
        ${checkboxField({ name: 'enabled', label: t('fiscal.enabled'), checked: c.enabled })}
        ${c.urlOverride
          ? html`<p class="notice notice-warning">${t('fiscal.urlOverride')}</p>`
          : ''}
        <div class="form-row">
          ${field({
            name: 'host',
            label: t('fiscal.host'),
            value: c.host,
            info: t('fiscal.hostHint'),
          })}
          ${field({
            name: 'port',
            label: t('fiscal.port'),
            type: 'number',
            value: String(c.port),
            min: 1,
            max: 65535,
            inputmode: 'numeric',
          })}
        </div>
        <div class="form-row">
          ${field({ name: 'login', label: t('fiscal.login'), value: c.login, autocomplete: 'off' })}
          ${password}
        </div>
        ${selectField({
          name: 'vatMode',
          label: t('fiscal.vatMode'),
          value: c.vatMode,
          info: t('fiscal.vatHint'),
          options: [
            { value: 'nonPayer', label: t('fiscal.vat_nonPayer') },
            { value: 'vat12', label: t('fiscal.vat_vat12') },
          ],
        })}
        <h3 class="card-subtitle">${withInfo(t('fiscal.codesTitle'), t('fiscal.codesHint'))}</h3>
        <div class="form-row">
          ${field({
            name: 'defaultMxik',
            label: t('fiscal.defaultMxik'),
            value: c.defaultMxik,
            inputmode: 'numeric',
          })}
          ${field({
            name: 'defaultPackage',
            label: t('fiscal.package'),
            value: c.defaultPackage,
            inputmode: 'numeric',
          })}
        </div>
        <div class="form-row">
          ${field({
            name: 'serviceMxik',
            label: t('fiscal.serviceMxik'),
            value: c.serviceMxik,
            inputmode: 'numeric',
          })}
          ${field({
            name: 'servicePackage',
            label: t('fiscal.package'),
            value: c.servicePackage,
            inputmode: 'numeric',
          })}
        </div>
        <div class="form-row">
          ${field({
            name: 'deliveryMxik',
            label: t('fiscal.deliveryMxik'),
            value: c.deliveryMxik,
            inputmode: 'numeric',
          })}
          ${field({
            name: 'deliveryPackage',
            label: t('fiscal.package'),
            value: c.deliveryPackage,
            inputmode: 'numeric',
          })}
        </div>
        <p class="muted small">${t('fiscal.printNote')}</p>
        ${formError()}
        <div class="bulk-actions">${submitButton()}${test}</div>
        ${result}`,
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(form);
      try {
        const next = await api.fiscal.setConfig({
          enabled: checked(form, 'enabled'),
          host: value(form, 'host'),
          port: Number(value(form, 'port')) || c.port,
          login: value(form, 'login'),
          password: value(form, 'password') || undefined,
          vatMode: value(form, 'vatMode') as FiscalConfigDto['vatMode'],
          defaultMxik: value(form, 'defaultMxik'),
          defaultPackage: value(form, 'defaultPackage'),
          serviceMxik: value(form, 'serviceMxik'),
          servicePackage: value(form, 'servicePackage'),
          deliveryMxik: value(form, 'deliveryMxik'),
          deliveryPackage: value(form, 'deliveryPackage'),
        });
        toast(t('settings.saved'), 'success');
        render(next);
      } catch (error) {
        showFormError(form, error);
      }
    });
    body.replaceChildren(form);
  };

  const load = () =>
    api.fiscal
      .getConfig()
      .then(render)
      .catch((error: unknown) => {
        body.replaceChildren(html`<p class="notice notice-error">${errorMessage(error)}</p>`);
      });
  void load();
  return { el };
};
