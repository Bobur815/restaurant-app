import type { PrinterDto, PrinterInfo } from '@shared/types';
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
import { openModal } from '../../components/modal';
import { button, pageHeader } from '../../components/page';
import { errorMessage, toast, toastError } from '../../components/toast';
import { t } from '../../i18n';
import { html } from '../../ui/html';
import { icon } from '../../ui/icons';
import type { View } from '../types';
import { submitButton } from './settings-ui';
import { withInfo } from '../../components/info-hint';

function printerOptions(printers: PrinterInfo[], saved: string | null, allowAuto: boolean) {
  return [
    ...(allowAuto ? [{ value: '', label: t('printing.auto') }] : []),
    ...printers.map((p) => ({ value: p.name, label: p.name })),
    // Keep a saved printer selectable even when it is offline right now.
    ...(saved && !printers.some((p) => p.name === saved) ? [{ value: saved, label: saved }] : []),
  ];
}

function fillSelect(select: HTMLSelectElement, options: Array<{ value: string; label: string }>) {
  const keep = select.value;
  select.replaceChildren(
    ...options.map((o) => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      return opt;
    }),
  );
  select.value = keep;
}

/** Add or edit a kitchen/bar printer: an optional name and a Windows printer. */
function extraPrinterModal(printers: PrinterInfo[], printer: PrinterDto | null) {
  return new Promise<boolean>((resolve) => {
    const form = document.createElement('div');
    form.append(
      html`${field({
        name: 'label',
        label: t('printers.label'),
        value: printer?.label ?? '',
      })}
      ${selectField({
        name: 'windowsName',
        label: t('printing.printer'),
        value: printer?.windowsName ?? printers[0]?.name ?? '',
        options: printerOptions(printers, printer?.windowsName ?? null, false),
      })}
      ${printers.length === 0
        ? html`<p class="notice notice-info">${t('printing.noPrinters')}</p>`
        : ''}
      ${formError()}`,
    );
    let saved = false;
    const modal = openModal({
      title: printer ? t('printers.edit') : t('printers.add'),
      body: form,
      size: 'sm',
      actions: [
        { label: t('app.cancel') },
        {
          label: t('app.save'),
          kind: 'primary',
          submit: true,
          onClick: async () => {
            const data = {
              label: value(form, 'label') || null,
              windowsName: value(form, 'windowsName'),
            };
            try {
              if (printer) await api.printers.update({ id: printer.id, ...data });
              else await api.printers.create(data);
              toast(t('settings.saved'), 'success');
              saved = true;
            } catch (e) {
              showFormError(form, e);
              return false;
            }
          },
        },
      ],
    });
    void modal.closed.then(() => resolve(saved));
  });
}

/**
 * Printers (feature F11): the main printer (receipts, pre-bills, shift reports, automatic printing
 * after payment) and the kitchen/bar printers dishes send their tickets to.
 */
