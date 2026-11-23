import { Clock, Lock } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { tokens, useTheme } from '../theme';
import { Text } from './ui';

export type TableStatus = 'free' | 'busy' | 'mine' | 'locked';

export interface TableCardProps {
  number: string;
  status: TableStatus;
  /** Formatted already ("245 000 so'm"). */
  total?: string;
  waiterName?: string;
  /** Formatted already ("45 daq"). */
  openFor?: string;
  /** Locked: who holds it, or "Kassada ochiq". */
  lockedBy?: string;
  youLabel: string;
  dimmed?: boolean;
  accessibilityLabel: string;
  onPress?: () => void;
}

/** Handoff TableCard: 100 high, radius 10, number 30/700; free, busy, mine, locked, dimmed. */
export function TableCard(p: TableCardProps) {
  const { c } = useTheme();
  const busy = p.status === 'busy' || p.status === 'mine';
  const locked = p.status === 'locked';
  const grey = p.dimmed && busy;
  const bg = locked || grey ? c.surface2 : busy ? c.primarySoft : c.surface;
  const numberColor = locked || p.dimmed ? c.muted : c.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={p.accessibilityLabel}
      accessibilityState={{ disabled: !!p.dimmed }}
      disabled={p.dimmed}
      onPress={p.onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: tokens.size.tableCardHeight,
        borderRadius: tokens.radius.md,
        backgroundColor: bg,
        borderWidth: busy || locked ? 0 : tokens.borderWidth.hairline,
        borderColor: c.border,
        borderLeftWidth: p.status === 'mine' ? tokens.borderWidth.mineAccent : busy || locked ? 0 : tokens.borderWidth.hairline,
        borderLeftColor: p.status === 'mine' ? (p.dimmed ? c.muted : c.primary) : c.border,
        padding: 8,
        paddingLeft: p.status === 'mine' ? 6 : 8,
        opacity: pressed ? 0.8 : 1,
        justifyContent: 'space-between',
      })}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Text variant="display" style={{ color: numberColor }}>
          {p.number}
        </Text>
        {p.status === 'mine' ? (
          <View
            style={{
              borderRadius: tokens.radius.pill,
              backgroundColor: p.dimmed ? c.surface : c.primary,
              paddingHorizontal: 8,
              paddingVertical: 2,
            }}
          >
            <Text variant="caption" style={{ color: p.dimmed ? c.muted : c.onPrimary, fontWeight: '700' }}>
              {p.youLabel}
            </Text>
          </View>
        ) : null}
        {locked ? <Lock size={18} color={c.muted} strokeWidth={2} /> : null}
      </View>
      {busy ? (
        <View>
          <Text variant="meta" style={{ fontWeight: '700', color: p.dimmed ? c.muted : c.text }} numberOfLines={1}>
            {p.total}
          </Text>
          {p.waiterName ? (
            <Text variant="caption" color="muted" numberOfLines={1}>
              {p.waiterName}
            </Text>
          ) : null}
          {p.openFor ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Clock size={12} color={c.muted} strokeWidth={2} />
              <Text variant="caption" color="muted">
                {p.openFor}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {locked && p.lockedBy ? (
        <Text variant="caption" color="muted" numberOfLines={2}>
          {p.lockedBy}
        </Text>
      ) : null}
    </Pressable>
  );
}
