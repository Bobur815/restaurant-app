import { usePreventRemove } from '@react-navigation/native';
import {
  ArrowLeftRight,
  CircleAlert,
  MoreVertical,
  Printer,
  RefreshCw,
  Search,
  Trash2,
  Users,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, TextInput, View } from 'react-native';
import { hasPermission } from '@shared/permissions';
import { TABLE_LOCK_RENEW_MS } from '@shared/table-lock';
import type { AppSettings, CategoryDto, HallDto, MenuItemDto, OrderDto, SessionDto } from '@shared/types';
import { dec } from '@shared/utils/decimal';
import { formatMoney, formatQty } from '@shared/utils/format';
import {
  addDish,
  fromOrder,
  removeLine,
  sameAsSaved,
  savedUsage,
  setPortion,
  setQuantity,
  setWeight,
  toSaveInput,
  type DraftLine,
} from '@shared/utils/order-draft';
import type { PortionFactor } from '@shared/utils/order-line';
import { isApiError, isVersionConflict, shortagesOf } from '../api/errors';
import { Banner } from '../components/Banner';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { CartBar, CategoryChip, DishRow } from '../components/Order';
import { useToast } from '../components/Toast';
import { IconButton, Screen, Spinner, Text, TopBar } from '../components/ui';
import { asLanguage, useI18n } from '../i18n';
import { itemCount, newLineCount, stockTag, totals, weightText } from '../lib/cart';
import type { ScreenProps } from '../navigation';
import { useApp, useClient } from '../state/app';
import { useTill } from '../state/useTill';
import { tokens, useTheme } from '../theme';
import {
  CartSheet,
  feeLabelOf,
  GuestsSheet,
  localized,
  MoveSheet,
  PortionSheet,
  ShortageSheet,
  WeightSheet,
  type ShortageFix,
} from './order/sheets';

interface Catalog {
  menu: MenuItemDto[];
  categories: CategoryDto[];
  settings: AppSettings;
  session: SessionDto | null;
}

type Editing = { dish: MenuItemDto; line: DraftLine | null };

/**
 * Order screen (frames "Buyurtma · ..."): one table's order. The phone holds the table's lease
 * like a till (F13); without it, or for another waiter's order, the order is read-only.
 */
