import type { CategoryDto, MenuItemDto, PrinterDto } from '@shared/types';
import { latinToCyrillic } from '@shared/utils/transliterate';
import { api } from '../../api';
import {
  checkboxField,
  checked,
  field,
  formError,
  selectField,
  showFormError,
  textareaField,
  value,
} from '../../components/forms';
import { openModal } from '../../components/modal';
import { button } from '../../components/page';
import { toast, toastError } from '../../components/toast';
import { t } from '../../i18n';
import { html } from '../../ui/html';
import { icon } from '../../ui/icons';
import { toInputDecimal } from '../../utils/format';

type SaleType = 'piece' | 'portion' | 'weight';

const imageUrl = (file: string) => `savdochef-img://img/${encodeURIComponent(file)}`;

/**
 * Prefills nameRu from nameUz as it is typed (posgro pattern): nameRu follows only while it is
 * empty or still the transliteration, so a name typed or saved by hand is left alone.
 */
function mirrorNameRu(form: HTMLElement) {
  const uz = form.querySelector<HTMLInputElement>('[name="nameUz"]')!;
  const ru = form.querySelector<HTMLInputElement>('[name="nameRu"]')!;
  let mirrored = latinToCyrillic(uz.value);
  uz.addEventListener('input', () => {
    const next = latinToCyrillic(uz.value);
    if (ru.value === '' || ru.value === mirrored) ru.value = next;
    mirrored = next;
  });
}

/**
 * Picture block shared by the dish and category forms: preview, pick (main copies the file into
 * the image store and returns its name), remove. `value()` is the file name to save, or null.
 */
function imagePicker(initial: string | null) {
  let imageFile = initial;
  const preview = document.createElement('div');
  preview.className = 'image-preview';
  const render = () => {
    preview.replaceChildren();
    if (imageFile) {
      const img = document.createElement('img');
      img.src = imageUrl(imageFile);
      img.alt = '';
      preview.append(img);
    } else {
      preview.append(icon('noImage', 32));
    }
    remove.hidden = !imageFile;
  };
  const pick = button(t('menu.pickImage'), 'secondary', async () => {
    try {
      const picked = await api.menu.pickImage();
      if (picked) {
        imageFile = picked;
        render();
      }
    } catch (e) {
      toastError(e);
    }
  });
  const remove = button(t('menu.removeImage'), 'ghost', () => {
    imageFile = null;
    render();
  });
  const el = html`<div class="image-row">
    ${preview}
    <div class="image-actions">
      <span class="field-label">${t('menu.image')}</span>${pick}${remove}
    </div>
  </div>`;
  render();
  return { el, value: () => imageFile };
}

/** A printer as the dish form names it: its own name, or "Asosiy printer" / the Windows name. */
export function printerName(p: PrinterDto): string {
  return p.label || (p.isMain ? t('printers.main') : (p.windowsName ?? t('printers.main')));
}

/**
 * The dish form's printer choices (feature F11): none, then shown printers. A hidden printer the
 * dish already uses stays listed (marked) so saving another field does not drop it.
 */
function printerChoices(printers: PrinterDto[], current: number | null) {
  return [
    { value: '', label: t('printers.noneForDish') },
    ...printers
      .filter((p) => p.isActive || p.id === current)
      .map((p) => ({
        value: String(p.id),
        label: `${printerName(p)}${p.isMain ? ` (${t('printers.mainShort')})` : ''}${p.isActive ? '' : ` (${t('printers.hidden')})`}`,
      })),
  ];
}

