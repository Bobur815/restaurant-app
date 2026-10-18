import type { CategoryDto, MenuItemDto } from '@shared/types';
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

/** Create or edit a dish. Resolves true when saved. */
export function dishModal(
  categories: CategoryDto[],
  dish: MenuItemDto | null,
  defaultCategoryId?: number,
) {
  return new Promise<boolean>((resolve) => {
    let imageFile = dish?.imageFile ?? null;
    const saleType: SaleType = dish?.soldByWeight
      ? 'weight'
      : dish?.hasPortions
        ? 'portion'
        : 'piece';

    const form = document.createElement('div');
    const preview = document.createElement('div');
    preview.className = 'image-preview';
    const renderPreview = () => {
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
          renderPreview();
        }
      } catch (e) {
        toastError(e);
      }
    });
    const remove = button(t('menu.removeImage'), 'ghost', () => {
      imageFile = null;
      renderPreview();
    });

    const priceField = field({
      name: 'price',
      label: t('menu.price'),
      inputmode: 'decimal',
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
            value: toInputDecimal(dish?.costPrice),
          })}
        </div>
        <p class="muted small">${t('menu.costHint')}</p>
        ${textareaField({
          name: 'description',
          label: t('menu.description'),
          value: dish?.description ?? '',
          rows: 2,
        })}
        <div class="image-row">
          ${preview}
          <div class="image-actions">
            <span class="field-label">${t('menu.image')}</span>${pick}${remove}
          </div>
        </div>
        ${dish
          ? checkboxField({ name: 'isActive', label: t('menu.active'), checked: dish.isActive })
          : ''}
        ${error}`,
    );
    syncPriceLabel();
    renderPreview();

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
              imageFile,
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
      ${category
        ? checkboxField({ name: 'isActive', label: t('menu.active'), checked: category.isActive })
        : ''}
      ${formError()}`,
    );
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