export function OrderScreen({ navigation, route }: ScreenProps<'Order'>) {
  const { tableNumber } = route.params;
  const { c } = useTheme();
  const { t, tc, lang } = useI18n();
  const L = asLanguage(lang);
  const { user, link } = useApp();
  const client = useClient();
  const toast = useToast();

  const catalog = useTill<Catalog>(async () => {
    const [menu, categories, settings, session] = await Promise.all([
      client.rpc('menu:list'),
      client.rpc('categories:list'),
      client.rpc('settings:get'),
      client.rpc('sessions:getOpen'),
    ]);
    return { menu, categories: categories.filter((x) => x.isActive), settings, session };
  }, ['menu-changed', 'session-changed', 'settings-changed']);
  const menu = catalog.data?.menu ?? null;
  const settings = catalog.data?.settings ?? null;
  const session = catalog.data?.session ?? null;

  const [order, setOrder] = useState<OrderDto | null | undefined>(undefined);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [guests, setGuests] = useState<number | null>(null);
  const [held, setHeld] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [cartOpen, setCartOpen] = useState(false);
  const [portion, setPortionEdit] = useState<Editing | null>(null);
  const [weight, setWeightEdit] = useState<Editing | null>(null);
  const [guestsOpen, setGuestsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveData, setMoveData] = useState<{ halls: HallDto[]; taken: Set<number> } | null>(null);
  const [moving, setMoving] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [shortage, setShortage] = useState<ShortageFix[] | null>(null);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  /** The draft is rebuilt from the next loaded order (first load, conflict reload, others' change). */
  const [needsSync, setNeedsSync] = useState(true);
  /** Leaving on purpose (moved, cancelled, "Saqlamasdan chiqish"): the unsaved guard steps aside. */
  const [allowLeave, setAllowLeave] = useState(false);
  const afterLeave = useRef<(() => void) | null>(null);

  // ── the order and the table's lease ─────────────────────────────────────────────────────
  const loadOrder = useCallback(
    async (reset: boolean) => {
      try {
        const o = await client.rpc('orders:getTable', { tableNumber });
        setOrder(o);
        if (reset) setNeedsSync(true);
      } catch (e) {
        if (!isApiError(e, 'OFFLINE')) toast.show({ kind: 'error', message: errorText(e, t('common.error')) });
      }
    },
    [client, tableNumber, toast, t],
  );

  // Lines come from the saved order once both it and the menu (current prices) are in
  // (React's "adjust state while rendering": no extra render with a half-built draft).
  if (needsSync && order !== undefined && menu) {
    setNeedsSync(false);
    setLines(order ? fromOrder(order, menu) : []);
    setGuests(order?.guestCount ?? null);
  }

  useEffect(() => {
    let alive = true;
    let holding = false;
    const lock = async () => {
      try {
        const r = await client.rpc('orders:lockTable', { tableNumber });
        holding = r.held;
        if (alive) setHeld(r.held);
      } catch (e) {
        if (alive && !isApiError(e, 'OFFLINE')) setHeld(false);
      }
    };
    void lock();
    // loadOrder sets state only after its await (the rule cannot see through the async call).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadOrder(true);
    const renew = setInterval(() => void lock(), TABLE_LOCK_RENEW_MS);
    return () => {
      alive = false;
      clearInterval(renew);
      if (holding) void client.rpc('orders:unlockTable', { tableNumber }).catch(() => undefined);
    };
  }, [client, tableNumber, loadOrder]);

  const dirty = order !== undefined && (!sameAsSaved(lines, order) || guests !== (order?.guestCount ?? null));

  // Someone else changed this table: reload when nothing here is unsaved; else Save finds out.
  const { onEvent } = useApp();
  useEffect(
    () =>
      onEvent((e) => {
        if (e.type !== 'orders-changed') return;
        if (e.tableNumber !== undefined && e.tableNumber !== tableNumber) return;
        if (!dirty && !saving) void loadOrder(true);
        else if (!saving) void client.rpc('orders:getTable', { tableNumber }).then((o) => {
          if ((o?.version ?? -1) !== (order?.version ?? -1)) setConflict(true);
        }).catch(() => undefined);
      }),
    [onEvent, tableNumber, dirty, saving, loadOrder, client, order],
  );

  const ownOrder = !order || order.createdById === user?.id || hasPermission(user, 'ordersOthers');
  const readOnly = held === false || !ownOrder;
  const offline = link?.state !== 'online';

  // ── leaving with unsaved changes ────────────────────────────────────────────────────────
  usePreventRemove(dirty && !readOnly && !allowLeave, ({ data }) => {
    setPendingLeave(() => () => navigation.dispatch(data.action));
  });

  // The guard is off from the next render on; only then does the navigation run.
  useEffect(() => {
    if (!allowLeave) return;
    const go = afterLeave.current;
    afterLeave.current = null;
    if (go) go();
    else navigation.goBack();
  }, [allowLeave, navigation]);

  const leave = (then?: () => void) => {
    afterLeave.current = then ?? null;
    setAllowLeave(true);
  };

  // ── editing ─────────────────────────────────────────────────────────────────────────────
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (menu ?? []).filter(
      (m) =>
        m.isActive &&
        (categoryId === null || m.categoryId === categoryId) &&
        (!needle || m.nameUz.toLocaleLowerCase().includes(needle) || (m.nameRu ?? '').toLocaleLowerCase().includes(needle)),
    );
  }, [menu, categoryId, search]);

  const add = (dish: MenuItemDto) => {
    if (dish.soldByWeight) return setWeightEdit({ dish, line: null });
    if (dish.hasPortions) return setPortionEdit({ dish, line: null });
    setLines((ls) => addDish(ls, dish));
  };

  const pickPortion = (p: PortionFactor) => {
    if (!portion) return;
    const { dish, line } = portion;
    setLines((ls) => {
      if (line) return setPortion(ls, line.key, p);
      const same = ls.find((l) => l.menuItemId === dish.id && l.portion === p && !l.soldByWeight);
      if (same) return setQuantity(ls, same.key, same.quantity + 1);
      const fresh = addDish([], dish);
      return [...ls, ...setPortion(fresh, fresh[0]!.key, p)];
    });
    setPortionEdit(null);
  };

  const pickWeight = (kg: string) => {
    if (!weight) return;
    const { dish, line } = weight;
    setLines((ls) => (line ? setWeight(ls, line.key, kg) : addDish(ls, dish, kg)));
    setWeightEdit(null);
  };

  // ── saving ──────────────────────────────────────────────────────────────────────────────
  const save = async (): Promise<boolean> => {
    if (lines.length === 0 || saving) return false;
    setSaving(true);
    try {
      const saved = await client.rpc('orders:save', {
        ...toSaveInput(tableNumber, lines, order?.version),
        ...(guests !== null ? { guestCount: guests } : {}),
      });
      setOrder(saved);
      setLines(fromOrder(saved, menu ?? []));
      setGuests(saved.guestCount ?? null);
      setCartOpen(false);
      toast.show({ kind: 'success', message: t('order.saved') });
      return true;
    } catch (e) {
      const short = shortagesOf(e);
      if (short) {
        setCartOpen(false);
        const saved = savedUsage(order ?? null);
        setShortage(
          short.map((s) => {
            const plain = lines.filter((l) => l.menuItemId === s.menuItemId && !l.soldByWeight && !l.hasPortions);
            const canFix = s.reason === 'INSUFFICIENT' && plain.length === 1 && lines.filter((l) => l.menuItemId === s.menuItemId).length === 1;
            const fixTo = canFix ? Math.floor(dec(saved.get(s.menuItemId) ?? '0').plus(s.remaining ?? '0').toNumber()) : null;
            return { shortage: s, fixTo: s.reason === 'NOT_IN_SESSION' ? 0 : fixTo };
          }),
        );
      } else if (isVersionConflict(e)) {
        setCartOpen(false);
        setConflict(true);
      } else {
        toast.show({
          kind: 'error',
          message: isApiError(e, 'OFFLINE') ? t('toast.saveFailed') : errorText(e, t('toast.saveFailed')),
          action: { label: t('common.retry'), onPress: () => void save() },
        });
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  const fixShortage = (f: ShortageFix) => {
    setLines((ls) => {
      const line = ls.find((l) => l.menuItemId === f.shortage.menuItemId);
      if (!line) return ls;
      return f.fixTo === null || f.fixTo <= 0 ? removeLine(ls, line.key) : setQuantity(ls, line.key, f.fixTo);
    });
    setShortage((list) => {
      const rest = (list ?? []).filter((x) => x.shortage.menuItemId !== f.shortage.menuItemId);
      return rest.length ? rest : null;
    });
  };

  const prebill = async () => {
    if (!order) return;
    try {
      await client.rpc('printing:printPreBill', { orderId: order.id });
      toast.show({ kind: 'info', message: t('toast.prebillSent'), icon: Printer });
    } catch (e) {
      toast.show({ kind: 'error', message: errorText(e, t('common.error')) });
    }
  };

  const openMove = async () => {
    setMenuOpen(false);
    try {
      const [halls, busy, locks] = await Promise.all([
        client.rpc('halls:list'),
        client.rpc('orders:busyTables'),
        client.rpc('orders:tableLocks'),
      ]);
      const taken = new Set<number>([...busy.map((b) => b.tableNumber), ...locks.filter((l) => !l.mine).map((l) => l.tableNumber)]);
      setMoveData({ halls, taken });
    } catch (e) {
      toast.show({ kind: 'error', message: errorText(e, t('common.error')) });
    }
  };

  const move = async (to: number) => {
    if (!order) return;
    setMoving(true);
    try {
      await client.rpc('orders:moveTable', { fromTable: tableNumber, toTable: to, expectedVersion: order.version });
      setMoveData(null);
      toast.show({ kind: 'success', message: t('toast.moved', { table: t('common.table', { n: to }) }) });
      leave();
    } catch (e) {
      if (isVersionConflict(e)) {
        setMoveData(null);
        setConflict(true);
      } else toast.show({ kind: 'error', message: errorText(e, t('common.error')) });
    } finally {
      setMoving(false);
    }
  };

  const cancelOrder = async () => {
    if (!order) return;
    setCancelling(true);
    try {
      await client.rpc('orders:cancel', { tableNumber, expectedVersion: order.version });
      setConfirmCancel(false);
      toast.show({ kind: 'success', message: t('toast.cancelled') });
      leave();
    } catch (e) {
      setConfirmCancel(false);
      if (isVersionConflict(e)) setConflict(true);
      else toast.show({ kind: 'error', message: errorText(e, t('common.error')) });
    } finally {
      setCancelling(false);
    }
  };

  // ── rendering ───────────────────────────────────────────────────────────────────────────
  const title = t('common.table', { n: tableNumber });
  const guestsShown = guests ?? order?.guestCount ?? null;
  const guestsChip = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('order.guestsAria', { n: guestsShown ?? '—' })}
      disabled={readOnly}
      onPress={() => setGuestsOpen(true)}
      style={{ height: 44, borderRadius: tokens.radius.pill, borderWidth: tokens.borderWidth.hairline, borderColor: c.border, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 }}
    >
      <Users size={18} color={c.muted} strokeWidth={2} />
      <Text variant="bodyStrong">{guestsShown ?? '—'}</Text>
    </Pressable>
  );

  const top = (
    <TopBar onBack={() => navigation.goBack()} backLabel={t('common.back')}>
      <Text variant="title" style={{ flex: 1 }} numberOfLines={1}>
        {title}
      </Text>
      {guestsChip}
      {!readOnly && order ? <IconButton icon={MoreVertical} label={t('order.menu.moreAria')} onPress={() => setMenuOpen(true)} /> : null}
    </TopBar>
  );

  if (order === undefined || !catalog.data) {
    return (
      <Screen>
        {top}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Spinner size="large" />
        </View>
      </Screen>
    );
  }

  if (readOnly) {
    const owner = order?.createdBy ?? '';
    return (
      <Screen>
        {top}
        <Banner
          kind="info"
          title={held === false && ownOrder ? t('order.lockedElsewhere') : t('order.readonly.owner', { name: owner })}
          body={held === false && ownOrder ? undefined : t('order.readonly.only')}
        />
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {order ? (
            <View style={{ backgroundColor: c.surface, borderRadius: tokens.radius.md, borderWidth: tokens.borderWidth.hairline, borderColor: c.border, paddingHorizontal: 12 }}>
              {order.lines.map((l, i) => (
                <View key={l.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: i ? tokens.borderWidth.hairline : 0, borderTopColor: c.border }}>
                  <Text variant="bodyStrong" color="muted" style={{ minWidth: 36 }}>
                    {formatQty(l.quantity, L)} ×
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text>
                      {localized(l, lang)}
                      {l.portion && l.portion !== '1' ? ` (${l.portion})` : ''}
                      {l.weightKg ? ` ${weightText(l.weightKg)} ${t('common.unit.kg')}` : ''}
                    </Text>
                    <Text variant="meta" color="muted">
                      {formatMoney(l.unitPrice, L, false)}
                    </Text>
                  </View>
                  <Text variant="bodyStrong">{formatMoney(l.totalPrice, L, false)}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
        {order ? (
          <View style={{ backgroundColor: c.surface, borderTopWidth: tokens.borderWidth.hairline, borderTopColor: c.border, padding: 16, gap: 6 }}>
            {dec(order.serviceFee).gt(0) ? (
              <>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text color="muted">{t('order.sheet.subtotal')}</Text>
                  <Text color="muted">{formatMoney(dec(order.totalAmount).minus(order.serviceFee).toFixed(), L)}</Text>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text color="muted">{feeLabelOf(settings, order.guestCount, t, lang) ?? ''}</Text>
                  <Text color="muted">{formatMoney(order.serviceFee, L)}</Text>
                </View>
              </>
            ) : null}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text variant="heading" style={{ fontWeight: '500' }}>
                {t('order.sheet.total')}
              </Text>
              <Text variant="display">{formatMoney(order.totalAmount, L)}</Text>
            </View>
            <Button icon={Printer} label={t('order.prebill')} fullWidth disabled={offline} onPress={() => void prebill()} />
          </View>
        ) : null}
      </Screen>
    );
  }

  const pictures = settings?.showMenuImages ?? false;
  const chipPictures = settings?.showCategoryImages ?? false;
  const count = itemCount(lines);
  const sums = totals(lines, settings, guestsShown);
  const noShift = session === null;

  const plainLine = (dish: MenuItemDto) =>
    !dish.soldByWeight && !dish.hasPortions ? lines.find((l) => l.menuItemId === dish.id) : undefined;

  return (
    <Screen edges={['top']}>
      {top}
      {offline ? <Banner kind="offline" busy title={t('tables.offline')} /> : null}
      {noShift ? <Banner kind="warning" title={t('tables.noShift.title')} body={t('tables.noShift.body')} /> : null}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 4 }}>
        <View style={{ height: tokens.size.button, borderRadius: tokens.radius.md, borderWidth: tokens.borderWidth.hairline, borderColor: c.border, backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 }}>
          <Search size={20} color={c.muted} strokeWidth={2} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t('order.search')}
            placeholderTextColor={c.muted}
            accessibilityLabel={t('order.search')}
            style={{ flex: 1, color: c.text, fontSize: 15 }}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <CategoryChip label={t('order.category.all')} selected={categoryId === null} onPress={() => setCategoryId(null)} showImage={chipPictures} />
          {(catalog.data.categories ?? []).map((cat) => (
            <CategoryChip
              key={cat.id}
              label={localized(cat, lang)}
              selected={categoryId === cat.id}
              showImage={chipPictures}
              image={chipPictures && cat.imageFile ? client.imageSource(cat.imageFile) : null}
              onPress={() => setCategoryId(cat.id)}
            />
          ))}
        </ScrollView>
      </View>
      <FlatList
        data={visible}
        keyExtractor={(d) => String(d.id)}
        style={{ flex: 1 }}
        contentContainerStyle={{ margin: 16, marginTop: 4, borderRadius: tokens.radius.md, borderWidth: tokens.borderWidth.hairline, borderColor: c.border, overflow: 'hidden' }}
        ItemSeparatorComponent={() => <View style={{ height: tokens.borderWidth.hairline, backgroundColor: c.border }} />}
        renderItem={({ item: dish }) => {
          const tag = noShift ? ({ kind: 'out' } as const) : stockTag(dish.id, session, order, lines);
          const line = plainLine(dish);
          const name = localized(dish, lang);
          return (
            <DishRow
              name={name}
              priceLabel={`${formatMoney(dish.price, L)}${dish.soldByWeight ? ` / ${t('common.unit.kg')}` : ''}`}
              showImage={pictures}
              image={pictures && dish.imageFile ? client.imageSource(dish.imageFile) : null}
              unitTag={dish.soldByWeight ? t('common.unit.kg') : null}
              stockTag={
                tag?.kind === 'out' && !line
                  ? { label: t('order.stock.out'), out: true }
                  : tag?.kind === 'low'
                    ? { label: t('order.stock.left', { n: formatQty(tag.left, L) }), out: false }
                    : null
              }
              addLabel={t('order.addAria', { name })}
              onAdd={() => add(dish)}
              stepper={
                line
                  ? {
                      mode: 'stepper',
                      variant: 'tinted',
                      value: String(line.quantity),
                      atOne: line.quantity <= 1,
                      onIncrease: () => setLines((ls) => setQuantity(ls, line.key, line.quantity + 1)),
                      onDecrease: () => setLines((ls) => (line.quantity <= 1 ? removeLine(ls, line.key) : setQuantity(ls, line.key, line.quantity - 1))),
                      increaseLabel: t('common.increase'),
                      decreaseLabel: t('common.decrease'),
                      removeLabel: t('common.remove'),
                      increaseDisabled: tag?.kind === 'out',
                    }
                  : null
              }
            />
          );
        }}
      />
      <CartBar
        summary={count ? tc('order.cart.count', count) : t('order.cart.empty')}
        total={formatMoney(sums.total, L)}
        unsaved={dirty}
        saving={saving}
        saveDisabled={lines.length === 0 || !dirty || offline}
        saveLabel={t('order.save')}
        savingLabel={t('order.saving')}
        openLabel={t('order.cart.openAria')}
        unsavedLabel={t('order.cart.unsavedAria')}
        onOpen={() => setCartOpen(true)}
        onSave={() => void save()}
      />

      <CartSheet
        visible={cartOpen}
        table={tableNumber}
        lines={lines}
        order={order}
        settings={settings}
        guests={guestsShown}
        summary={count ? tc('order.cart.count', count) : t('order.cart.empty')}
        saving={saving}
        canPrebill={!!order && !dirty && !offline}
        canSave={lines.length > 0 && dirty && !offline}
        onQuantity={(l, q) => setLines((ls) => setQuantity(ls, l.key, q))}
        onRemove={(l) => setLines((ls) => removeLine(ls, l.key))}
        onEditPortion={(l) => {
          const dish = menu?.find((m) => m.id === l.menuItemId);
          if (dish) {
            setCartOpen(false);
            setPortionEdit({ dish, line: l });
          }
        }}
        onEditWeight={(l) => {
          const dish = menu?.find((m) => m.id === l.menuItemId);
          if (dish) {
            setCartOpen(false);
            setWeightEdit({ dish, line: l });
          }
        }}
        onPrebill={() => void prebill()}
        onSave={() => void save()}
        onClose={() => setCartOpen(false)}
      />
      <PortionSheet dish={portion?.dish ?? null} current={(portion?.line?.portion as PortionFactor | null) ?? null} onPick={pickPortion} onClose={() => setPortionEdit(null)} />
      <WeightSheet key={weight ? `${weight.dish.id}:${weight.line?.key ?? 'new'}` : 'none'} dish={weight?.dish ?? null} initial={weight?.line?.weightKg ?? null} onDone={pickWeight} onClose={() => setWeightEdit(null)} />
      <GuestsSheet
        key={guestsOpen ? 'open' : 'closed'}
        visible={guestsOpen}
        initial={guestsShown ?? 1}
        onDone={(n) => {
          setGuests(n);
          setGuestsOpen(false);
        }}
        onClose={() => setGuestsOpen(false)}
      />
      <BottomSheet visible={menuOpen} title={title} onClose={() => setMenuOpen(false)}>
        <View style={{ gap: 4, paddingBottom: 8 }}>
          <MenuItem icon={ArrowLeftRight} label={t('order.menu.move')} disabled={dirty || offline} onPress={() => void openMove()} />
          <MenuItem
            icon={Trash2}
            label={t('order.menu.cancel')}
            danger
            disabled={offline}
            onPress={() => {
              setMenuOpen(false);
              setConfirmCancel(true);
            }}
          />
        </View>
      </BottomSheet>
      <MoveSheet
        key={moveData ? 'open' : 'closed'}
        visible={moveData !== null}
        from={tableNumber}
        halls={moveData?.halls ?? []}
        taken={moveData?.taken ?? new Set()}
        moving={moving}
        onMove={(to) => void move(to)}
        onClose={() => setMoveData(null)}
      />
      <ShortageSheet fixes={shortage} onFix={fixShortage} onClose={() => setShortage(null)} />
      <Dialog
        visible={confirmCancel}
        tone="danger"
        icon={Trash2}
        title={t('dialog.cancel.title')}
        body={t('dialog.cancel.body')}
        onDismiss={() => setConfirmCancel(false)}
        actions={[
          { label: t('dialog.cancel.no'), variant: 'secondary', onPress: () => setConfirmCancel(false) },
          { label: t('dialog.cancel.yes'), variant: 'danger', loading: cancelling, onPress: () => void cancelOrder() },
        ]}
        layout="stack"
      />
      <Dialog
        visible={pendingLeave !== null}
        tone="warning"
        icon={CircleAlert}
        title={t('dialog.unsaved.title')}
        body={t('dialog.unsaved.body', { n: newLineCount(lines, order) })}
        layout="stack"
        onDismiss={() => setPendingLeave(null)}
        actions={[
          {
            label: t('dialog.unsaved.save'),
            variant: 'primary',
            loading: saving,
            onPress: () => {
              const go = pendingLeave;
              void save().then((ok) => {
                setPendingLeave(null);
                if (ok && go) leave(go);
              });
            },
          },
          {
            label: t('dialog.unsaved.discard'),
            variant: 'ghost',
            ghostColor: 'danger',
            onPress: () => {
              const go = pendingLeave;
              setPendingLeave(null);
              if (go) leave(go);
            },
          },
          { label: t('dialog.unsaved.stay'), variant: 'ghost', ghostColor: 'text', onPress: () => setPendingLeave(null) },
        ]}
      />
      <Dialog
        visible={conflict}
        icon={RefreshCw}
        title={t('dialog.conflict.title')}
        body={t('dialog.conflict.body')}
        dismissible={false}
        actions={[
          {
            label: t('dialog.conflict.cta'),
            variant: 'primary',
            icon: RefreshCw,
            onPress: () => {
              setConflict(false);
              void loadOrder(true);
            },
          },
        ]}
      />
    </Screen>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onPress,
  danger,
  disabled,
}: {
  icon: typeof Trash2;
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const { c } = useTheme();
  const color = disabled ? c.disabledFg : danger ? c.danger : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ height: 56, borderRadius: tokens.radius.md, flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 8, backgroundColor: pressed ? c.surface2 : 'transparent' })}
    >
      <Icon size={22} color={color} strokeWidth={2} />
      <Text variant="body" style={{ color, fontWeight: '500' }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Main's Uzbek message for a refusal; a generic line for the phone's own codes. */
function errorText(e: unknown, fallback: string): string {
  if (isApiError(e) && !['OFFLINE', 'UNPAIRED', 'LIMIT', 'INTERNAL'].includes(e.code)) return e.message;
  return fallback;
}