export const printerSection: View = () => {
  const el = document.createElement('section');
  el.className = 'page';
  const body = document.createElement('div');
  el.append(pageHeader(t('settings.sectionPrinter')), body);

  let windowsPrinters: PrinterInfo[] = [];

  const testPrinter = async (b: HTMLButtonElement, printerId: number) => {
    b.disabled = true;
    try {
      const result = await api.printing.testPrinter({ printerId });
      toast(t('printing.testSent', { printer: result.printer }), 'success');
    } catch (error) {
      toast(t('printing.failed', { reason: errorMessage(error) }), 'error', 8000);
    } finally {
      b.disabled = false;
    }
  };

  const iconButton = (name: Parameters<typeof icon>[0], label: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.append(icon(name, 18));
    b.addEventListener('click', onClick);
    return b;
  };

  function mainCard(main: PrinterDto, printAfterPayment: boolean): HTMLElement {
    const testButton = button(t('printing.test'), 'secondary');
    const refreshButton = button(t('printing.refresh'), 'secondary');
    const form = document.createElement('form');
    form.className = 'card form-card';
    form.noValidate = true;
    form.append(
      html`<h2 class="card-title">${withInfo(t('printers.mainTitle'), t('printers.mainHint'))}</h2>
        ${field({ name: 'label', label: t('printers.label'), value: main.label ?? '' })}
        <div class="field-with-action">
          ${selectField({
            name: 'windowsName',
            label: t('printing.printer'),
            value: main.windowsName ?? '',
            options: printerOptions(windowsPrinters, main.windowsName, true),
          })}
          ${refreshButton}
        </div>
        ${windowsPrinters.length === 0
          ? html`<p class="notice notice-info">${t('printing.noPrinters')}</p>`
          : ''}
        ${checkboxField({
          name: 'printAfterPayment',
          label: t('printing.printAfterPayment'),
          checked: printAfterPayment,
        })}
        ${formError()}
        <div class="bulk-actions">${submitButton()}${testButton}</div>`,
    );

    refreshButton.addEventListener('click', async () => {
      refreshButton.disabled = true;
      try {
        windowsPrinters = await api.printing.printers();
        const select = form.querySelector<HTMLSelectElement>('select[name="windowsName"]')!;
        fillSelect(select, printerOptions(windowsPrinters, select.value || null, true));
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
        await api.printers.update({
          id: main.id,
          label: value(form, 'label') || null,
          windowsName: value(form, 'windowsName') || null,
        });
        await api.settings.update({ printAfterPayment: checked(form, 'printAfterPayment') });
        toast(t('settings.saved'), 'success');
      } catch (error) {
        showFormError(form, error);
      }
    });

    // The sample receipt with the saved settings: save first to test a changed printer.
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
    return form;
  }

  function extrasCard(extras: PrinterDto[]): HTMLElement {
    const card = document.createElement('div');
    card.className = 'card';
    const add = button(t('printers.add'), 'primary', async () => {
      if (await extraPrinterModal(windowsPrinters, null)) await load();
    });
    const rows = extras.map((p) => {
      const tr = document.createElement('tr');
      if (!p.isActive) tr.className = 'is-inactive';
      const actions = document.createElement('td');
      actions.className = 'row-actions';
      if (p.isActive) {
        const test = iconButton('printer', t('printers.test'), () => void testPrinter(test, p.id));
        actions.append(
          test,
          iconButton('edit', t('printers.edit'), async () => {
            if (await extraPrinterModal(windowsPrinters, p)) await load();
          }),
          iconButton('check', t('printers.makeMain'), async () => {
            try {
              await api.printers.setMain({ printerId: p.id });
              toast(t('settings.saved'), 'success');
              await load();
            } catch (error) {
              toastError(error);
            }
          }),
          iconButton('hide', t('printers.hide'), async () => {
            try {
              await api.printers.update({ id: p.id, isActive: false });
              await load();
            } catch (error) {
              toastError(error);
            }
          }),
        );
      } else {
        actions.append(
          iconButton('show', t('printers.show'), async () => {
            try {
              await api.printers.update({ id: p.id, isActive: true });
              await load();
            } catch (error) {
              toastError(error);
            }
          }),
        );
      }
      tr.append(
        html`<td class="strong">${p.label || t('printers.noLabel')}</td>
          <td>${p.windowsName ?? t('printing.auto')}</td>
          <td class="num">${String(p.menuItemCount)}</td>
          <td>
            ${p.isActive
              ? ''
              : html`<span class="badge badge-muted">${t('printers.hidden')}</span>`}
          </td>`,
        actions,
      );
      return tr;
    });
    card.append(
      html`<div class="card-header">
          <h2>${withInfo(t('printers.extraTitle'), t('printers.extraHint'))}</h2>
          ${add}
        </div>
        ${extras.length === 0
          ? html`<p class="muted empty-inline">${t('printers.none')}</p>`
          : html`<table class="lines-table">
              <thead>
                <tr>
                  <th>${t('printers.label')}</th>
                  <th>${t('printing.printer')}</th>
                  <th class="num">${t('printers.dishes')}</th>
                  <th></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>`}`,
    );
    return card;
  }

  const load = async () => {
    try {
      const [settings, printers, list] = await Promise.all([
        api.settings.get(),
        api.printers.list({ includeInactive: true }),
        // The Windows list is a nicety: the page still works if it cannot be read.
        api.printing.printers().catch(() => [] as PrinterInfo[]),
      ]);
      windowsPrinters = list;
      const main = printers.find((p) => p.isMain);
      body.replaceChildren(
        ...(main ? [mainCard(main, settings.printAfterPayment)] : []),
        extrasCard(printers.filter((p) => !p.isMain)),
      );
    } catch (error) {
      toastError(error);
    }
  };

  void load();
  return { el };
};
