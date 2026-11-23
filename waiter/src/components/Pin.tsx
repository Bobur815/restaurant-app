import { Delete } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { tokens, useTheme } from '../theme';
import { Text } from './ui';

export interface PinDotsProps {
  filled: number;
  state: 'idle' | 'error' | 'checking';
  accessibilityLabel: string;
}

/** Handoff PinDots: 4 dots, 18 dp, 20 apart; error = all red + shake. */
export function PinDots({ filled, state, accessibilityLabel }: PinDotsProps) {
  const { c } = useTheme();
  const [shake] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (state !== 'error') return;
    const d = tokens.motion.pinShake.distance;
    const step = tokens.motion.pinShake.duration / 5;
    Animated.sequence(
      [d, -d, d, -d, 0].map((toValue) =>
        Animated.timing(shake, { toValue, duration: step, useNativeDriver: true }),
      ),
    ).start();
  }, [state, shake]);

  return (
    <Animated.View
      accessible
      accessibilityLabel={accessibilityLabel}
      style={{ flexDirection: 'row', gap: 20, transform: [{ translateX: shake }] }}
    >
      {[0, 1, 2, 3].map((i) => {
        const on = state === 'error' || state === 'checking' || i < filled;
        const color = state === 'error' ? c.danger : c.primary;
        return (
          <View
            key={i}
            style={{
              width: tokens.size.pinDot,
              height: tokens.size.pinDot,
              borderRadius: tokens.size.pinDot / 2,
              borderWidth: on ? 0 : 2,
              borderColor: c.muted,
              backgroundColor: on ? color : 'transparent',
            }}
          />
        );
      })}
    </Animated.View>
  );
}

export interface PinKeypadProps {
  disabled?: boolean;
  onDigit: (digit: string) => void;
  onErase: () => void;
  eraseLabel: string;
  /** Weight keypad: "," in slot 10 and smaller keys (56). */
  comma?: boolean;
  keyHeight?: number;
}

/** Handoff PinKeypad: 3x4, keys 72 high, radius 16, gap 12; slot 10 empty, slot 12 erase. */
export function PinKeypad({ disabled, onDigit, onErase, eraseLabel, comma, keyHeight }: PinKeypadProps) {
  const { c } = useTheme();
  const height = keyHeight ?? tokens.size.pinKey;
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', comma ? ',' : '', '0', 'erase'];
  const rows = [keys.slice(0, 3), keys.slice(3, 6), keys.slice(6, 9), keys.slice(9, 12)];
  return (
    <View style={{ gap: 12 }}>
      {rows.map((r, ri) => (
        <View key={ri} style={{ flexDirection: 'row', gap: 12 }}>
          {r.map((k, ki) => {
            if (k === '') return <View key={ki} style={{ flex: 1, height }} />;
            const erase = k === 'erase';
            return (
              <Pressable
                key={ki}
                accessibilityRole="button"
                accessibilityLabel={erase ? eraseLabel : k}
                disabled={disabled}
                onPress={() => (erase ? onErase() : onDigit(k))}
                style={({ pressed }) => ({
                  flex: 1,
                  height,
                  borderRadius: comma ? tokens.radius.md : tokens.radius.lg,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: erase
                    ? 'transparent'
                    : disabled || comma
                      ? c.surface2
                      : pressed
                        ? c.surface2
                        : c.surface,
                  borderWidth: erase || disabled || comma ? 0 : tokens.borderWidth.hairline,
                  borderColor: c.border,
                })}
              >
                {erase ? (
                  <Delete size={28} color={disabled ? c.disabledFg : c.text} strokeWidth={2} />
                ) : (
                  <Text
                    variant="display"
                    style={{ fontWeight: '400', color: disabled ? c.disabledFg : c.text }}
                  >
                    {k}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
