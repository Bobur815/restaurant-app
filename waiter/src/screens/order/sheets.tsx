import { Check, Minus, Plus, Printer, TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import type { HallDto, MenuItemDto, OrderDto, AppSettings } from '@shared/types';
import { dec, toMoneyString } from '@shared/utils/decimal';
import { formatMoney } from '@shared/utils/format';
import { priceLine, PORTION_FACTORS, type PortionFactor } from '@shared/utils/order-line';
import { MAX_GUESTS_AT_TABLE } from '@shared/utils/service-fee';
import type { DraftLine } from '@shared/utils/order-draft';
import type { Shortage } from '../../api/errors';
import { BottomSheet } from '../../components/BottomSheet';
import { Button } from '../../components/Button';
import { QtyStepper } from '../../components/Order';
import { PinKeypad } from '../../components/Pin';
import { Text } from '../../components/ui';
import { asLanguage, useI18n } from '../../i18n';
import { isNewLine, lineTotal, nextWeightInput, totals, weightText } from '../../lib/cart';
import { tokens, useTheme } from '../../theme';

/** The order screen's sheets (frames "1 · Porsiya" ... "7 · Qoldiq"). */

const money = (v: string, lang: 'uz' | 'ru') => formatMoney(v, asLanguage(lang));

export function PortionSheet({
  dish,
  current,
  onPick,
  onClose,
}: {
  dish: MenuItemDto | null;
  current?: PortionFactor | null;
  onPick: (portion: PortionFactor) => void;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const { t, lang } = useI18n();
  return (
    <BottomSheet visible={!!dish} title={dish ? localized(dish, lang) : ''} subtitle={t('sheet.portion.subtitle')} onClose={onClose}>
      <View style={{ gap: 12, paddingVertical: 8 }}>
        {dish
          ? PORTION_FACTORS.map((p) => {
              const price = toMoneyString(priceLine(dish, { quantity: 1, portion: p }).unitPrice);
              const selected = current === p;
              return (
                <Pressable
                  key={p}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onPick(p)}
                  style={{
                    height: 72,
                    borderRadius: tokens.radius.md,
                    borderWidth: selected ? tokens.borderWidth.selected : tokens.borderWidth.hairline,
                    borderColor: selected ? c.primary : c.border,
                    backgroundColor: selected ? c.primarySoft : c.surface,
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 16,
                    gap: 12,
                  }}
                >
                  <Text variant="title" style={{ flex: 1 }}>
                    {p} {t('common.unit.perPortion')}
                  </Text>
                  <Text variant="heading" color={selected ? 'text' : 'muted'} style={{ fontWeight: '400' }}>
                    {money(price, lang)}
                  </Text>
                  {selected ? (
                    <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' }}>
                      <Check size={16} color={c.onPrimary} strokeWidth={3} />
                    </View>
                  ) : null}
                </Pressable>
              );
            })
          : null}
        <Text variant="meta" color="muted">
          {t('sheet.portion.hint')}
        </Text>
      </View>
    </BottomSheet>
  );
}

export function WeightSheet({
  dish,
  initial,
  onDone,
  onClose,
}: {
  dish: MenuItemDto | null;
  initial?: string | null;
  onDone: (weightKg: string) => void;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const { t, lang } = useI18n();
  // The parent remounts this sheet per dish/line (key), so the start value is set once here.
  const [value, setValue] = useState(() => (initial ? weightText(initial) : ''));
  const kg = value ? value.replace(',', '.') : '0';
  const valid = /^\d+(\.\d{1,3})?$/.test(kg.replace(/\.$/, '')) && dec(kg.replace(/\.$/, '') || '0').gt(0);
  const price = dish && valid ? toMoneyString(priceLine(dish, { quantity: 1, weightKg: kg.replace(/\.$/, '') }).totalPrice) : '0';
  return (
    <BottomSheet
      visible={!!dish}
      title={dish ? localized(dish, lang) : ''}
      subtitle={dish ? `${money(dish.price, lang)} / ${t('common.unit.kg')}` : undefined}
      onClose={onClose}
      footer={<Button label={t('common.add')} fullWidth disabled={!valid} onPress={() => onDone(kg.replace(/\.$/, ''))} />}
    >
      <View style={{ gap: 12 }}>
        <View
          accessible
          accessibilityLabel={t('sheet.weight.aria')}
          style={{ height: 88, borderRadius: tokens.radius.md, borderWidth: tokens.borderWidth.hairline, borderColor: c.primary, backgroundColor: c.surface2, padding: 12, alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text variant="display">{value || '0'}</Text>
            <Text variant="heading" color="muted">
              {t('common.unit.kg')}
            </Text>
          </View>
          <Text variant="heading" color="muted" style={{ fontWeight: '400' }}>
            = {money(price, lang)}
          </Text>
        </View>
        <PinKeypad
          comma
          keyHeight={tokens.size.numpadKey}
          eraseLabel={t('common.erase')}
          onDigit={(d) => setValue((v) => nextWeightInput(v, d))}
          onErase={() => setValue((v) => v.slice(0, -1))}
        />
      </View>
    </BottomSheet>
  );
}

export function GuestsSheet({
  visible,
  initial,
  onDone,
  onClose,
}: {
  visible: boolean;
  initial: number;
  onDone: (n: number) => void;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const { t } = useI18n();
  // Remounted each time it opens (key), so it starts from the order's count.
  const [n, setN] = useState(initial);
  const round = (Icon: typeof Plus, onPress: () => void, label: string, tinted: boolean, disabled: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        width: 64,
        height: 64,
        borderRadius: 32,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tinted ? c.primarySoft : c.surface2,
        borderWidth: tokens.borderWidth.hairline,
        borderColor: tinted ? c.primary : c.border,
      }}
    >
      <Icon size={28} color={disabled ? c.disabledFg : tinted ? c.primaryText : c.text} strokeWidth={2} />
    </Pressable>
  );
  return (
    <BottomSheet
      visible={visible}
      title={t('sheet.guests.title')}
      onClose={onClose}
      footer={<Button label={t('common.save')} fullWidth onPress={() => onDone(n)} />}
    >
      <View style={{ gap: 16, paddingVertical: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' }}>
          {round(Minus, () => setN((v) => Math.max(1, v - 1)), t('common.decrease'), false, n <= 1)}
          <Text variant="display" style={{ fontSize: 48, lineHeight: 56 }}>
            {n}
          </Text>
          {round(Plus, () => setN((v) => Math.min(MAX_GUESTS_AT_TABLE, v + 1)), t('common.increase'), true, n >= MAX_GUESTS_AT_TABLE)}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((k) => (
            <Pressable
              key={k}
              accessibilityRole="button"
              accessibilityState={{ selected: n === k }}
              onPress={() => setN(k)}
              style={{
                width: '23%',
                height: 48,
                borderRadius: tokens.radius.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: n === k ? c.text : c.surface,
                borderWidth: n === k ? 0 : tokens.borderWidth.hairline,
                borderColor: c.border,
              }}
            >
              <Text variant="heading" style={{ fontWeight: '500', color: n === k ? c.bg : c.text }}>
                {k}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </BottomSheet>
  );
}

export function MoveSheet({
  visible,
  from,
  halls,
  taken,
  moving,
  onMove,
  onClose,
}: {
  visible: boolean;
  from: number;
  halls: HallDto[];
  /** Busy or held tables (not offered). */
  taken: Set<number>;
  moving: boolean;
  onMove: (to: number) => void;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const { t } = useI18n();
  // Remounted each time it opens (key): nothing is picked yet.
  const [to, setTo] = useState<number | null>(null);
  const groups = halls
    .filter((h) => h.isActive)
    .map((h) => ({ hall: h, free: h.tables.filter((tb) => tb.isActive && tb.number !== from && !taken.has(tb.number)) }))
    .filter((g) => g.free.length > 0);
  return (
    <BottomSheet
      visible={visible}
      title={t('sheet.move.title')}
      subtitle={t('sheet.move.subtitle')}
      onClose={onClose}
      footer={
        <View style={{ gap: 12 }}>
          {to !== null ? (
            <View style={{ backgroundColor: c.primarySoft, borderRadius: tokens.radius.md, padding: 14 }}>
              <Text variant="heading" center>
                {t('sheet.move.confirm', { from: t('common.table', { n: from }), to: t('common.table', { n: to }) })}
              </Text>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button variant="secondary" label={t('common.cancel')} fullWidth onPress={onClose} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label={t('sheet.move.cta')} fullWidth disabled={to === null} loading={moving} onPress={() => to !== null && onMove(to)} />
            </View>
          </View>
        </View>
      }
    >
      <ScrollView style={{ maxHeight: 360 }}>
        {groups.map((g) => (
          <View key={g.hall.id} style={{ gap: 8, marginBottom: 12 }}>
            {groups.length > 1 || halls.length > 1 ? (
              <Text variant="meta" color="muted">
                {g.hall.name}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {g.free.map((tb) => {
                const selected = to === tb.number;
                return (
                  <Pressable
                    key={tb.id}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.table', { n: tb.number })}
                    accessibilityState={{ selected }}
                    onPress={() => setTo(tb.number)}
                    style={{
                      width: '23%',
                      height: 64,
                      borderRadius: tokens.radius.md,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: selected ? tokens.borderWidth.selected : tokens.borderWidth.hairline,
                      borderColor: selected ? c.primary : c.border,
                      backgroundColor: selected ? c.primarySoft : c.surface,
                    }}
                  >
                    <Text variant="title">{tb.number}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

export interface ShortageFix {
  shortage: Shortage;
  /** The quantity "Tuzatish" sets; null when it cannot fix it alone (portions, weight). */
  fixTo: number | null;
}

export function ShortageSheet({
  fixes,
  onFix,
  onClose,
}: {
  fixes: ShortageFix[] | null;
  onFix: (fix: ShortageFix) => void;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const { t } = useI18n();
  return (
    <BottomSheet
      visible={!!fixes}
      dismissible={false}
      title={t('sheet.stock.title')}
      subtitle={t('sheet.stock.subtitle')}
      leading={
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.warningSoft, alignItems: 'center', justifyContent: 'center' }}>
          <TriangleAlert size={24} color={c.warning} strokeWidth={2} />
        </View>
      }
      onClose={onClose}
      footer={<Button variant="secondary" label={t('common.close')} fullWidth onPress={onClose} />}
    >
      <View style={{ gap: 12, paddingVertical: 8 }}>
        {(fixes ?? []).map((f) => (
          <View key={f.shortage.menuItemId} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: tokens.radius.md, borderWidth: tokens.borderWidth.strong, borderColor: c.warning, backgroundColor: c.warningSoft }}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">{f.shortage.nameUz}</Text>
                {f.shortage.reason === 'INSUFFICIENT' ? (
                  <Text>{t('sheet.stock.line', { asked: f.shortage.requested ?? '', left: f.shortage.remaining ?? '0' })}</Text>
                ) : (
                  <Text>{t('order.stock.out')}</Text>
                )}
              </View>
              {f.fixTo !== null ? <Button label={t('sheet.stock.fix')} onPress={() => onFix(f)} /> : null}
            </View>
            {f.fixTo !== null ? (
              <Text variant="meta" color="muted">
                {t('sheet.stock.hint', { left: f.fixTo })}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </BottomSheet>
  );
}

export function CartSheet({
  visible,
  table,
  lines,
  order,
  settings,
  guests,
  summary,
  saving,
  canPrebill,
  canSave,
  onQuantity,
  onRemove,
  onEditPortion,
  onEditWeight,
  onPrebill,
  onSave,
  onClose,
}: {
  visible: boolean;
  table: number;
  lines: DraftLine[];
  order: OrderDto | null;
  settings: AppSettings | null;
  guests: number | null;
  summary: string;
  saving: boolean;
  canPrebill: boolean;
  canSave: boolean;
  onQuantity: (line: DraftLine, quantity: number) => void;
  onRemove: (line: DraftLine) => void;
  onEditPortion: (line: DraftLine) => void;
  onEditWeight: (line: DraftLine) => void;
  onPrebill: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const { t, lang } = useI18n();
  // The handoff: the lines take up to 55% of the screen, the totals and buttons stay pinned.
  const listMax = useWindowDimensions().height * 0.45;
  const sums = totals(lines, settings, guests);
  const feeLabel = feeLabelOf(settings, guests, t, lang);
  return (
    <BottomSheet
      visible={visible}
      title={t('order.sheet.title', { table: t('common.table', { n: table }) })}
      subtitle={summary}
      onClose={onClose}
      footer={
        <View style={{ gap: 12 }}>
          <View style={{ gap: 4, borderTopWidth: tokens.borderWidth.hairline, borderTopColor: c.border, paddingTop: 12 }}>
            {feeLabel && dec(sums.fee).gt(0) ? (
              <>
                <Row label={t('order.sheet.subtotal')} value={money(sums.dishes, lang)} />
                <Row label={feeLabel} value={money(sums.fee, lang)} />
              </>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Text variant="heading" style={{ fontWeight: '500' }}>
                {t('order.sheet.total')}
              </Text>
              <Text variant="display">{money(sums.total, lang)}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button variant="secondary" icon={Printer} label={t('order.prebill')} fullWidth disabled={!canPrebill} onPress={onPrebill} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label={t('order.save')} loading={saving} loadingLabel={t('order.saving')} fullWidth disabled={!canSave} onPress={onSave} />
            </View>
          </View>
        </View>
      }
    >
      <ScrollView style={{ maxHeight: listMax }}>
        {lines.map((l) => {
          const fresh = isNewLine(l, order);
          const unit = l.soldByWeight
            ? `${formatMoney(l.price, asLanguage(lang), false)} / ${t('common.unit.kg')}`
            : l.hasPortions
              ? `${formatMoney(l.price, asLanguage(lang), false)} / ${t('common.unit.perPortion')}`
              : `${formatMoney(l.price, asLanguage(lang), false)} × ${l.quantity}`;
          return (
            <View key={l.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: tokens.borderWidth.hairline, borderBottomColor: c.border }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontWeight: '500' }}>{lang === 'ru' && l.nameRu ? l.nameRu : l.nameUz}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                  <Text variant="meta" color="muted">
                    {unit}
                  </Text>
                  {fresh ? (
                    <View style={{ backgroundColor: c.warningSoft, borderRadius: tokens.radius.sm, paddingHorizontal: 6 }}>
                      <Text variant="caption" color="warningText" style={{ fontWeight: '700' }}>
                        {t('order.sheet.new')}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
              {l.soldByWeight || l.hasPortions ? (
                <QtyStepper
                  mode="picker"
                  label={l.soldByWeight ? `${weightText(l.weightKg ?? '0')} ${t('common.unit.kg')}` : `${l.portion ?? '1'} ${t('common.unit.portion')}`}
                  accessibilityLabel={`${lang === 'ru' && l.nameRu ? l.nameRu : l.nameUz}: ${l.soldByWeight ? weightText(l.weightKg ?? '0') : l.portion}`}
                  onPress={() => (l.soldByWeight ? onEditWeight(l) : onEditPortion(l))}
                />
              ) : (
                <QtyStepper
                  mode="stepper"
                  variant="neutral"
                  value={String(l.quantity)}
                  atOne={l.quantity <= 1}
                  onIncrease={() => onQuantity(l, l.quantity + 1)}
                  onDecrease={() => (l.quantity <= 1 ? onRemove(l) : onQuantity(l, l.quantity - 1))}
                  increaseLabel={t('common.increase')}
                  decreaseLabel={t('common.decrease')}
                  removeLabel={t('common.remove')}
                />
              )}
              <Text variant="bodyStrong" style={{ minWidth: 72, textAlign: 'right' }}>
                {formatMoney(lineTotal(l), asLanguage(lang), false)}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </BottomSheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text color="muted">{label}</Text>
      <Text color="muted">{value}</Text>
    </View>
  );
}

export const localized = (d: { nameUz: string; nameRu: string | null }, lang: 'uz' | 'ru') =>
  lang === 'ru' && d.nameRu ? d.nameRu : d.nameUz;

/** The fee row's label, as the cart shows it: "Xizmat haqi 5%" or "Xizmat haqi (4 × 5 000)". */
export function feeLabelOf(
  settings: AppSettings | null,
  guests: number | null,
  t: (key: 'order.sheet.service' | 'order.sheet.servicePerGuest', p: Record<string, string | number>) => string,
  lang: 'uz' | 'ru',
): string | null {
  if (settings?.serviceFeeType === 'percent')
    return t('order.sheet.service', { percent: settings.serviceFeePercent.replace(/\.0+$/, '').replace('.', ',') });
  if (settings?.serviceFeeType === 'perGuest')
    return t('order.sheet.servicePerGuest', { n: guests ?? 1, fee: formatMoney(settings.serviceFeePerGuest, asLanguage(lang), false) });
  return null;
}
