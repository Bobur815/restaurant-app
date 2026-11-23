import { X } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../i18n';
import { tokens, useTheme } from '../theme';
import { IconButton, Text } from './ui';

export interface BottomSheetProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  /** Icon tile left of the title (stock shortage). */
  leading?: ReactNode;
  /** false: no swipe, scrim or back to close (stock shortage). */
  dismissible?: boolean;
  onClose: () => void;
  /** Buttons pinned to the bottom of the sheet. */
  footer?: ReactNode;
  children: ReactNode;
}

/** Handoff BottomSheet: surface, top radius 16, 36x4 handle, header, scrim, elevation 16. */
export function BottomSheet({
  visible,
  title,
  subtitle,
  leading,
  dismissible = true,
  onClose,
  footer,
  children,
}: BottomSheetProps) {
  const { c } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  // In pixels: a percentage of the content-sized KeyboardAvoidingView resolved against the sheet's
  // own height on Android, shrinking the body under the footer (keypad and guest rows cut off).
  const maxHeight = (useWindowDimensions().height - insets.top) * 0.92;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      // Drawn behind the navigation bar, so the bottom inset below is space it covers, not a gap.
      navigationBarTranslucent
      onRequestClose={() => {
        if (dismissible) onClose();
      }}
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.scrim }}
          onPress={() => {
            if (dismissible) onClose();
          }}
          accessible={false}
        />
        <KeyboardAvoidingView behavior="padding">
          <View
            accessibilityViewIsModal
            style={{
              backgroundColor: c.surface,
              borderTopLeftRadius: tokens.radius.lg,
              borderTopRightRadius: tokens.radius.lg,
              elevation: tokens.elevation.sheet,
              maxHeight,
              paddingBottom: Math.max(insets.bottom, 16),
            }}
          >
            <View style={{ alignItems: 'center', paddingTop: 8 }}>
              <View
                style={{
                  width: tokens.size.sheetHandle.width,
                  height: tokens.size.sheetHandle.height,
                  borderRadius: 2,
                  backgroundColor: c.border,
                }}
              />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 8, paddingVertical: 8, gap: 12 }}>
              {leading}
              <View style={{ flex: 1 }}>
                <Text variant="heading" numberOfLines={2}>
                  {title}
                </Text>
                {subtitle ? (
                  <Text variant="meta" color="muted">
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              {dismissible ? <IconButton icon={X} label={t('common.close')} onPress={onClose} tint={c.muted} /> : null}
            </View>
            <View style={{ paddingHorizontal: 16, flexShrink: 1 }}>{children}</View>
            {footer ? <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>{footer}</View> : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
