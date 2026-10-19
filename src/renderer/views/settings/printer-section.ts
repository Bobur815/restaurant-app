import type { PrinterInfo } from '@shared/types';
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
import { errorMessage, toast, toastError } from '../../components/toast';
import { t } from '../../i18n';
import { html } from '../../ui/html';
import type { View } from '../types';
import { submitButton } from './settings-ui';

function printerOptions(printers: PrinterInfo[], saved: string | null) {
  return [
    { value: '', label: t('printing.auto') },
    ...printers.map((p) => ({ value: p.name, label: p.name })),
    // Keep a saved printer selectable even when it is offline right now.
    ...(saved && !printers.some((p) => p.name === saved) ? [{ value: saved, label: saved }] : []),
  ];
}

/** Which printer, paper width, automatic printing after payment, and a test receipt. */
export const printerSection: View = () => {
  const el = document.createElement('section');
  el.className = 'page';
  const body = document.createElement('div');
  el.append(pageHeader(t('settings.sectionPrinter')), body);

  const load = async () => {
    try {
      const [settings, receipt, printers] = await Promise.all([
        api.settings.get(),
        api.receipt.get(),
        // The printer list is a nicety: the form still works if it cannot be read.
        api.printing.printers().catch(() => [] as PrinterInfo[]),
      ]);

      const testButton = button(t('printing.test'), 'secondary');
      const refreshButton = button(t('printing.refresh'), 'secondary');
      const form = document.createElement('form');
      form.className = 'card form-card';
      form.noValidate = true;
      form.append(
        html`<p class="muted small">${t('settings.printerHint')}</p>
          <div class="field-with-action">
            ${selectField({
              name: 'printerName',
              label: t('printing.printer'),
              value: receipt?.printerName ?? '',
              options: printerOptions(printers, receipt?.printerName ?? null),
            })}
            ${refreshButton}
          </div>
          ${printers.length === 0
            ? html`<p class="notice notice-info">${t('printing.noPrinters')}</p>`
            : ''}
          ${field({
            name: 'printWidthPx',
            label: t('settings.printWidthPx'),
            type: 'number',
            inputmode: 'numeric',
            value: String(receipt?.printWidthPx ?? 420),
          })}
          ${checkboxField({
            name: 'printAfterPayment',
            label: t('printing.printAfterPayment'),
            checked: settings.printAfterPayment,
          })}
          ${formError()}
          <div class="bulk-actions">${submitButton()}${testButton}</div>`,
      );

      refreshButton.addEventListener('click', async () => {
        refreshButton.disabled = true;
        try {
          const list = await api.printing.printers();
          const select = form.querySelector<HTMLSelectElement>('select[name="printerName"]')!;
          const keep = select.value;
          select.replaceChildren(
            ...printerOptions(list, keep || null).map((o) => {
              const opt = document.createElement('option');
              opt.value = o.value;
              opt.textContent = o.label;
              return opt;
            }),
          );
          select.value = keep;
        } catch (error) {
          toastError(error);
        } finally {
          refreshButton.disabled = false;
        }
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearErrors(form);
        try {
          // The printer belongs to the receipt settings, which exist after setup.
          if (receipt) {
            await api.receipt.update({
              printerName: value(form, 'printerName') || null,
              printWidthPx: Number(value(form, 'printWidthPx')),
            });
          }
          await api.settings.update({ printAfterPayment: checked(form, 'printAfterPayment') });
          toast(t('settings.saved'), 'success');
        } catch (error) {
          showFormError(form, error);
        }
      });

      // Prints the sample with the saved settings: save first to test a changed printer.
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

      body.replaceChildren(form);
    } catch (error) {
      toastError(error);
    }
  };

  void load();
  return { el };
};
