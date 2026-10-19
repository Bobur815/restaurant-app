import type { Language, Theme } from '@shared/types';
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
import { pageHeader } from '../../components/page';
import { errorMessage, toast, toastError } from '../../components/toast';
import { t } from '../../i18n';
import { html } from '../../ui/html';
import type { View } from '../types';

function actionButton(label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-secondary';
  b.textContent = label;
  return b;
}

function submitButton(): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'submit';
  b.className = 'btn btn-primary';
  b.textContent = t('app.save');
  return b;
}

/** Shop settings and receipt layout (admin). Printer selection gets a real picker in Phase 7. */
export const settingsView: View = () => {
  const el = document.createElement('section');
  el.className = 'page';
  const grid = document.createElement('div');
  grid.className = 'card-grid';
  el.append(pageHeader(t('settings.title')), grid);

  const load = async () => {
    try {
      const [settings, receipt, printers] = await Promise.all([
        api.settings.get(),
        api.receipt.get(),
        // The printer list is a nicety: the form still works if it cannot be read.
        api.printing.printers().catch(() => []),
      ]);

      const general = document.createElement('form');
      general.className = 'card form-card';
      general.noValidate = true;
      general.append(
        html`<h2 class="card-title">${t('settings.general')}</h2>
          ${field({
            name: 'tableCount',
            label: t('settings.tableCount'),
            type: 'number',
            inputmode: 'numeric',
            min: 1,
            max: 200,
            value: String(settings.tableCount),
          })}
          ${selectField({
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
          ${checkboxField({
            name: 'printAfterPayment',
            label: t('printing.printAfterPayment'),
            checked: settings.printAfterPayment,
          })}
          ${formError()}${submitButton()}`,
      );
      general.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearErrors(general);
        try {
          await api.settings.update({
            tableCount: Number(value(general, 'tableCount')),
            language: value(general, 'language') as Language,
            theme: value(general, 'theme') as Theme,
            clickSound: checked(general, 'clickSound'),
            printAfterPayment: checked(general, 'printAfterPayment'),
          });
          toast(t('settings.saved'), 'success');
        } catch (error) {
          showFormError(general, error);
        }
      });

      const r = receipt;
      const previewButton = actionButton(t('printing.preview'));
      const testButton = actionButton(t('printing.test'));
      const receiptForm = document.createElement('form');
      receiptForm.className = 'card form-card';
      receiptForm.noValidate = true;
      receiptForm.append(
        html`<h2 class="card-title">${t('settings.receipt')}</h2>
          ${field({
            name: 'restaurantName',
            label: t('settings.restaurantName'),
            value: r?.restaurantName ?? '',
          })}
          <div class="form-row">
            ${field({ name: 'phone', label: t('settings.phone'), value: r?.phone ?? '' })}
            ${field({
              name: 'extraPhones',
              label: t('settings.extraPhones'),
              value: r?.extraPhones ?? '',
            })}
          </div>
          ${field({ name: 'address', label: t('settings.address'), value: r?.address ?? '' })}
          ${field({
            name: 'footerNote',
            label: t('settings.footerNote'),
            value: r?.footerNote ?? '',
          })}
          <div class="form-row">
            ${selectField({
              name: 'printerName',
              label: t('printing.printer'),
              value: r?.printerName ?? '',
              options: [
                { value: '', label: t('printing.auto') },
                ...printers.map((p) => ({ value: p.name, label: p.name })),
                // Keep a saved printer selectable even when it is offline right now.
                ...(r?.printerName && !printers.some((p) => p.name === r.printerName)
                  ? [{ value: r.printerName, label: r.printerName }]
                  : []),
              ],
            })}
            ${selectField({
              name: 'locale',
              label: t('printing.locale'),
              value: r?.locale ?? 'uz',
              options: [
                { value: 'uz', label: t('settings.uzbek') },
                { value: 'ru', label: t('settings.russian') },
              ],
            })}
          </div>
          <div class="form-row">
            ${field({
              name: 'printWidthPx',
              label: t('settings.printWidthPx'),
              type: 'number',
              inputmode: 'numeric',
              value: String(r?.printWidthPx ?? 420),
            })}
            ${field({
              name: 'printSeparatorCount',
              label: t('settings.separatorCount'),
              type: 'number',
              inputmode: 'numeric',
              value: String(r?.printSeparatorCount ?? 38),
            })}
          </div>
          ${field({
            name: 'printSeparatorChar',
            label: t('settings.separatorChar'),
            value: r?.printSeparatorChar ?? '*',
          })}
          <div class="check-grid">
            ${checkboxField({
              name: 'printUseStarsSep',
              label: t('settings.useStarsSep'),
              checked: r?.printUseStarsSep ?? true,
            })}
            ${checkboxField({
              name: 'printShowAddress',
              label: t('settings.showAddress'),
              checked: r?.printShowAddress ?? true,
            })}
            ${checkboxField({
              name: 'printShowPhone',
              label: t('settings.showPhone'),
              checked: r?.printShowPhone ?? true,
            })}
            ${checkboxField({
              name: 'printShowDateTime',
              label: t('settings.showDateTime'),
              checked: r?.printShowDateTime ?? true,
            })}
            ${checkboxField({
              name: 'printShowOrderNumber',
              label: t('settings.showOrderNumber'),
              checked: r?.printShowOrderNumber ?? true,
            })}
          </div>
          ${formError()}
          <div class="bulk-actions">${submitButton()}${previewButton}${testButton}</div>`,
      );
      const formValues = () => ({
        restaurantName: value(receiptForm, 'restaurantName'),
        phone: value(receiptForm, 'phone'),
        extraPhones: value(receiptForm, 'extraPhones'),
        address: value(receiptForm, 'address'),
        footerNote: value(receiptForm, 'footerNote'),
        printerName: value(receiptForm, 'printerName') || null,
        locale: value(receiptForm, 'locale') as 'uz' | 'ru',
        printWidthPx: Number(value(receiptForm, 'printWidthPx')),
        printSeparatorCount: Number(value(receiptForm, 'printSeparatorCount')),
        printSeparatorChar: value(receiptForm, 'printSeparatorChar'),
        printUseStarsSep: checked(receiptForm, 'printUseStarsSep'),
        printShowAddress: checked(receiptForm, 'printShowAddress'),
        printShowPhone: checked(receiptForm, 'printShowPhone'),
        printShowDateTime: checked(receiptForm, 'printShowDateTime'),
        printShowOrderNumber: checked(receiptForm, 'printShowOrderNumber'),
      });
      receiptForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearErrors(receiptForm);
        try {
          await api.receipt.update({
            ...formValues(),
          });
          toast(t('settings.saved'), 'success');
        } catch (error) {
          showFormError(receiptForm, error);
        }
      });

      // Preview: the same document the printer gets, rendered to an image by main.
      previewButton.addEventListener('click', async () => {
        previewButton.disabled = true;
        try {
          const url = await api.printing.preview(formValues());
          const img = document.createElement('img');
          img.src = url;
          img.alt = t('printing.previewAlt');
          img.className = 'receipt-preview';
          previewBox.replaceChildren(img);
          previewCard.hidden = false;
        } catch (error) {
          showFormError(receiptForm, error);
        } finally {
          previewButton.disabled = false;
        }
      });
      testButton.addEventListener('click', async () => {
        testButton.disabled = true;
        try {
          const result = await api.printing.test();
          toast(t('printing.testSent', { printer: result.printer }), 'success');
        } catch (error) {
          toast(t('printing.failed', { reason: errorMessage(error) }), 'error', 8000);
        } finally {
          testButton.disabled = false;
        }
      });

      const previewBox = document.createElement('div');
      previewBox.className = 'receipt-preview-box';
      const previewCard = document.createElement('div');
      previewCard.className = 'card';
      previewCard.hidden = true;
      previewCard.append(html`<h2 class="card-title">${t('printing.previewAlt')}</h2>`, previewBox);

      grid.replaceChildren(general, receiptForm, previewCard);
    } catch (error) {
      toastError(error);
    }
  };

  void load();
  return { el };
};
