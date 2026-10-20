import type { UpdateReceiptSettingsInput } from '@shared/schemas';
import type { OrderType, ReceiptLayoutDto, ReceiptSettingsDto } from '@shared/types';
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
import { icon } from '../../ui/icons';
import type { View } from '../types';
import { submitButton } from './settings-ui';

type LayoutValues = Omit<ReceiptLayoutDto, 'orderType' | 'saved'>;

const TYPE_LABEL: Record<OrderType, string> = {
  DINE_IN: 'receiptLayout.general',
  TAKEAWAY: 'orderType.TAKEAWAY',
  DELIVERY: 'orderType.DELIVERY',
};

const imageUrl = (file: string) => `savdochef-img://img/${encodeURIComponent(file)}`;
const PREVIEW_DELAY_MS = 450;

/**
 * One picture of a layout (top or bottom): choose, remove, width in % of the paper. The file is
 * copied into the image store by main; this only ever holds its name.
 */
function imagePicker(
  title: string,
  initial: { file: string | null; width: number },
  onChange: () => void,
) {
  let file = initial.file;
  const el = document.createElement('fieldset');
  el.className = 'receipt-image';
  const thumb = document.createElement('div');
  thumb.className = 'receipt-image-thumb';
  const choose = button(t('receiptLayout.chooseImage'), 'secondary', async () => {
    try {
      const picked = await api.receipt.pickImage();
      if (picked) {
        file = picked;
        render();
        onChange();
      }
    } catch (error) {
      toastError(error);
    }
  });
  const remove = button(t('receiptLayout.removeImage'), 'danger-ghost', () => {
    file = null;
    render();
    onChange();
  });
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '20';
  range.max = '100';
  range.step = '5';
  range.value = String(initial.width);
  const output = document.createElement('output');
  const widthLabel = document.createElement('label');
  widthLabel.className = 'receipt-image-width';
  widthLabel.append(document.createTextNode(t('receiptLayout.imageWidth')), range, output);
  range.addEventListener('input', () => {
    output.textContent = `${range.value}%`;
    onChange();
  });

  function render() {
    thumb.replaceChildren();
    if (file) {
      const img = document.createElement('img');
      img.src = imageUrl(file);
      img.alt = title;
      thumb.append(img);
    } else {
      thumb.append(html`${icon('noImage', 28)}<span>${t('receiptLayout.noImage')}</span>`);
    }
    remove.hidden = !file;
    widthLabel.hidden = !file;
    choose.textContent = file ? t('receiptLayout.changeImage') : t('receiptLayout.chooseImage');
    output.textContent = `${range.value}%`;
  }
  el.append(
    html`<legend>${title}</legend>`,
    thumb,
    html`<div class="receipt-image-actions">${choose}${remove}</div>`,
    widthLabel,
  );
  render();
  return { el, value: () => ({ file, width: Number(range.value) }) };
}

/**
 * What the customer receipt says and how it looks. The restaurant's details, language and
 * separator are shared; each order type (General = tables, takeaway, delivery) has its own
 * switches, footer and top/bottom pictures, with a live preview of the real print document
 * (rendered by main from the unsaved values). The printer lives in the Printer section.
 */
