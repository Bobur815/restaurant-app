import type { LucideIcon } from 'lucide-react-native';
import { Modal, Pressable, View } from 'react-native';
import { tokens, useTheme } from '../theme';
import { Button, type ButtonVariant } from './Button';
import { Text } from './ui';

type Action = {
  label: string;
  onPress: () => void;
  variant: ButtonVariant;
  icon?: LucideIcon;
  ghostColor?: 'primaryText' | 'danger' | 'text' | 'muted';
  loading?: boolean;
};

export interface DialogProps {
  visible: boolean;
  tone?: 'default' | 'danger' | 'warning';
  icon: LucideIcon;
  title: string;
  body?: string;
  actions: Action[];
  /** 2 actions: row; 3: stack. */
  layout?: 'row' | 'stack';
  /** false for "changed on another device": only its action closes it. */
  dismissible?: boolean;
  onDismiss?: () => void;
}

/** Handoff Dialog: centred, max 328, radius 16, 48 round icon, elevation 24. */
export function Dialog({
  visible,
  tone = 'default',
  icon: Icon,
  title,
  body,
  actions,
  layout = 'row',
  dismissible = true,
  onDismiss,
}: DialogProps) {
  const { c } = useTheme();
  const iconBg = { default: c.primarySoft, danger: c.dangerSoft, warning: c.warningSoft }[tone];
  const iconFg = { default: c.primaryText, danger: c.danger, warning: c.warning }[tone];
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {
        if (dismissible) onDismiss?.();
      }}
    >
      <Pressable
        style={{ flex: 1, backgroundColor: c.scrim, alignItems: 'center', justifyContent: 'center', padding: 16 }}
        onPress={() => {
          if (dismissible) onDismiss?.();
        }}
        accessible={false}
      >
        <Pressable
          accessibilityRole="alert"
          onPress={() => undefined}
          style={{
            width: '100%',
            maxWidth: tokens.size.dialogMaxWidth,
            backgroundColor: c.surface,
            borderRadius: tokens.radius.lg,
            paddingHorizontal: 20,
            paddingVertical: 24,
            elevation: tokens.elevation.dialog,
            gap: 12,
          }}
        >
          <View
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: iconBg,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon size={24} color={iconFg} strokeWidth={2} />
          </View>
          <Text variant="heading">{title}</Text>
          {body ? <Text color="muted">{body}</Text> : null}
          <View
            style={{
              flexDirection: layout === 'row' ? 'row' : 'column',
              gap: layout === 'row' ? 8 : 4,
              marginTop: 8,
            }}
          >
            {actions.map((a) => (
              <View key={a.label} style={layout === 'row' ? { flex: 1 } : null}>
                <Button
                  label={a.label}
                  variant={a.variant}
                  icon={a.icon}
                  ghostColor={a.ghostColor}
                  loading={a.loading}
                  onPress={a.onPress}
                  fullWidth
                />
              </View>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
