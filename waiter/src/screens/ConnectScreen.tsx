import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Application from 'expo-application';
import {
  ArrowRight,
  Check,
  CameraOff,
  CircleAlert,
  Clock,
  Download,
  Keyboard,
  Lock,
  ScanLine,
  ChevronRight,
  WifiOff,
  type LucideIcon,
} from 'lucide-react-native';
import { useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pair, parseAddress, parsePairingQr, isPairingCode, type PairFailure } from '../api/pairing';
import { Button } from '../components/Button';
import { Dialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { Screen, Segmented, Spinner, Text, TopBar } from '../components/ui';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/strings';
import type { ScreenProps } from '../navigation';
import { useApp } from '../state/app';
import { tokens, useTheme } from '../theme';
import { useThemePreference, type ThemePreference } from '../theme/preference';

type Step = 'paired' | 'scan' | 'denied' | 'manual' | 'pairing' | 'success' | 'error';

/** Connect screen (frames "Ulash · ..."): pair this phone with a till, or see the pairing. */
export function ConnectScreen({ navigation }: ScreenProps<'Connect'>) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const app = useApp();
  const toast = useToast();
  const [permission, requestPermission] = useCameraPermissions();
  // A phone the till unpaired has nothing to show: straight to pairing again.
  const [chosen, setStep] = useState<Step>(
    app.credential && app.link?.state !== 'unpaired' ? 'paired' : 'scan',
  );
  const [address, setAddress] = useState(app.credential ? (app.credential.hosts[0] ?? '') : '');
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [failure, setFailure] = useState<PairFailure | null>(null);
  const [pairingAt, setPairingAt] = useState('');
  const [confirmForget, setConfirmForget] = useState(false);
  const attempt = useRef(0);
  const scanned = useRef(false);
  const inputs = useRef<(ComponentRef<typeof TextInput> | null)[]>([]);

  // The camera was refused for good: the scanner step shows how to allow it instead.
  const step: Step =
    chosen === 'scan' && permission && !permission.granted && !permission.canAskAgain ? 'denied' : chosen;

  const start = async (target: { hosts: string[]; port: number; code: string }) => {
    const mine = ++attempt.current;
    setPairingAt(target.hosts[0] ?? '');
    setStep('pairing');
    const result = await pair(target, app.phoneName);
    if (mine !== attempt.current) return; // cancelled meanwhile
    if (result.ok) {
      await app.paired(result.credential);
      setStep('success');
    } else {
      setFailure(result.failure);
      setStep('error');
    }
  };

  const onScanned = (data: string) => {
    if (scanned.current) return;
    const target = parsePairingQr(data);
    if (!target) {
      toast.show({ kind: 'error', message: t('connect.error.badQr') });
      scanned.current = true;
      setTimeout(() => (scanned.current = false), 2500);
      return;
    }
    scanned.current = true;
    void start(target);
  };

  const code = digits.join('');
  const parsed = parseAddress(address);
  const canConnect = parsed !== null && isPairingCode(code);

  const setDigit = (i: number, value: string) => {
    const clean = value.replace(/\D/g, '');
    if (clean.length > 1) {
      // A pasted code fills the boxes from here.
      const next = [...digits];
      for (let k = 0; k < clean.length && i + k < 6; k++) next[i + k] = clean[k]!;
      setDigits(next);
      inputs.current[Math.min(5, i + clean.length)]?.focus();
      return;
    }
    const next = [...digits];
    next[i] = clean;
    setDigits(next);
    if (clean && i < 5) inputs.current[i + 1]?.focus();
  };

  const back = () => {
    attempt.current++;
    if (step === 'manual' || step === 'denied' || step === 'error') setStep(app.credential ? 'paired' : 'scan');
    else if (navigation.canGoBack()) navigation.goBack();
  };

  const footer = (children: ReactNode) => (
    <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 8 }}>{children}</View>
  );

  if (step === 'scan' && permission?.granted) {
    return (
      <Screen bg="cameraBg" edges={['top']}>
        <CameraView
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => onScanned(data)}
        />
        <TopBar transparent onBack={back} backLabel={t('common.back')} title={t('connect.title')} tint="#FFFFFF" />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 248, height: 248, borderRadius: 24, borderWidth: 4, borderColor: c.brand }} />
        </View>
        {/* The camera runs edge to edge (edges: top only), so the panel keeps clear of the navigation bar itself. */}
        <View style={{ backgroundColor: c.surface, borderTopLeftRadius: tokens.radius.lg, borderTopRightRadius: tokens.radius.lg, padding: 16, paddingBottom: 16 + insets.bottom, gap: 6 }}>
          <Text variant="meta" color="muted">
            {t('connect.scan.where')}
          </Text>
          <Text variant="bodyStrong">{t('connect.scan.path')}</Text>
          <Text>{t('connect.scan.hint')}</Text>
          <Button variant="ghost" icon={Keyboard} label={t('connect.manualEntry')} onPress={() => setStep('manual')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar onBack={back} backLabel={t('common.back')} title={t('connect.title')} />
      <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
          {step === 'scan' ? (
            // Permission not decided yet: ask (the system dialog); the scanner shows once granted.
            <Centered icon={ScanLine} title={t('connect.scan.hint')} body={t('connect.scan.path')} />
          ) : null}
          {step === 'denied' ? (
            <Centered icon={CameraOff} title={t('connect.denied.title')} body={t('connect.denied.body')}>
              <Text variant="meta" color="muted" center>
                {t('connect.denied.settingsPath')}
              </Text>
            </Centered>
          ) : null}
          {step === 'manual' ? (
            <>
              <Text color="muted">{t('connect.manual.intro')}</Text>
              <Text variant="buttonSmall">{t('connect.manual.address')}</Text>
              <TextInput
                value={address}
                onChangeText={setAddress}
                placeholder={t('connect.manual.addressPlaceholder')}
                placeholderTextColor={c.muted}
                keyboardType="numbers-and-punctuation"
                autoCorrect={false}
                autoCapitalize="none"
                style={{
                  height: tokens.size.button,
                  borderRadius: tokens.radius.md,
                  borderWidth: tokens.borderWidth.hairline,
                  borderColor: c.border,
                  backgroundColor: c.surface,
                  color: c.text,
                  paddingHorizontal: 16,
                  fontSize: 18,
                }}
              />
              <Text variant="buttonSmall" style={{ marginTop: 8 }}>
                {t('connect.manual.code')}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {digits.map((d, i) => (
                  <TextInput
                    key={i}
                    ref={(r) => {
                      inputs.current[i] = r;
                    }}
                    value={d}
                    onChangeText={(v) => setDigit(i, v)}
                    onKeyPress={({ nativeEvent }) => {
                      if (nativeEvent.key === 'Backspace' && !digits[i] && i > 0) inputs.current[i - 1]?.focus();
                    }}
                    accessibilityLabel={t('connect.manual.codeDigitAria', { n: i + 1 })}
                    keyboardType="number-pad"
                    maxLength={6}
                    selectTextOnFocus
                    style={{
                      flex: 1,
                      height: 64,
                      borderRadius: tokens.radius.md,
                      borderWidth: tokens.borderWidth.hairline,
                      borderColor: c.border,
                      backgroundColor: c.surface,
                      color: c.text,
                      textAlign: 'center',
                      fontSize: 30,
                      fontWeight: '700',
                    }}
                  />
                ))}
              </View>
              <Text variant="meta" color="muted">
                {t('connect.manual.codeHint')}
              </Text>
            </>
          ) : null}
          {step === 'pairing' ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              <Spinner size="large" />
              <Text variant="title">{t('connect.pairing')}</Text>
              <Text color="muted">{pairingAt}</Text>
            </View>
          ) : null}
          {step === 'success' ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: c.successSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Check size={44} color={c.success} strokeWidth={2.5} />
              </View>
              <Text variant="display">{t('connect.success.title')}</Text>
              <Text variant="heading" style={{ fontWeight: '500' }}>
                {app.credential?.restaurantName ?? ''}
              </Text>
              <Text variant="meta" color="muted">
                {t('connect.success.version', { version: app.credential?.tillVersion ?? '' })}
              </Text>
            </View>
          ) : null}
          {step === 'error' && failure ? <FailureCard failure={failure} /> : null}
          {step === 'paired' && app.credential ? (
            <>
              <PairedCard />
              <ThemePicker />
            </>
          ) : null}
        </ScrollView>
        {step === 'denied'
          ? footer(
              <>
                <Button label={t('connect.denied.cta')} fullWidth onPress={() => void requestPermission().then((p) => setStep(p.granted ? 'scan' : 'denied'))} />
                <Button variant="ghost" label={t('connect.manualEntry')} onPress={() => setStep('manual')} />
              </>,
            )
          : null}
        {step === 'scan' && !permission?.granted
          ? footer(
              <>
                <Button label={t('connect.denied.cta')} fullWidth onPress={() => void requestPermission().then((p) => setStep(p.granted ? 'scan' : 'denied'))} />
                <Button variant="ghost" label={t('connect.manualEntry')} onPress={() => setStep('manual')} />
              </>,
            )
          : null}
        {step === 'manual'
          ? footer(
              <Button
                label={t('connect.manual.cta')}
                fullWidth
                disabled={!canConnect}
                onPress={() => parsed && void start({ hosts: [parsed.host], port: parsed.port, code })}
              />,
            )
          : null}
        {step === 'pairing'
          ? footer(
              <Button
                variant="ghost"
                ghostColor="muted"
                label={t('common.cancel')}
                onPress={() => {
                  attempt.current++;
                  scanned.current = false;
                  setStep('manual');
                }}
              />,
            )
          : null}
        {step === 'success'
          ? footer(<Button label={t('connect.success.cta')} trailingIcon={ArrowRight} fullWidth onPress={() => navigation.goBack()} />)
          : null}
        {step === 'error'
          ? footer(
              <Button
                label={t('common.retry')}
                fullWidth
                onPress={() => {
                  scanned.current = false;
                  setStep(failure?.kind === 'notFound' || failure?.kind === 'wrong' ? 'manual' : 'scan');
                }}
              />,
            )
          : null}
        {step === 'paired'
          ? footer(
              <>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => navigation.navigate('Update')}
                  style={{ height: tokens.size.button, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8 }}
                >
                  <Download size={22} color={c.primaryText} strokeWidth={2} />
                  <Text variant="buttonSmall" color="primaryText" style={{ flex: 1 }}>
                    {t('connect.paired.update')}
                  </Text>
                  <ChevronRight size={20} color={c.primaryText} strokeWidth={2} />
                </Pressable>
                <Button variant="secondary" icon={ScanLine} label={t('connect.paired.other')} fullWidth onPress={() => setConfirmForget(true)} />
              </>,
            )
          : null}
      </KeyboardAvoidingView>
      <Dialog
        visible={confirmForget}
        tone="warning"
        icon={CircleAlert}
        title={t('connect.paired.other')}
        body={t('connect.forgetConfirm')}
        onDismiss={() => setConfirmForget(false)}
        actions={[
          { label: t('common.cancel'), variant: 'secondary', onPress: () => setConfirmForget(false) },
          {
            label: t('connect.paired.other'),
            variant: 'primary',
            onPress: () => {
              setConfirmForget(false);
              void app.forget().then(() => {
                setDigits(['', '', '', '', '', '']);
                setAddress('');
                setStep('scan');
              });
            },
          },
        ]}
      />
    </Screen>
  );
}