export const receiptSection: View = () => {
  const el = document.createElement('section');
  el.className = 'page';
  const body = document.createElement('div');
  body.className = 'settings-split';
  el.append(pageHeader(t('settings.sectionReceipt')), body);

  let destroyed = false;
  let previewTimer: number | undefined;

  const load = async () => {
    let receipt: ReceiptSettingsDto | null;
    let layouts: ReceiptLayoutDto[];
    try {
      [receipt, layouts] = await Promise.all([api.receipt.get(), api.receipt.layouts()]);
    } catch (error) {
      toastError(error);
      return;
    }
    if (destroyed) return;
    const r = receipt;

    // ── shared: the restaurant ─────────────────────────────────────────────────────────────
    const shared = document.createElement('form');
    shared.className = 'card form-card';
    shared.noValidate = true;
    shared.append(
      html`<h2 class="card-title">${t('settings.receiptContent')}</h2>
        <p class="muted small">${t('receiptLayout.sharedHint')}</p>
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
        <div class="form-row">
          ${selectField({
            name: 'locale',
            label: t('printing.locale'),
            value: r?.locale ?? 'uz',
            options: [
              { value: 'uz', label: t('settings.uzbek') },
              { value: 'ru', label: t('settings.russian') },
            ],
          })}
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
        ${checkboxField({
          name: 'printUseStarsSep',
          label: t('settings.useStarsSep'),
          checked: r?.printUseStarsSep ?? true,
        })}
        ${formError()}
        <div class="bulk-actions">${submitButton()}</div>`,
    );
    const sharedValues = (): UpdateReceiptSettingsInput => ({
      restaurantName: value(shared, 'restaurantName'),
      phone: value(shared, 'phone'),
      extraPhones: value(shared, 'extraPhones'),
      address: value(shared, 'address'),
      locale: value(shared, 'locale') as 'uz' | 'ru',
      printSeparatorCount: Number(value(shared, 'printSeparatorCount')),
      printSeparatorChar: value(shared, 'printSeparatorChar'),
      printUseStarsSep: checked(shared, 'printUseStarsSep'),
    });
    shared.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(shared);
      try {
        await api.receipt.update(sharedValues());
        toast(t('settings.saved'), 'success');
        schedulePreview(0);
      } catch (error) {
        showFormError(shared, error);
      }
    });

    // ── per order type: the layout ─────────────────────────────────────────────────────────
    const byType = new Map(layouts.map((l) => [l.orderType, l]));
    /** Unsaved edits per tab survive switching tabs. */
    const drafts = new Map<OrderType, LayoutValues>();
    let current: OrderType = 'DINE_IN';
    let readLayout: () => LayoutValues = () => byType.get(current)!;

    const tabs = document.createElement('div');
    tabs.className = 'segmented receipt-tabs';
    tabs.setAttribute('role', 'radiogroup');
    tabs.setAttribute('aria-label', t('receiptLayout.typeLabel'));
    const tabButtons = (['DINE_IN', 'TAKEAWAY', 'DELIVERY'] as const).map((type) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.textContent = t(TYPE_LABEL[type]);
      b.addEventListener('click', () => {
        if (type === current) return;
        drafts.set(current, readLayout());
        current = type;
        renderLayout();
      });
      tabs.append(b);
      return { type, b };
    });

    const layoutForm = document.createElement('form');
    layoutForm.className = 'card form-card';
    layoutForm.noValidate = true;
    const layoutCard = document.createElement('div');
    layoutCard.className = 'receipt-layout';
    layoutCard.append(tabs, layoutForm);

    function renderLayout() {
      for (const { type, b } of tabButtons)
        b.setAttribute('aria-checked', String(type === current));
      const saved = byType.get(current)!;
      const v = drafts.get(current) ?? saved;
      const top = imagePicker(
        t('receiptLayout.topImage'),
        { file: v.topImage, width: v.topImageWidth },
        () => schedulePreview(),
      );
      const bottom = imagePicker(
        t('receiptLayout.bottomImage'),
        { file: v.bottomImage, width: v.bottomImageWidth },
        () => schedulePreview(),
      );
      const testButton = button(t('printing.test'), 'secondary', async () => {
        testButton.disabled = true;
        try {
          const result = await api.printing.test({ orderType: current });
          toast(t('printing.testSent', { printer: result.printer }), 'success');
        } catch (error) {
          toast(t('printing.failed', { reason: errorMessage(error) }), 'error', 8000);
        } finally {
          testButton.disabled = false;
        }
      });
      testButton.title = t('receiptLayout.testHint');
      const box = (name: keyof LayoutValues, label: string) =>
        checkboxField({ name, label, checked: v[name] as boolean });

      layoutForm.replaceChildren(
        html`<h2 class="card-title">
            ${t('receiptLayout.title', { type: t(TYPE_LABEL[current]) })}
          </h2>
          ${current !== 'DINE_IN' && !saved.saved
            ? html`<p class="notice notice-info">
                ${icon('receipt')}<span>${t('receiptLayout.inherited')}</span>
              </p>`
            : ''}
          <div class="check-grid">
            ${box('showAddress', t('settings.showAddress'))}
            ${box('showPhone', t('settings.showPhone'))}
            ${box('showDateTime', t('settings.showDateTime'))}
            ${box('showOrderNumber', t('settings.showOrderNumber'))}
            ${current === 'DINE_IN' ? '' : box('showCustomer', t('receiptLayout.showCustomer'))}
          </div>
          ${field({ name: 'footerNote', label: t('settings.footerNote'), value: v.footerNote })}
          <div class="receipt-images">${top.el}${bottom.el}</div>
          ${formError()}
          <div class="bulk-actions">${submitButton()}${testButton}</div>`,
      );
      readLayout = () => ({
        showAddress: checked(layoutForm, 'showAddress'),
        showPhone: checked(layoutForm, 'showPhone'),
        showDateTime: checked(layoutForm, 'showDateTime'),
        showOrderNumber: checked(layoutForm, 'showOrderNumber'),
        // General has no customer block: keep what is stored.
        showCustomer: current === 'DINE_IN' ? v.showCustomer : checked(layoutForm, 'showCustomer'),
        footerNote: value(layoutForm, 'footerNote'),
        topImage: top.value().file,
        topImageWidth: top.value().width,
        bottomImage: bottom.value().file,
        bottomImageWidth: bottom.value().width,
      });
      schedulePreview(0);
    }

    layoutForm.addEventListener('input', () => schedulePreview());
    layoutForm.addEventListener('change', () => schedulePreview());
    shared.addEventListener('input', () => schedulePreview());
    shared.addEventListener('change', () => schedulePreview());
    layoutForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(layoutForm);
      try {
        const saved = await api.receipt.updateLayout({ orderType: current, ...readLayout() });
        byType.set(current, saved);
        drafts.delete(current);
        // Types that inherit from General follow its new values.
        if (current === 'DINE_IN') {
          for (const l of await api.receipt.layouts()) if (!l.saved) byType.set(l.orderType, l);
        }
        toast(t('settings.saved'), 'success');
        renderLayout();
      } catch (error) {
        showFormError(layoutForm, error);
      }
    });

    // ── preview: the real print document, rendered by main ─────────────────────────────────
    const previewBox = document.createElement('div');
    previewBox.className = 'receipt-preview-box';
    previewBox.setAttribute('aria-live', 'polite');
    const previewCard = document.createElement('div');
    previewCard.className = 'card';
    previewCard.append(html`<h2 class="card-title">${t('printing.previewAlt')}</h2>`, previewBox);
    let previewSeq = 0;

    function schedulePreview(delay = PREVIEW_DELAY_MS) {
      window.clearTimeout(previewTimer);
      if (!r) return; // no receipt settings yet: nothing to render
      previewTimer = window.setTimeout(() => void showPreview(), delay);
    }

    async function showPreview() {
      const seq = ++previewSeq;
      try {
        const url = await api.printing.preview({
          orderType: current,
          receipt: sharedValues(),
          layout: readLayout(),
        });
        if (seq !== previewSeq || destroyed) return; // a newer preview is on its way
        const img = document.createElement('img');
        img.src = url;
        img.alt = t('printing.previewAlt');
        img.className = 'receipt-preview';
        previewBox.replaceChildren(img);
      } catch (error) {
        // Half-typed values (e.g. an empty name) are not worth a toast: the save shows them.
        if (seq === previewSeq)
          previewBox.replaceChildren(document.createTextNode(errorMessage(error)));
      }
    }

    const column = document.createElement('div');
    column.className = 'receipt-forms';
    column.append(shared, layoutCard);
    body.replaceChildren(column, previewCard);
    renderLayout();
  };

  void load();
  return {
    el,
    destroy() {
      destroyed = true;
      window.clearTimeout(previewTimer);
    },
  };
};
