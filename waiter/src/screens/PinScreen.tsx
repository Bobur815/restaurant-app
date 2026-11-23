import { useFocusEffect } from '@react-navigation/native';
import { Languages, Lock, Monitor, RefreshCw, ScanLine, Settings, Smartphone } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { isApiError } from '../api/errors';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { PinDots, PinKeypad } from '../components/Pin';
import { useToast } from '../components/Toast';
import { EmptyState, IconButton, LogoTile, Screen, Spinner, Text, TopBar } from '../components/ui';
import { useI18n } from '../i18n';
import type { ScreenProps } from '../navigation';
import { useApp } from '../state/app';
import { tokens, useTheme } from '../theme';

/** PIN screen (frames "PIN · ..."): sign in on the till, or the way to pair when not paired. */
export function PinScreen({ navigation }: ScreenProps<'Pin'>) {
  const { c } = useTheme();
  const { t, lang, setLang } = useI18n();
  const { credential, link, signIn, client } = useApp();
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [state, setState] = useState<'idle' | 'error' | 'checking'>('idle');
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const locked = lockedUntil !== null && lockedUntil > now;
  const offline = link?.state === 'unreachable' || link?.state === 'connecting';
  const blocked = link?.state === 'unpaired' || link?.state === 'version' || link?.state === 'limit' || link?.state === 'superseded';

  useEffect(() => {
    if (!lockedUntil) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [lockedUntil]);

  useFocusEffect(
    useCallback(() => {
      setPin('');
      setState('idle');
      return () => {
        if (clearTimer.current) clearTimeout(clearTimer.current);
      };
    }, []),
  );

  const submit = async (code: string) => {
    setState('checking');
    try {
      await signIn(code);
    } catch (e) {
      if (isApiError(e, 'LOCKED')) {
        const until = Date.parse(String(e.details?.['lockedUntil'] ?? ''));
        setLockedUntil(Number.isFinite(until) ? until : Date.now() + 5 * 60_000);
        setNow(Date.now());
        setPin('');
        setState('idle');
        return;
      }
      if (isApiError(e, 'NOT_AUTHENTICATED')) {
        setState('error');
        clearTimer.current = setTimeout(() => {
          setPin('');
          setState('idle');
        }, 900);
        return;
      }
      setPin('');
      setState('idle');
      if (!isApiError(e, 'OFFLINE') && !isApiError(e, 'UNPAIRED') && !isApiError(e, 'LIMIT'))
        toast.show({ kind: 'error', message: e instanceof Error ? e.message : t('common.error') });
    }
  };

  const onDigit = (d: string) => {
    if (state !== 'idle' || pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) void submit(next);
  };

  const langChip = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('pin.langAria')}
      onPress={() => setLang(lang === 'uz' ? 'ru' : 'uz')}
      style={{
        height: 40,
        borderRadius: tokens.radius.pill,
        borderWidth: tokens.borderWidth.hairline,
        borderColor: c.border,
        backgroundColor: c.surface,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <Languages size={16} color={c.text} strokeWidth={2} />
      <Text variant="caption" style={{ fontWeight: '700' }}>
        {t('pin.langChip')}
      </Text>
    </Pressable>
  );

  const top = (
    <TopBar transparent>
      {langChip}
      <View style={{ flex: 1 }} />
      <IconButton icon={Settings} label={t('pin.connectAria')} onPress={() => navigation.navigate('Connect')} />
    </TopBar>
  );

  const connLine = (
    <View style={{ height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <View
        style={{
          width: tokens.size.statusDot,
          height: tokens.size.statusDot,
          borderRadius: 4,
          backgroundColor: !credential ? c.muted : link?.state === 'online' ? c.success : c.warning,
        }}
      />
      <Text variant="meta" color="muted">
        {!credential
          ? t('pin.conn.none')
          : link?.state === 'online'
            ? t('pin.conn.ok', { address: link.address.replace(/:5180$/, '') })
            : t('pin.conn.off', { address: (link?.address ?? '').replace(/:5180$/, '') })}
      </Text>
    </View>
  );

  if (!credential || link?.state === 'unpaired') {
    return (
      <Screen>
        {top}
        <EmptyState
          title={t('pin.unpaired.title')}
          body={credential ? t('pin.unpaired.revoked') : t('pin.unpaired.body')}
        >
          <LogoTile />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 8 }}>
            <View style={{ width: 64, height: 64, borderRadius: tokens.radius.lg, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
              <Smartphone size={28} color={c.muted} strokeWidth={2} />
            </View>
            <View style={{ width: 56, borderTopWidth: 2, borderStyle: 'dashed', borderColor: c.border }} />
            <View style={{ width: 64, height: 64, borderRadius: tokens.radius.lg, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
              <Monitor size={28} color={c.muted} strokeWidth={2} />
            </View>
          </View>
        </EmptyState>
        <View style={{ paddingHorizontal: 24 }}>
          <Button icon={ScanLine} label={t('pin.unpaired.cta')} fullWidth onPress={() => navigation.navigate('Connect')} />
        </View>
        {connLine}
      </Screen>
    );
  }

  const left = Math.max(0, Math.ceil(((lockedUntil ?? 0) - now) / 1000));
  const mmss = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;

  return (
    <Screen>
      {top}
      {offline ? (
        <View style={{ paddingHorizontal: 16 }}>
          <Banner kind="warning" busy boxed title={t('pin.offline.title')} body={t('pin.offline.body')} />
        </View>
      ) : null}
      {blocked ? (
        <View style={{ paddingHorizontal: 16 }}>
          <Banner
            kind="warning"
            boxed
            title={link?.state === 'limit' ? t('connect.error.limit.title') : t('pin.version.title')}
            body={link?.state === 'limit' ? undefined : t('pin.version.body')}
          />
        </View>
      ) : null}
      <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 }}>
        <LogoTile />
        <Text variant="title" center style={{ marginTop: 8 }}>
          {link?.restaurantName || credential.restaurantName}
        </Text>
        <Text color="muted" center>
          {t('pin.prompt')}
        </Text>
        <View style={{ marginTop: 16, minHeight: 64, alignItems: 'center', gap: 12 }}>
          <PinDots
            filled={pin.length}
            state={state}
            accessibilityLabel={state === 'error' ? t('pin.wrong') : state === 'checking' ? t('pin.checking') : t('pin.dotsAria', { n: pin.length })}
          />
          {state === 'error' ? (
            <Text variant="bodyStrong" color="danger">
              {t('pin.wrong')}
            </Text>
          ) : null}
          {state === 'checking' ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Spinner />
              <Text variant="bodyStrong" color="muted">
                {t('pin.checking')}
              </Text>
            </View>
          ) : null}
          {locked ? (
            <View style={{ backgroundColor: c.warningSoft, borderRadius: tokens.radius.md, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Lock size={16} color={c.warningText} strokeWidth={2} />
                <Text variant="bodyStrong" color="warningText">
                  {t('pin.locked.title')}
                </Text>
              </View>
              <Text>{t('pin.locked.retryIn', { time: mmss })}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
      <View style={{ paddingHorizontal: 24, gap: 12 }}>
        <PinKeypad
          disabled={locked || offline || blocked || state !== 'idle'}
          onDigit={onDigit}
          onErase={() => setPin((p) => p.slice(0, -1))}
          eraseLabel={t('common.erase')}
        />
        {offline ? (
          <Button variant="secondary" tone="warning" icon={RefreshCw} label={t('common.retry')} fullWidth onPress={() => client?.retry()} />
        ) : null}
      </View>
      {connLine}
    </Screen>
  );
}
