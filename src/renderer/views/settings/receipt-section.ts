import type { UpdateReceiptSettingsInput } from '@shared/schemas';
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
import { button, pageHeader } from '../../components/page';
import { toast, toastError } from '../../components/toast';
import { t } from '../../i18n';
import { html } from '../../ui/html';
import type { View } from '../types';
import { submitButton } from './settings-ui';

/**
 * What the customer receipt says and how it looks, with a preview of the real print document
 * (rendered by main from the unsaved values). Printer and paper width live in the Printer section.
 */
export const receiptSection: View = () => {
  const el = document.createElement('section');
  el.className = 'page';
  const body = document.createElement('div');
  body.className = 'settings-split';
  el.append(pageHeader(t('settings.sectionReceipt')), body);

  const load = async () => {
    try {
      const r = await api.receipt.get();
      const form = document.createElement('form');
      form.className = 'card form-card';
      form.noValidate = true;
      const previewButton = button(t('printing.preview'), 'secondary');
      form.append(
        html`<h2 class="card-title">${t('settings.receiptContent')}</h2>
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
          ${selectField({
            name: 'locale',
            label: t('printing.locale'),
            value: r?.locale ?? 'uz',
            options: [
              { value: 'uz', label: t('settings.uzbek') },
              { value: 'ru', label: t('settings.russian') },
            ],
          })}
          <h2 class="card-title">${t('settings.receiptLayout')}</h2>
          <div class="form-row">
            ${field({
              name: 'printSeparatorChar',
              label: t('settings.separatorChar'),
              value: r?.printSeparatorChar ?? '*',
            })}
            ${field({
              name: 'printSeparatorCount',
              label: t('settings.separatorCount'),
              type: 'number',
              inputmode: 'numeric',
              value: String(r?.printSeparatorCount ?? 38),
            })}
          </div>
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
          <div class="bulk-actions">${submitButton()}${previewButton}</div>`,
      );

      const formValues = (): UpdateReceiptSettingsInput => ({
        restaurantName: value(form, 'restaurantName'),
        phone: value(form, 'phone'),
        extraPhones: value(form, 'extraPhones'),
        address: value(form, 'address'),
        footerNote: value(form, 'footerNote'),
        locale: value(form, 'locale') as 'uz' | 'ru',
        printSeparatorCount: Number(value(form, 'printSeparatorCount')),
        printSeparatorChar: value(form, 'printSeparatorChar'),
        printUseStarsSep: checked(form, 'printUseStarsSep'),
        printShowAddress: checked(form, 'printShowAddress'),
        printShowPhone: checked(form, 'printShowPhone'),
        printShowDateTime: checked(form, 'printShowDateTime'),
        printShowOrderNumber: checked(form, 'printShowOrderNumber'),
      });

      const previewBox = document.createElement('div');
      previewBox.className = 'receipt-preview-box';
      const previewCard = document.createElement('div');
      previewCard.className = 'card';
      previewCard.append(html`<h2 class="card-title">${t('printing.previewAlt')}</h2>`, previewBox);

      // The same document the printer gets, rendered to an image by main.
      const showPreview = async () => {
        previewButton.disabled = true;
        try {
          const url = await api.printing.preview(formValues());
          const img = document.createElement('img');
          img.src = url;
          img.alt = t('printing.previewAlt');
          img.className = 'receipt-preview';
          previewBox.replaceChildren(img);
        } catch (error) {
          showFormError(form, error);
        } finally {
          previewButton.disabled = false;
        }
      };
      previewButton.addEventListener('click', () => void showPreview());

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearErrors(form);
        try {
          await api.receipt.update(formValues());
          toast(t('settings.saved'), 'success');
          void showPreview();
        } catch (error) {
          showFormError(form, error);
        }
      });

      body.replaceChildren(form, previewCard);
      if (r) void showPreview();
    } catch (error) {
      toastError(error);
    }
  };

  void load();
  return { el };
};