/** Create or edit a dish. Resolves true when saved. */
export function dishModal(
  categories: CategoryDto[],
  printers: PrinterDto[],
  dish: MenuItemDto | null,
  defaultCategoryId?: number,
) {
  return new Promise<boolean>((resolve) => {
    const picture = imagePicker(dish?.imageFile ?? null);
    const saleType: SaleType = dish?.soldByWeight
      ? 'weight'
      : dish?.hasPortions
        ? 'portion'
        : 'piece';

    const form = document.createElement('div');

    const priceField = field({
      name: 'price',
      label: t('menu.price'),
      inputmode: 'decimal',
      amount: true,
      value: toInputDecimal(dish?.price),
    });
    const typeField = selectField({
      name: 'saleType',
      label: t('menu.saleType'),
      value: saleType,
      options: [
        { value: 'piece', label: t('menu.typePiece') },
        { value: 'portion', label: t('menu.typePortion') },
        { value: 'weight', label: t('menu.typeWeight') },
      ],
    });
    const syncPriceLabel = () => {
      priceField.querySelector('label')!.textContent =
        value(form, 'saleType') === 'weight' ? t('menu.pricePerKg') : t('menu.price');
    };
    typeField.querySelector('select')!.addEventListener('change', syncPriceLabel);

    const error = formError();
    form.append(
      html`<div class="form-row">
          ${field({
            name: 'nameUz',
            label: t('menu.nameUz'),
            value: dish?.nameUz ?? '',
            required: true,
          })}
          ${field({ name: 'nameRu', label: t('menu.nameRu'), value: dish?.nameRu ?? '' })}
        </div>
        <div class="form-row">
          ${selectField({
            name: 'categoryId',
            label: t('menu.category'),
            value: String(dish?.categoryId ?? defaultCategoryId ?? categories[0]?.id ?? ''),
            options: categories.map((c) => ({ value: String(c.id), label: c.nameUz })),
          })}
          ${typeField}
        </div>
        <div class="form-row">
          ${priceField}
          ${field({
            name: 'costPrice',
            label: t('menu.costPrice'),
            inputmode: 'decimal',
            amount: true,
            value: toInputDecimal(dish?.costPrice),
          })}
        </div>
        <p class="muted small">${t('menu.costHint')}</p>
        ${selectField({
          name: 'printerId',
          label: t('printers.dishPrinter'),
          value: dish?.printerId ? String(dish.printerId) : '',
          options: printerChoices(printers, dish?.printerId ?? null),
        })}
        <p class="muted small">${t('printers.dishPrinterHint')}</p>
        ${textareaField({
          name: 'description',
          label: t('menu.description'),
          value: dish?.description ?? '',
          rows: 2,
        })}
        ${picture.el}
        ${dish
          ? checkboxField({ name: 'isActive', label: t('menu.active'), checked: dish.isActive })
          : ''}
        ${error}`,
    );
    syncPriceLabel();
    mirrorNameRu(form);

    let saved = false;
    const modal = openModal({
      title: dish ? t('menu.editDish') : t('menu.addDish'),
      body: form,
      size: 'md',
      actions: [
        { label: t('app.cancel') },
        {
          label: t('app.save'),
          kind: 'primary',
          submit: true,
          onClick: async () => {
            const type = value(form, 'saleType') as SaleType;
            const data = {
              nameUz: value(form, 'nameUz'),
              nameRu: value(form, 'nameRu') || null,
              description: value(form, 'description') || null,
              categoryId: Number(value(form, 'categoryId')),
              price: value(form, 'price').replace(/\s/g, '').replace(',', '.'),
              costPrice: value(form, 'costPrice').replace(/\s/g, '').replace(',', '.') || null,
              hasPortions: type === 'portion',
              soldByWeight: type === 'weight',
              imageFile: picture.value(),
              printerId: Number(value(form, 'printerId')) || null,
            };
            try {
              if (dish)
                await api.menu.update({
                  id: dish.id,
                  ...data,
                  isActive: checked(form, 'isActive'),
                });
              else await api.menu.create(data);
              toast(t('menu.saved'), 'success');
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

/** Create or edit a category. Resolves true when saved. */
export function categoryModal(category: CategoryDto | null) {
  return new Promise<boolean>((resolve) => {
    const picture = imagePicker(category?.imageFile ?? null);
    const form = document.createElement('div');
    form.append(
      html`${field({
        name: 'nameUz',
        label: t('menu.nameUz'),
        value: category?.nameUz ?? '',
        required: true,
      })}
      ${field({ name: 'nameRu', label: t('menu.nameRu'), value: category?.nameRu ?? '' })}
      ${field({
        name: 'sortOrder',
        label: t('menu.sortOrder'),
        type: 'number',
        inputmode: 'numeric',
        value: String(category?.sortOrder ?? 0),
      })}
      ${picture.el}
      ${category
        ? checkboxField({ name: 'isActive', label: t('menu.active'), checked: category.isActive })
        : ''}
      ${formError()}`,
    );
    mirrorNameRu(form);
    let saved = false;
    const modal = openModal({
      title: category ? t('menu.editCategory') : t('menu.addCategory'),
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
              nameUz: value(form, 'nameUz'),
              nameRu: value(form, 'nameRu') || null,
              sortOrder: Number(value(form, 'sortOrder')) || 0,
              imageFile: picture.value(),
            };
            try {
              if (category)
                await api.categories.update({
                  id: category.id,
                  ...data,
                  isActive: checked(form, 'isActive'),
                });
              else await api.categories.create(data);
              toast(t('menu.saved'), 'success');
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
