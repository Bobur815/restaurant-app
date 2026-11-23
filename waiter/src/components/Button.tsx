import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { tokens, useTheme } from '../theme';
import { Text } from './ui';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  label: string;
  variant?: ButtonVariant;
  /** warning = orange outline (PIN "Qayta urinish"). */
  tone?: 'default' | 'warning';
  icon?: LucideIcon;
  /** Icon after the label ("Davom etish →"). */
  trailingIcon?: LucideIcon;
  loading?: boolean;
  loadingLabel?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  /** Text colour for a ghost button ("Saqlamasdan chiqish" in red). */
  ghostColor?: 'primaryText' | 'danger' | 'text' | 'muted';
  onPress?: () => void;
}

/** Handoff Button: 48 high, radius 10, label 18/500 (primary) or 15/500 (others). */
export function Button({
  label,
  variant = 'primary',
  tone = 'default',
  icon: Icon,
  trailingIcon: Trailing,
  loading,
  loadingLabel,
  disabled,
  fullWidth,
  ghostColor = 'primaryText',
  onPress,
}: ButtonProps) {
  const { c } = useTheme();
  const off = disabled || loading;
  const bg = {
    primary: c.primary,
    secondary: c.surface,
    ghost: 'transparent',
    danger: c.danger,
  }[variant];
  const fg = {
    primary: c.onPrimary,
    secondary: tone === 'warning' ? c.warningText : c.text,
    ghost: c[ghostColor],
    danger: c.onDanger,
  }[variant];
  const color = disabled ? c.muted : fg;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      accessibilityLabel={loading && loadingLabel ? loadingLabel : label}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => ({
        height: tokens.size.button,
        borderRadius: tokens.radius.md,
        paddingHorizontal: 16,
        alignSelf: fullWidth ? 'stretch' : 'auto',
        flexGrow: fullWidth ? 1 : 0,
        backgroundColor: disabled && variant !== 'ghost' ? c.disabledBg : bg,
        borderWidth: variant === 'secondary' ? tokens.borderWidth.strong : 0,
        borderColor: tone === 'warning' ? c.warning : c.border,
        opacity: pressed ? 0.85 : loading ? 0.8 : 1,
        alignItems: 'center',
        justifyContent: 'center',
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {loading ? (
          <ActivityIndicator size="small" color={color} />
        ) : Icon ? (
          <Icon size={20} color={color} strokeWidth={2} />
        ) : null}
        <Text
          variant={variant === 'primary' || variant === 'danger' ? 'button' : 'buttonSmall'}
          style={{ color }}
          numberOfLines={1}
        >
          {loading && loadingLabel ? loadingLabel : label}
        </Text>
        {Trailing && !loading ? <Trailing size={20} color={color} strokeWidth={2} /> : null}
      </View>
    </Pressable>
  );
}
