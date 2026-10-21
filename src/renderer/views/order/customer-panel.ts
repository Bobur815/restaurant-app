import type { DeliveryStatus, OrderDto } from '@shared/types';
import { dec, isDecimalString } from '@shared/utils/decimal';
import { isUzPhoneComplete, normalizeUzPhone } from '@shared/utils/phone';
import { api } from '../../api';
import { clearErrors, field, formError, showFormError, value } from '../../components/forms';
import { phoneField } from '../../components/phone-field';
import { t } from '../../i18n';
import { appStore, licensed } from '../../store/app';
import { html } from '../../ui/html';
import { icon } from '../../ui/icons';
import { formatMoney, toInputDecimal } from '../../utils/format';

export type OpenType = 'TAKEAWAY' | 'DELIVERY';

export interface CustomerValues {
  orderType: OpenType;
  customerPhone: string | null;
  customerName: string | null;
  deliveryAddress: string | null;
  deliveryNote: string | null;
  /** Delivery only. Sent as typed when it is not a number, so main's message lands on the field. */
  deliveryFee?: string;
}

const STATUSES: DeliveryStatus[] = ['PREPARING', 'ON_THE_WAY', 'DELIVERED'];

/** '' / whitespace -> null, so form values compare equal to what the order stores. */
const orNull = (s: string) => (s.trim() ? s.trim() : null);

/** A typed amount with spaces/comma -> decimal string, or null when not a number. */
function moneyInput(raw: string): string | null {
  const v = raw.replace(/\s/g, '').replace(',', '.');
  if (v === '') return '0';
  return isDecimalString(v) && !v.startsWith('-') ? v : null;
}

/**
 * The takeaway/delivery part of the order screen: order type, the customer's phone (masked, and a
 * known phone fills in the rest), name, and for delivery the address, landmark and fee. For a
 * saved delivery it also shows the delivery status and courier, which change immediately (no money
 * moves), unlike the other fields, which are saved with the order.
 */
