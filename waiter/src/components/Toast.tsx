import { Check, CircleAlert, Printer, type LucideIcon } from 'lucide-react-native';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { tokens, useTheme } from '../theme';
import { Text } from './ui';

type Action = { label: string; onPress: () => void };

export interface ToastProps {
  kind: 'success' | 'error' | 'info';
  message: string;
  action?: Action;
  icon?: LucideIcon;
}

interface ToastApi {
  show(toast: ToastProps): void;
}

const Ctx = createContext<ToastApi | null>(null);

/** Handoff Toast: inverse colours, 100 above the bottom (over the cart bar), 3 s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  const [toast, setToast] = useState<ToastProps | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((next: ToastProps) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(next);
    // An error with an action stays a little longer: the waiter has to read and decide.
    timer.current = setTimeout(
      () => setToast(null),
      next.action ? tokens.motion.toastVisible * 2 : tokens.motion.toastVisible,
    );
  }, []);
  const api = useMemo(() => ({ show }), [show]);

  const Icon =
    toast?.icon ?? (toast?.kind === 'success' ? Check : toast?.kind === 'error' ? CircleAlert : Printer);
  const iconColor =
    toast?.kind === 'success' ? c.inverseSuccess : toast?.kind === 'error' ? c.inverseDanger : c.inverseFg;

  return (
    <Ctx.Provider value={api}>
      {children}
      {toast ? (
        <View
          pointerEvents="box-none"
          style={{ position: 'absolute', left: 16, right: 16, bottom: 100 }}
        >
          <View
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={{
              minHeight: 52,
              borderRadius: tokens.radius.md,
              backgroundColor: c.inverseBg,
              elevation: tokens.elevation.toast,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 16,
              paddingVertical: 12,
              gap: 12,
            }}
          >
            <Icon size={22} color={iconColor} strokeWidth={2} />
            <Text style={{ color: c.inverseFg, flex: 1 }}>{toast.message}</Text>
            {toast.action ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={12}
                onPress={() => {
                  setToast(null);
                  toast.action!.onPress();
                }}
              >
                <Text variant="bodyStrong" style={{ color: c.inverseAction }}>
                  {toast.action.label}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast outside ToastProvider');
  return ctx;
}
