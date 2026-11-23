import type { File } from 'expo-file-system';
import { Check, Download, RefreshCw, WifiOff } from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { Button } from '../components/Button';
import { LogoTile, Screen, Spinner, Text, TopBar } from '../components/ui';
import { useI18n } from '../i18n';
import {
  checkForUpdate,
  ChecksumError,
  downloadUpdate,
  installedVersion,
  installUpdate,
  type Download as DownloadTask,
  type Feed,
} from '../lib/update';
import type { ScreenProps } from '../navigation';
import { tokens, useTheme } from '../theme';

type State =
  | { kind: 'checking' }
  | { kind: 'upToDate'; at: Date }
  | { kind: 'available'; feed: Feed }
  | { kind: 'downloading'; feed: Feed; done: number; total: number }
  | { kind: 'ready'; feed: Feed; file: File }
  | { kind: 'error'; feed: Feed | null; done: number; total: number; checksum: boolean };

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1).replace('.', ',');
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Update screen (frames "Yangilanish · ..."): this app's own updates from panel.posgro.uz. */
export function UpdateScreen({ navigation }: ScreenProps<'Update'>) {
  const { c } = useTheme();
  const { t, lang } = useI18n();
  const [state, setState] = useState<State>({ kind: 'checking' });
  const task = useRef<DownloadTask | null>(null);

  const check = async () => {
    setState({ kind: 'checking' });
    try {
      const feed = await checkForUpdate();
      setState(feed ? { kind: 'available', feed } : { kind: 'upToDate', at: new Date() });
    } catch {
      setState({ kind: 'error', feed: null, done: 0, total: 0, checksum: false });
    }
  };

  useEffect(() => {
    // The first check: the state starts as "checking", so only the answer is set here.
    checkForUpdate().then(
      (feed) => setState(feed ? { kind: 'available', feed } : { kind: 'upToDate', at: new Date() }),
      () => setState({ kind: 'error', feed: null, done: 0, total: 0, checksum: false }),
    );
    const running = task;
    return () => running.current?.cancel();
  }, []);

  const download = (feed: Feed) => {
    setState({ kind: 'downloading', feed, done: 0, total: feed.size });
    const d = downloadUpdate(feed, (done, total) =>
      setState((s) => (s.kind === 'downloading' ? { ...s, done, total } : s)),
    );
    task.current = d;
    d.promise.then(
      (file) => setState({ kind: 'ready', feed, file }),
      (e: unknown) =>
        setState((s) => ({
          kind: 'error',
          feed,
          done: s.kind === 'downloading' ? s.done : 0,
          total: feed.size,
          checksum: e instanceof ChecksumError,
        })),
    );
  };

  const notes = (feed: Feed) => (lang === 'ru' ? feed.notes?.ru : feed.notes?.uz) ?? feed.notes?.uz ?? [];

  const card = (children: ReactNode, accent?: string) => (
    <View
      style={{
        backgroundColor: accent ? undefined : c.surface,
        borderRadius: tokens.radius.lg,
        borderWidth: tokens.borderWidth.hairline,
        borderColor: accent ?? c.border,
        padding: 16,
        gap: 8,
      }}
    >
      {children}
    </View>
  );

  return (
    <Screen>
      <TopBar onBack={() => navigation.goBack()} backLabel={t('common.back')} title={t('update.title')} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {card(
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            <LogoTile />
            <View style={{ flex: 1 }}>
              <Text variant="heading">SavdoChef Ofitsiant</Text>
              <Text color="muted">{t('update.installed', { version: installedVersion() })}</Text>
            </View>
          </View>,
        )}
        {state.kind === 'checking' ? (
          <View style={{ padding: 24, alignItems: 'center' }}>
            <Spinner size="large" />
          </View>
        ) : null}
        {state.kind === 'upToDate'
          ? card(
              <View style={{ alignItems: 'center', gap: 8, paddingVertical: 16 }}>
                <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.successSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Check size={28} color={c.success} strokeWidth={2.5} />
                </View>
                <Text variant="heading" center>
                  {t('update.upToDate')}
                </Text>
                <Text variant="meta" color="muted">
                  {t('update.lastCheck', { when: hhmm(state.at) })}
                </Text>
              </View>,
            )
          : null}
        {state.kind === 'available' ? (
          <View style={{ backgroundColor: c.surface, borderRadius: tokens.radius.lg, borderWidth: tokens.borderWidth.hairline, borderColor: c.primary, padding: 16, gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text variant="heading">{t('update.available', { version: state.feed.version })}</Text>
              <View style={{ backgroundColor: c.primarySoft, borderRadius: tokens.radius.pill, paddingHorizontal: 10, paddingVertical: 2 }}>
                <Text variant="caption" color="primaryText" style={{ fontWeight: '700' }}>
                  {mb(state.feed.size)} MB
                </Text>
              </View>
            </View>
            {notes(state.feed).length ? (
              <>
                <Text variant="meta" color="muted" style={{ fontWeight: '700' }}>
                  {t('update.whatsNew')}
                </Text>
                {notes(state.feed).map((n) => (
                  <View key={n} style={{ flexDirection: 'row', gap: 8 }}>
                    <Text color="primary">•</Text>
                    <Text style={{ flex: 1 }}>{n}</Text>
                  </View>
                ))}
              </>
            ) : null}
          </View>
        ) : null}
        {state.kind === 'downloading'
          ? card(
              <>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text variant="heading">{t('update.downloading', { version: state.feed.version })}</Text>
                  <Text variant="bodyStrong" color="primaryText">
                    {Math.floor((state.done / Math.max(1, state.total)) * 100)}%
                  </Text>
                </View>
                <View style={{ height: 8, borderRadius: 4, backgroundColor: c.surface2, overflow: 'hidden' }}>
                  <View style={{ height: 8, width: `${Math.min(100, (state.done / Math.max(1, state.total)) * 100)}%`, backgroundColor: c.primary }} />
                </View>
                <Text color="muted">{t('update.progress', { done: mb(state.done), total: mb(state.total) })}</Text>
              </>,
            )
          : null}
        {state.kind === 'ready'
          ? card(
              <View style={{ alignItems: 'center', gap: 8, paddingVertical: 16 }}>
                <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.successSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Download size={26} color={c.success} strokeWidth={2} />
                </View>
                <Text variant="heading" center>
                  {t('update.ready', { version: state.feed.version })}
                </Text>
                <Text variant="meta" color="muted">
                  {t('update.downloaded', { size: mb(state.feed.size) })}
                </Text>
              </View>,
            )
          : null}
        {state.kind === 'error' ? (
          <View style={{ flexDirection: 'row', gap: 12, padding: 16, borderRadius: tokens.radius.lg, borderWidth: tokens.borderWidth.hairline, borderColor: c.danger, backgroundColor: c.dangerSoft }}>
            <WifiOff size={24} color={c.danger} strokeWidth={2} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="heading" color="danger">
                {t('update.error.title')}
              </Text>
              <Text>{state.checksum ? t('update.error.checksum') : t('update.error.body')}</Text>
              {state.done > 0 && !state.checksum ? (
                <Text variant="meta" color="muted">
                  {t('update.error.stopped', { done: mb(state.done), total: mb(state.total) })}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}
      </ScrollView>
      <View style={{ padding: 16, gap: 8 }}>
        {state.kind === 'upToDate' ? (
          <Button variant="secondary" icon={RefreshCw} label={t('update.check')} fullWidth onPress={() => void check()} />
        ) : null}
        {state.kind === 'available' ? (
          <>
            <Button icon={Download} label={t('update.download')} fullWidth onPress={() => download(state.feed)} />
            <Button variant="secondary" label={t('update.later')} fullWidth onPress={() => navigation.goBack()} />
          </>
        ) : null}
        {state.kind === 'downloading' ? (
          <Button
            variant="secondary"
            label={t('common.cancel')}
            fullWidth
            onPress={() => {
              task.current?.cancel();
              setState({ kind: 'available', feed: state.feed });
            }}
          />
        ) : null}
        {state.kind === 'ready' ? (
          <>
            <Text variant="meta" color="muted" center>
              {t('update.androidHint')}
            </Text>
            <Button label={t('update.install')} fullWidth onPress={() => void installUpdate(state.file)} />
          </>
        ) : null}
        {state.kind === 'error' ? (
          <Button
            icon={RefreshCw}
            label={t('common.retry')}
            fullWidth
            onPress={() => (state.feed ? download(state.feed) : void check())}
          />
        ) : null}
      </View>
    </Screen>
  );
}