export function createCustomerPanel(options: {
  type: OpenType;
  onChange: () => void;
  onStatus: (status: DeliveryStatus, courierName: string | null) => void;
}) {
  let type = options.type;
  let order: OrderDto | null = null;

  const el = document.createElement('div');
  el.className = 'customer-panel';

  const typeSwitch = document.createElement('div');
  typeSwitch.className = 'segmented';
  typeSwitch.setAttribute('role', 'radiogroup');
  typeSwitch.setAttribute('aria-label', t('orderType.label'));

  // Phone: masked as typed; a complete known number fills the empty fields (never overwrites).
  let lookup = 0;
  const phone = phoneField({
    name: 'customerPhone',
    label: t('customer.phone'),
    onInput: () => {
      known.hidden = true;
      lookup++;
      options.onChange();
    },
    onComplete: async (digits) => {
      const mine = ++lookup;
      const c = await api.customers.findByPhone({ phone: digits }).catch(() => null);
      if (mine !== lookup || !c) return;
      known.hidden = false;
      const fill = (name: string, v: string | null) => {
        if (v && !input(name).value.trim()) input(name).value = v;
      };
      fill('customerName', c.name);
      if (type === 'DELIVERY') {
        fill('deliveryAddress', c.address);
        fill('deliveryNote', c.landmark);
      }
      options.onChange();
    },
  });
  const known = document.createElement('span');
  known.className = 'badge badge-success customer-known';
  known.hidden = true;
  known.textContent = t('customer.known');
  phone.el.querySelector('label')!.append(known);

  const nameField = field({ name: 'customerName', label: t('customer.name'), autocomplete: 'off' });
  const addressField = field({ name: 'deliveryAddress', label: t('customer.address') });
  const noteField = field({ name: 'deliveryNote', label: t('customer.landmark') });
  const feeField = field({
    name: 'deliveryFee',
    label: t('customer.fee'),
    inputmode: 'decimal',
  });

  const statusBox = document.createElement('div');
  statusBox.className = 'delivery-status';

  el.append(
    typeSwitch,
    html`<div class="customer-grid">${phone.el}${nameField}</div>
      <div class="customer-grid">${addressField}${noteField}${feeField}</div>`,
    statusBox,
    formError(),
  );
  const input = (name: string) => el.querySelector<HTMLInputElement>(`[name="${name}"]`)!;

  const renderType = () => {
    const { settings } = appStore.get();
    const offered: OpenType[] = [];
    // The order's own type always shows; the other only when on in settings and in the plan (F5).
    const offers = (enabled: boolean | undefined, feature: 'takeaway' | 'delivery') =>
      enabled !== false && licensed(feature);
    if (offers(settings?.takeawayEnabled, 'takeaway') || type === 'TAKEAWAY')
      offered.push('TAKEAWAY');
    if (offers(settings?.deliveryEnabled, 'delivery') || type === 'DELIVERY')
      offered.push('DELIVERY');
    typeSwitch.replaceChildren(
      ...offered.map((ot) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(ot === type));
        b.append(icon(ot === 'DELIVERY' ? 'delivery' : 'takeaway', 18), t(`orderType.${ot}`));
        b.addEventListener('click', () => {
          if (type === ot) return;
          type = ot;
          if (type === 'DELIVERY' && !input('deliveryFee').value)
            input('deliveryFee').value = toInputDecimal(
              appStore.get().settings?.deliveryFeeDefault ?? '0',
            );
          render();
          options.onChange();
        });
        return b;
      }),
    );
  };

  const renderStatus = () => {
    statusBox.replaceChildren();
    statusBox.hidden = !(type === 'DELIVERY' && order && order.orderType === 'DELIVERY');
    if (statusBox.hidden || !order) return;
    const courier = document.createElement('input');
    courier.className = 'input';
    courier.value = order.courierName ?? '';
    courier.placeholder = t('delivery.courier');
    courier.setAttribute('aria-label', t('delivery.courier'));
    const buttons = STATUSES.map((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(order!.deliveryStatus === s));
      b.textContent = t(`delivery.${s}`);
      b.addEventListener('click', () => options.onStatus(s, orNull(courier.value)));
      return b;
    });
    const group = document.createElement('div');
    group.className = 'segmented';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', t('delivery.status'));
    group.append(...buttons);
    statusBox.append(
      html`<span class="delivery-status-label"
        >${icon('delivery', 18)}${t('delivery.status')}</span
      >`,
      group,
      courier,
    );
  };

  function render() {
    renderType();
    // Takeaway keeps the note field (remarks like "call when ready"), not the address or fee.
    input('deliveryNote').closest('.field')!.querySelector('label')!.textContent =
      type === 'DELIVERY' ? t('customer.landmark') : t('customer.note');
    input('deliveryAddress')
      .closest('.field')!
      .toggleAttribute('hidden', type !== 'DELIVERY');
    input('deliveryFee')
      .closest('.field')!
      .toggleAttribute('hidden', type !== 'DELIVERY');
    renderStatus();
  }

  for (const name of ['customerName', 'deliveryAddress', 'deliveryNote', 'deliveryFee'])
    input(name).addEventListener('input', () => options.onChange());

  /** Loads the saved order (or a new one's defaults) into the fields. */
  function setOrder(next: OrderDto | null) {
    order = next;
    if (next && next.orderType !== 'DINE_IN') type = next.orderType;
    phone.set(next?.customerPhone);
    input('customerName').value = next?.customerName ?? '';
    input('deliveryAddress').value = next?.deliveryAddress ?? '';
    input('deliveryNote').value = next?.deliveryNote ?? '';
    input('deliveryFee').value = toInputDecimal(
      next ? next.deliveryFee : (appStore.get().settings?.deliveryFeeDefault ?? '0'),
    );
    known.hidden = true;
    clearErrors(el);
    render();
  }

  /** What would be saved. Phone as typed (main normalizes); fee null when not a number. */
  function values(): CustomerValues & { feeValid: boolean } {
    const digits = phone.digits();
    const fee = type === 'DELIVERY' ? moneyInput(value(el, 'deliveryFee')) : '0';
    return {
      orderType: type,
      customerPhone: digits ? digits : null,
      customerName: orNull(value(el, 'customerName')),
      deliveryAddress: type === 'DELIVERY' ? orNull(value(el, 'deliveryAddress')) : null,
      deliveryNote: orNull(value(el, 'deliveryNote')),
      deliveryFee: type === 'DELIVERY' ? (fee ?? value(el, 'deliveryFee')) : undefined,
      feeValid: fee !== null,
    };
  }

  /** True when the fields differ from the saved order (a new order: when anything is typed). */
  function isDirty(): boolean {
    const v = values();
    if (!order) return false; // a new order is dirty through its lines
    const savedPhone = order.customerPhone;
    const typedPhone =
      v.customerPhone && isUzPhoneComplete(v.customerPhone)
        ? normalizeUzPhone(v.customerPhone)
        : v.customerPhone;
    return (
      v.orderType !== order.orderType ||
      typedPhone !== savedPhone ||
      v.customerName !== order.customerName ||
      v.deliveryAddress !== order.deliveryAddress ||
      v.deliveryNote !== order.deliveryNote ||
      (v.orderType === 'DELIVERY' && (!v.feeValid || !dec(v.deliveryFee!).eq(order.deliveryFee)))
    );
  }

  /** The delivery fee as it will be added to the total (0 unless delivery). */
  function fee(): string {
    const v = values();
    return v.orderType === 'DELIVERY' && v.feeValid ? v.deliveryFee! : '0';
  }

  render();
  return {
    el,
    setOrder,
    values,
    isDirty,
    fee,
    feeText: () => formatMoney(fee(), appStore.get().language),
    get type() {
      return type;
    },
    showError: (error: unknown) => showFormError(el, error),
    clearErrors: () => clearErrors(el),
  };
}
