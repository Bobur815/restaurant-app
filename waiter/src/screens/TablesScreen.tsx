import { LayoutGrid, Lock } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { HallDto, TableLockDto, TableSummaryDto } from '@shared/types';
import { formatMoney } from '@shared/utils/format';
import { Banner } from '../components/Banner';
import { CategoryChip } from '../components/Order';
import { TableCard, type TableStatus } from '../components/TableCard';
import { EmptyState, IconButton, Screen, Segmented, Text } from '../components/ui';
import { asLanguage, useI18n } from '../i18n';
import { minutesSince } from '../lib/cart';
import { checkForUpdate, type Feed } from '../lib/update';
import type { ScreenProps } from '../navigation';
import { useApp, useClient } from '../state/app';
import { useTill } from '../state/useTill';
import { tokens, useTheme } from '../theme';

interface Floor {
  halls: HallDto[];
  busy: TableSummaryDto[];
  locks: TableLockDto[];
  shiftOpen: boolean;
}

/** Checked once per app run: the banner on this screen and the Update screen share it. */
export let updateCheck: Promise<Feed | null> | null = null;
export const resetUpdateCheck = () => {
  updateCheck = null;
};

/** Tables screen (frames "Stollar · ..."): the floor, by hall, mine first in my filter. */
export function TablesScreen({ navigation }: ScreenProps<'Tables'>) {
  const { c } = useTheme();
  const { t, lang } = useI18n();
  const { user, link, signOut } = useApp();
  const client = useClient();
  const [hallId, setHallId] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'mine'>('all');
  const [now, setNow] = useState(new Date());
  const [update, setUpdate] = useState<Feed | null>(null);
  const insets = useSafeAreaInsets();
  // Three equal columns: 16 padding each side, 8 between (the last row keeps the same width).
  const cardWidth = (useWindowDimensions().width - 32 - 16) / 3;

  const floor = useTill<Floor>(async () => {
    const [halls, busy, locks, session] = await Promise.all([
      client.rpc('halls:list'),
      client.rpc('orders:busyTables'),
      client.rpc('orders:tableLocks'),
      client.rpc('sessions:getOpen'),
    ]);
    return { halls, busy, locks, shiftOpen: session !== null };
  }, ['orders-changed', 'session-changed', 'halls-changed']);

  // "45 daq" moves on.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    updateCheck ??= checkForUpdate().catch(() => null);
    void updateCheck.then(setUpdate);
  }, []);

  const data = floor.data;
  const halls = useMemo(() => (data?.halls ?? []).filter((h) => h.isActive), [data]);
  const hall = halls.find((h) => h.id === hallId) ?? halls[0] ?? null;
  const byTable = useMemo(() => new Map((data?.busy ?? []).map((b) => [b.tableNumber, b])), [data]);
  const lockOf = useMemo(() => new Map((data?.locks ?? []).map((l) => [l.tableNumber, l])), [data]);
  const mine = (b: TableSummaryDto | undefined) => !!b && b.createdById === user?.id;

  const hallTables = (hall?.tables ?? []).filter((tb) => tb.isActive);
  const mineCount = hallTables.filter((tb) => mine(byTable.get(tb.number))).length;
  const shown = filter === 'mine' ? hallTables.filter((tb) => mine(byTable.get(tb.number))) : hallTables;

  const offline = link?.state !== 'online';
  const noShift = data !== null && !data.shiftOpen;
  const dimmed = offline || noShift;
  const L = asLanguage(lang);

  const openFor = (iso: string) => {
    const m = minutesSince(iso, now);
    return m < 60 ? t('common.minutes', { m }) : t('common.hoursMinutes', { h: Math.floor(m / 60), m: m % 60 });
  };

  const initial = (user?.fullName ?? '?').trim().charAt(0).toUpperCase();

  return (
    <Screen edges={['top']}>
      <View
        style={{
          height: tokens.size.topBar,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 16,
          backgroundColor: c.surface,
          borderBottomWidth: tokens.borderWidth.hairline,
          borderBottomColor: c.border,
        }}
      >
        <View
          accessible
          accessibilityLabel={link?.state === 'online' ? t('tables.conn.ok') : t('tables.conn.off')}
          style={{ width: tokens.size.avatar, height: tokens.size.avatar, borderRadius: 20, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text variant="heading" color="primaryText">
            {initial}
          </Text>
          <View
            style={{
              position: 'absolute',
              right: -1,
              bottom: -1,
              width: 12,
              height: 12,
              borderRadius: 6,
              borderWidth: 2,
              borderColor: c.surface,
              backgroundColor: link?.state === 'online' ? c.success : c.warning,
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="heading" numberOfLines={1}>
            {user?.fullName ?? ''}
          </Text>
          <Text variant="meta" color="muted">
            {t('tables.role')}
          </Text>
        </View>
        <IconButton icon={Lock} label={t('tables.lock')} onPress={() => void signOut()} />
      </View>
      {update ? (
        <Banner
          kind="update"
          title={t('tables.update.banner', { version: update.version })}
          action={{ label: t('tables.update.cta'), onPress: () => navigation.navigate('Update') }}
        />
      ) : null}
      {noShift ? <Banner kind="warning" title={t('tables.noShift.title')} body={t('tables.noShift.body')} /> : null}
      {offline ? <Banner kind="offline" busy title={t('tables.offline')} /> : null}

      <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 8 }}>
        {halls.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {halls.map((h) => (
              <CategoryChip
                key={h.id}
                label={h.name}
                count={h.tables.filter((tb) => tb.isActive).length}
                selected={h.id === hall?.id}
                onPress={() => setHallId(h.id)}
              />
            ))}
          </ScrollView>
        ) : null}
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('tables.filter.all'), count: floor.loading ? undefined : hallTables.length },
            { value: 'mine', label: t('tables.filter.mine'), count: floor.loading ? undefined : mineCount },
          ]}
        />
      </View>

      {floor.loading && !data ? (
        <View accessibilityLabel={t('tables.loading')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16 }}>
          {Array.from({ length: 18 }, (_, i) => (
            <View key={i} style={{ width: cardWidth, height: tokens.size.tableCardHeight, borderRadius: tokens.radius.md, backgroundColor: c.surface2 }} />
          ))}
        </View>
      ) : (
        <FlatList
          data={shown}
          key="grid3"
          numColumns={3}
          keyExtractor={(tb) => String(tb.id)}
          columnWrapperStyle={{ gap: 8 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 16 + insets.bottom, gap: 8, flexGrow: 1 }}
          onRefresh={floor.reload}
          refreshing={false}
          ListEmptyComponent={
            <EmptyState icon={LayoutGrid} title={t('tables.empty.title')} body={t('tables.empty.body')} />
          }
          renderItem={({ item: tb }) => {
            const busy = byTable.get(tb.number);
            const lock = lockOf.get(tb.number);
            const status: TableStatus =
              lock && !lock.mine ? 'locked' : busy ? (mine(busy) ? 'mine' : 'busy') : 'free';
            const label = t('common.table', { n: tb.number });
            const aria =
              status === 'free'
                ? `${label}, ${t('tables.aria.free')}`
                : status === 'locked'
                  ? `${label}, ${t('tables.aria.openElsewhere')}`
                  : `${label}, ${formatMoney(busy!.totalAmount, L)}, ${busy!.createdBy ?? ''}, ${openFor(busy!.openedAt)}`;
            return (
              <View style={{ width: cardWidth }}>
                <TableCard
                  number={String(tb.number)}
                  status={status}
                  total={busy ? formatMoney(busy.totalAmount, L) : undefined}
                  waiterName={busy?.createdBy ?? undefined}
                  openFor={busy ? openFor(busy.openedAt) : undefined}
                  lockedBy={lock?.userName || t('tables.openOnTill')}
                  youLabel={t('tables.you')}
                  dimmed={dimmed}
                  accessibilityLabel={aria}
                  onPress={() => navigation.navigate('Order', { tableNumber: tb.number })}
                />
              </View>
            );
          }}
        />
      )}
    </Screen>
  );
}
