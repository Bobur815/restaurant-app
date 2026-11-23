import { Download, Lock, TriangleAlert } from 'lucide-react-native';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { tokens, useTheme } from '../theme';
import { Text } from './ui';

type Action = { label: string; onPress: () => void };

export interface BannerProps {
  kind: 'warning' | 'offline' | 'info' | 'update';
  title: string;
  body?: string;
  busy?: boolean;
  action?: Action;
  /** Inside a screen's padding (rounded, bordered) instead of full width. */
  boxed?: boolean;
}

/** Handoff Banner: full width under the top bar. */
export function Banner({ kind, title, body, busy, action, boxed }: BannerProps) {
  const { c } = useTheme();
  const bg = { warning: c.warningSoft, offline: c.warningSoft, info: c.surface2, update: c.primarySoft }[kind];
  const fg = { warning: c.warningText, offline: c.warningText, info: c.text, update: c.text }[kind];
  const iconColor = { warning: c.warning, offline: c.warning, info: c.muted, update: c.primaryText }[kind];
  const Icon = kind === 'info' ? Lock : kind === 'update' ? Download : TriangleAlert;

  if (kind === 'offline') {
    return (
      <View
        accessibilityRole="alert"
        style={{
          height: tokens.size.offlineBar,
          backgroundColor: bg,
          borderBottomWidth: tokens.borderWidth.hairline,
          borderBottomColor: c.warning,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <ActivityIndicator size="small" color={c.warning} />
        <Text variant="buttonSmall" style={{ color: fg }}>
          {title}
        </Text>
      </View>
    );
  }

  return (
    <View
      accessibilityRole={kind === 'warning' ? 'alert' : undefined}
      style={{
        backgroundColor: bg,
        paddingHorizontal: 16,
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        ...(boxed
          ? {
              borderRadius: tokens.radius.md,
              borderWidth: tokens.borderWidth.hairline,
              borderColor: kind === 'warning' ? c.warning : c.border,
            }
          : {
              borderBottomWidth: tokens.borderWidth.hairline,
              borderBottomColor: kind === 'warning' ? c.warning : c.border,
            }),
      }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={iconColor} />
      ) : (
        <Icon size={22} color={iconColor} strokeWidth={2} />
      )}
      <View style={{ flex: 1 }}>
        <Text variant={body ? 'bodyStrong' : 'body'} style={{ color: fg }}>
          {title}
        </Text>
        {body ? <Text variant="meta">{body}</Text> : null}
      </View>
      {action ? (
        <Pressable accessibilityRole="button" onPress={action.onPress} hitSlop={12}>
          <Text variant="heading" color="primaryText">
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