function Centered({ icon: Icon, title, body, children }: { icon: LucideIcon; title: string; body: string; children?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 8 }}>
      <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={36} color={c.muted} strokeWidth={2} />
      </View>
      <Text variant="title" center>
        {title}
      </Text>
      <Text color="muted" center>
        {body}
      </Text>
      {children}
    </View>
  );
}

const FAILURE: Record<PairFailure['kind'], { tone: 'danger' | 'warning' | 'neutral'; icon: LucideIcon; title: StringKey; body?: StringKey }> = {
  wrong: { tone: 'danger', icon: CircleAlert, title: 'connect.error.wrongCode' },
  throttled: { tone: 'danger', icon: CircleAlert, title: 'connect.error.throttled' },
  expired: { tone: 'warning', icon: Clock, title: 'connect.error.expired.title', body: 'connect.error.expired.body' },
  wrongKind: { tone: 'warning', icon: CircleAlert, title: 'connect.error.wrongKind' },
  notFound: { tone: 'warning', icon: WifiOff, title: 'connect.error.notFound.title', body: 'connect.error.notFound.body' },
  plan: { tone: 'neutral', icon: Lock, title: 'connect.error.plan.title', body: 'connect.error.plan.body' },
  limit: { tone: 'neutral', icon: Lock, title: 'connect.error.limit.title' },
  version: { tone: 'warning', icon: Download, title: 'connect.error.version.title', body: 'connect.error.version.body' },
  other: { tone: 'danger', icon: CircleAlert, title: 'common.error' },
};

