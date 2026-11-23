import { ChevronLeft as ChevronLeftIcon, type LucideIcon } from 'lucide-react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { iconSvg, type SvgNode } from '@shared/branding/brand';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text as RNText,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tokens, useTheme, type Palette } from '../theme';

/** Thin layout pieces the handoff leaves to the app: Screen, TopBar, Text, IconButton, ... */

export type TextVariant = keyof typeof tokens.text;

export function Text({
  variant = 'body',
  color = 'text',
  style,
  children,
  numberOfLines,
  center,
}: {
  variant?: TextVariant;
  color?: keyof Palette;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
  center?: boolean;
}) {
  const { c } = useTheme();
  return (
    <RNText
      numberOfLines={numberOfLines}
      style={[
        tokens.text[variant] as TextStyle,
        { color: c[color] },
        center ? { textAlign: 'center' } : null,
        style,
      ]}
    >
      {children}
    </RNText>
  );
}

export function Screen({
  children,
  bg = 'bg',
  edges = ['top', 'bottom'],
}: {
  children: ReactNode;
  bg?: keyof Palette;
  edges?: ('top' | 'bottom')[];
}) {
  const { c } = useTheme();
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: c[bg] }}>
      {children}
    </SafeAreaView>
  );
}

export function TopBar({
  children,
  transparent,
  onBack,
  backLabel,
  title,
  tint,
}: {
  children?: ReactNode;
  transparent?: boolean;
  onBack?: () => void;
  backLabel?: string;
  title?: string;
  tint?: string;
}) {
  const { c } = useTheme();
  return (
    <View
      style={{
        height: tokens.size.topBar,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingLeft: onBack ? 4 : 16,
        paddingRight: 12,
        backgroundColor: transparent ? 'transparent' : c.surface,
        borderBottomWidth: transparent ? 0 : tokens.borderWidth.hairline,
        borderBottomColor: c.border,
      }}
    >
      {onBack ? (
        <IconButton icon={ChevronLeftIcon} label={backLabel ?? ''} onPress={onBack} tint={tint} />
      ) : null}
      {title ? (
        <Text variant="heading" style={tint ? { color: tint } : null} numberOfLines={1}>
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

export function IconButton({
  icon: Icon,
  label,
  onPress,
  tint,
  size = 24,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  onPress?: () => void;
  tint?: string;
  size?: number;
  disabled?: boolean;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      style={({ pressed }) => ({
        width: tokens.size.iconButton,
        height: tokens.size.iconButton,
        borderRadius: tokens.radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? c.surface2 : 'transparent',
      })}
    >
      <Icon size={size} color={disabled ? c.disabledFg : (tint ?? c.text)} strokeWidth={2} />
    </Pressable>
  );
}

export function Spinner({ color, size = 'small' }: { color?: string; size?: 'small' | 'large' }) {
  const { c } = useTheme();
  return <ActivityIndicator size={size} color={color ?? c.primary} />;
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  body?: string;
  children?: ReactNode;
}) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
      {Icon ? (
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: tokens.radius.lg,
            backgroundColor: c.surface2,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={32} color={c.muted} strokeWidth={2} />
        </View>
      ) : null}
      {children}
      <Text variant="heading" center>
        {title}
      </Text>
      {body ? (
        <Text color="muted" center>
          {body}
        </Text>
      ) : null}
    </View>
  );
}

/** Two options side by side ("Hammasi 18 | Mening stollarim 4"). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const { c } = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        backgroundColor: c.surface2,
        borderRadius: tokens.radius.md,
        padding: 0,
        height: tokens.size.button,
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 6,
              borderRadius: tokens.radius.md,
              backgroundColor: active ? c.surface : 'transparent',
              borderWidth: active ? tokens.borderWidth.hairline : 0,
              borderColor: c.border,
            }}
          >
            <Text variant="buttonSmall">{o.label}</Text>
            {o.count !== undefined ? <Text color="muted">{o.count}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export const row: ViewStyle = { flexDirection: 'row', alignItems: 'center' };

/** The SavdoChef tile: the till's own artwork (`@shared/branding/brand` iconSvg), 56 by default. */
export function LogoTile({ size = tokens.size.logoTile }: { size?: number }) {
  return <SvgTree node={iconSvg('light', size)} />;
}

const SVG_TAGS = { rect: Rect, circle: Circle, path: Path, g: G } as const;

/** Draws a brand.ts SVG tree with react-native-svg (only the tags the artwork uses). */
function SvgTree({ node }: { node: SvgNode }) {
  const kids = (n: SvgNode): ReactNode =>
    (n.children ?? []).map((child, i) => {
      const Tag = SVG_TAGS[child.tag as keyof typeof SVG_TAGS];
      if (!Tag) return null;
      return (
        <Tag key={i} {...(child.attrs as Record<string, string>)}>
          {kids(child)}
        </Tag>
      );
    });
  const { width, height, viewBox } = node.attrs;
  return (
    <Svg width={Number(width)} height={Number(height)} viewBox={String(viewBox)} accessible={false}>
      {kids(node)}
    </Svg>
  );
}
