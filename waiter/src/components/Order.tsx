import {
  ChevronDown,
  ChevronUp,
  ImageIcon,
  Minus,
  Plus,
  Trash2,
} from 'lucide-react-native';
import { useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { tokens, useTheme } from '../theme';
import { Button } from './Button';
import { Text } from './ui';

/** Order-screen components from the handoff: CategoryChip, DishRow, QtyStepper, CartBar. */

type ImageSource = { uri: string; headers: Record<string, string> };

export interface CategoryChipProps {
  label: string;
  count?: number;
  selected?: boolean;
  image?: ImageSource | null;
  /** Show the 28 dp picture slot (the menu has pictures), even without one. */
  showImage?: boolean;
  onPress?: () => void;
}

export function CategoryChip({ label, count, selected, image, showImage, onPress }: CategoryChipProps) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={{ height: tokens.size.touch, justifyContent: 'center' }}
    >
      <View
        style={{
          height: tokens.size.pillVisual,
          borderRadius: tokens.radius.pill,
          paddingLeft: showImage ? 6 : 16,
          paddingRight: 16,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: selected ? c.text : c.surface,
          borderWidth: selected ? 0 : tokens.borderWidth.hairline,
          borderColor: c.border,
        }}
      >
        {showImage ? (
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              overflow: 'hidden',
              backgroundColor: c.surface2,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Thumb image={image} size={28} iconSize={16} />
          </View>
        ) : null}
        <Text variant="buttonSmall" style={{ color: selected ? c.bg : c.text }}>
          {label}
        </Text>
        {count !== undefined ? (
          <Text style={{ color: selected ? c.bg : c.muted }}>{count}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export type QtyStepperProps =
  | {
      mode: 'stepper';
      value: string;
      variant: 'tinted' | 'neutral';
      /** At 1 the minus is a red trash (removes the line). */
      atOne: boolean;
      onIncrease: () => void;
      onDecrease: () => void;
      increaseLabel: string;
      decreaseLabel: string;
      removeLabel: string;
      disabled?: boolean;
      increaseDisabled?: boolean;
    }
  | { mode: 'picker'; label: string; onPress: () => void; accessibilityLabel: string };

export function QtyStepper(p: QtyStepperProps) {
  const { c } = useTheme();
  if (p.mode === 'picker') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={p.accessibilityLabel}
        onPress={p.onPress}
        style={{
          minWidth: 120,
          height: tokens.size.button,
          borderRadius: tokens.radius.md,
          backgroundColor: c.primarySoft,
          borderWidth: tokens.borderWidth.strong,
          borderColor: c.primary,
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        <Text variant="bodyStrong" color="primaryText">
          {p.label}
        </Text>
        <ChevronDown size={18} color={c.primaryText} strokeWidth={2} />
      </Pressable>
    );
  }
  const tinted = p.variant === 'tinted';
  const btn = (side: 'minus' | 'plus') => {
    const isMinus = side === 'minus';
    const Icon = isMinus ? (p.atOne ? Trash2 : Minus) : Plus;
    const off = p.disabled || (!isMinus && p.increaseDisabled);
    const color = off ? c.disabledFg : isMinus && p.atOne ? c.danger : tinted ? c.primaryText : isMinus ? c.text : c.primaryText;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isMinus ? (p.atOne ? p.removeLabel : p.decreaseLabel) : p.increaseLabel}
        disabled={off}
        onPress={isMinus ? p.onDecrease : p.onIncrease}
        style={{
          width: tokens.size.stepperButton,
          height: tokens.size.stepperButton,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: tinted ? 'transparent' : c.surface2,
        }}
      >
        <Icon size={22} color={color} strokeWidth={2} />
      </Pressable>
    );
  };
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: tokens.radius.md,
        overflow: 'hidden',
        backgroundColor: tinted ? c.primarySoft : c.surface,
        borderWidth: tinted ? tokens.borderWidth.strong : tokens.borderWidth.hairline,
        borderColor: tinted ? c.primary : c.border,
      }}
    >
      {btn('minus')}
      <Text
        variant="heading"
        center
        style={{ minWidth: tinted ? tokens.size.stepperQtyMinWidth : 56, paddingHorizontal: 4 }}
      >
        {p.value}
      </Text>
      {btn('plus')}
    </View>
  );
}

export interface DishRowProps {
  name: string;
  /** "32 000 so'm" or "120 000 so'm / kg", formatted already. */
  priceLabel: string;
  image?: ImageSource | null;
  showImage: boolean;
  /** "Qoldi: 3" (low) or "Tugadi" (out), formatted already. */
  stockTag?: { label: string; out: boolean } | null;
  /** "kg" tag for a weight dish. */
  unitTag?: string | null;
  /** The stepper when the dish is in the order, else the "+" button. */
  stepper?: QtyStepperProps | null;
  addLabel: string;
  onAdd: () => void;
}