/** One error card at a time, as "Ulash · xato variantlari" shows the five. */
function FailureCard({ failure }: { failure: PairFailure }) {
  const { c } = useTheme();
  const { t } = useI18n();
  const f = FAILURE[failure.kind];
  const bg = { danger: c.dangerSoft, warning: c.warningSoft, neutral: c.surface2 }[f.tone];
  const border = { danger: c.danger, warning: c.warning, neutral: c.border }[f.tone];
  const fg = { danger: c.danger, warning: c.warningText, neutral: c.text }[f.tone];
  const iconColor = { danger: c.danger, warning: c.warning, neutral: c.muted }[f.tone];
  const message = failure.kind === 'limit' || failure.kind === 'other' ? failure.message : null;
  return (
    <View
      accessibilityRole="alert"
      style={{ flexDirection: 'row', gap: 12, padding: 16, borderRadius: tokens.radius.md, borderWidth: tokens.borderWidth.hairline, borderColor: border, backgroundColor: bg }}
    >
      <f.icon size={24} color={iconColor} strokeWidth={2} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="heading" style={{ color: fg }}>
          {t(f.title)}
        </Text>
        {f.body ? <Text>{t(f.body)}</Text> : null}
        {message ? <Text>{message}</Text> : null}
      </View>
    </View>
  );
}