export function DishRow(p: DishRowProps) {
  const { c } = useTheme();
  const out = !!p.stockTag?.out;
  return (
    <View
      style={{
        minHeight: p.showImage ? tokens.size.dishRow : tokens.size.dishRowNoPicture,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: p.showImage ? 8 : 16,
        paddingVertical: 8,
        backgroundColor: out ? c.surface2 : c.surface,
      }}
    >
      {p.showImage ? (
        <View
          style={{
            width: tokens.size.dishThumb,
            height: tokens.size.dishThumb,
            borderRadius: tokens.radius.md,
            backgroundColor: c.surface2,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: out ? 0.5 : 1,
          }}
        >
          <Thumb image={p.image} size={tokens.size.dishThumb} iconSize={24} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body" style={{ fontWeight: '500', color: out ? c.muted : c.text }}>
          {p.name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Text variant="meta" color="muted">
            {p.priceLabel}
          </Text>
          {p.unitTag ? (
            <View
              style={{
                borderRadius: tokens.radius.sm,
                borderWidth: tokens.borderWidth.hairline,
                borderColor: c.border,
                paddingHorizontal: 6,
              }}
            >
              <Text variant="caption" style={{ fontWeight: '700' }}>
                {p.unitTag}
              </Text>
            </View>
          ) : null}
          {p.stockTag ? (
            <View
              style={{
                borderRadius: tokens.radius.sm,
                backgroundColor: out ? c.dangerSoft : c.warningSoft,
                paddingHorizontal: 8,
                paddingVertical: 1,
              }}
            >
              <Text variant="caption" style={{ fontWeight: '700', color: out ? c.danger : c.warningText }}>
                {p.stockTag.label}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      {p.stepper ? (
        <QtyStepper {...p.stepper} />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={p.addLabel}
          accessibilityState={{ disabled: out }}
          disabled={out}
          onPress={p.onAdd}
          style={{
            width: tokens.size.touch,
            height: tokens.size.touch,
            borderRadius: tokens.radius.md,
            backgroundColor: out ? 'transparent' : c.primarySoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Plus size={26} color={out ? c.disabledFg : c.primaryText} strokeWidth={2} />
        </Pressable>
      )}
    </View>
  );
}

export interface CartBarProps {
  /** "5 ta taom" or "Taom qo'shing", formatted already. */
  summary: string;
  total: string;
  unsaved: boolean;
  saving?: boolean;
  saveDisabled?: boolean;
  saveLabel: string;
  savingLabel: string;
  openLabel: string;
  unsavedLabel: string;
  onOpen: () => void;
  onSave: () => void;
}

export function CartBar(p: CartBarProps) {
  const { c } = useTheme();
  // The bar is the last thing on screen: it sits above Android's gesture or button bar.
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        backgroundColor: c.surface,
        borderTopWidth: tokens.borderWidth.hairline,
        borderTopColor: c.border,
        elevation: tokens.elevation.cartBar,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 12 + insets.bottom,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={p.unsaved ? `${p.openLabel}. ${p.unsavedLabel}` : p.openLabel}
        onPress={p.onOpen}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: tokens.radius.md,
            backgroundColor: c.surface2,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ChevronUp size={22} color={c.text} strokeWidth={2} />
          {p.unsaved ? (
            <View
              style={{
                position: 'absolute',
                top: -3,
                right: -3,
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: c.warning,
                borderWidth: 2,
                borderColor: c.surface,
              }}
            />
          ) : null}
        </View>
        <View style={{ flexShrink: 1 }}>
          <Text variant="meta" color="muted" numberOfLines={1}>
            {p.summary}
          </Text>
          <Text variant="title" numberOfLines={1} style={{ fontSize: 22 }}>
            {p.total}
          </Text>
        </View>
      </Pressable>
      <View style={{ width: 136 }}>
        <Button
          label={p.saveLabel}
          loading={p.saving}
          loadingLabel={p.savingLabel}
          disabled={p.saveDisabled}
          onPress={p.onSave}
          fullWidth
        />
      </View>
    </View>
  );
}

/** A picture from the till, or the "no picture" icon when there is none or it fails to load. */
function Thumb({ image, size, iconSize }: { image?: ImageSource | null; size: number; iconSize: number }) {
  const { c } = useTheme();
  const [failed, setFailed] = useState<string | null>(null);
  if (image && failed !== image.uri) {
    return <Image source={image} style={{ width: size, height: size }} onError={() => setFailed(image.uri)} />;
  }
  return <ImageIcon size={iconSize} color={c.muted} strokeWidth={2} />;
}