/** "Ulash · allaqachon ulangan": which till, how the line is, this phone. */
function PairedCard() {
  const { c } = useTheme();
  const { t } = useI18n();
  const { credential, link, phoneName } = useApp();
  if (!credential) return null;
  const online = link?.state === 'online';
  const rows: [string, string, boolean?][] = [
    [t('connect.paired.address'), link?.address ?? `${credential.hosts[0]}:${credential.port}`],
    [t('connect.paired.lastSeen'), online ? t('connect.paired.now') : link?.lastContactAt ? hhmm(link.lastContactAt) : '—', online],
    [t('connect.paired.phoneName'), phoneName],
    [t('connect.paired.appVersion'), Application.nativeApplicationVersion ?? '—'],
  ];
  return (
    <View style={{ backgroundColor: c.surface, borderRadius: tokens.radius.lg, borderWidth: tokens.borderWidth.hairline, borderColor: c.border, padding: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingBottom: 12 }}>
        <Text variant="title" style={{ flex: 1 }}>
          {link?.restaurantName || credential.restaurantName}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: tokens.radius.pill, backgroundColor: online ? c.successSoft : c.warningSoft, paddingHorizontal: 10, paddingVertical: 4 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: online ? c.success : c.warning }} />
          <Text variant="meta" style={{ color: online ? c.success : c.warningText }}>
            {online ? t('connect.paired.status') : t('common.offline')}
          </Text>
        </View>
      </View>
      {rows.map(([k, v, good]) => (
        <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderTopWidth: tokens.borderWidth.hairline, borderTopColor: c.border, gap: 12 }}>
          <Text color="muted">{k}</Text>
          <Text variant="body" style={{ color: good ? c.success : c.text, fontWeight: '500', flexShrink: 1, textAlign: 'right' }}>
            {v}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** This phone's theme: the system's, or always light / dark (remembered on the phone). */
function ThemePicker() {
  const { t } = useI18n();
  const { preference, setPreference } = useThemePreference();
  return (
    <View style={{ gap: 8 }}>
      <Text variant="buttonSmall">{t('connect.theme.title')}</Text>
      <Segmented<ThemePreference>
        value={preference}
        onChange={setPreference}
        options={[
          { value: 'system', label: t('connect.theme.system') },
          { value: 'light', label: t('connect.theme.light') },
          { value: 'dark', label: t('connect.theme.dark') },
        ]}
      />
    </View>
  );
}

/** "09:14": no Intl (Electron and Hermes differ on Uzbek; the till formats by hand too). */
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
