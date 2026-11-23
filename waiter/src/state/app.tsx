import * as Device from 'expo-device';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AppEvent } from '@shared/ipc';
import type { CurrentUser } from '@shared/types';
import { WaiterClient, type LinkStatus } from '../api/client';
import {
  clearCredential,
  loadCredential,
  saveCredential,
  type Credential,
} from '../api/credential';

/**
 * The whole app's state: which till this phone is paired with, the line to it, and who is
 * signed in. Screens read data themselves (`client.rpc`) and reload on `onEvent`.
 */

type Listener = (event: AppEvent) => void;

interface AppState {
  /** false until the stored credential has been read. */
  ready: boolean;
  credential: Credential | null;
  client: WaiterClient | null;
  link: LinkStatus | null;
  user: CurrentUser | null;
  phoneName: string;
  paired(credential: Credential): Promise<void>;
  /** "Boshqa kassaga ulash": forget this till. */
  forget(): Promise<void>;
  signIn(pin: string): Promise<CurrentUser>;
  signOut(): Promise<void>;
  /** Subscribe to the till's events; returns the unsubscribe. */
  onEvent(listener: Listener): () => void;
}

const Ctx = createContext<AppState | null>(null);

export const phoneName = (): string =>
  (Device.deviceName || [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || 'Telefon').slice(0, 60);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [credential, setCredential] = useState<Credential | null>(null);
  const [client, setClient] = useState<WaiterClient | null>(null);
  const [link, setLink] = useState<LinkStatus | null>(null);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const listeners = useRef(new Set<Listener>());

  const connect = useCallback((c: Credential | null) => {
    setClient((old) => {
      old?.stop();
      if (!c) return null;
      const next = new WaiterClient({
        credential: c,
        onStatus: setLink,
        onEvent: (e) => {
          for (const l of listeners.current) l(e);
        },
        onSignedOut: () => setUser(null),
      });
      setLink(next.status);
      next.start();
      return next;
    });
    setUser(null);
  }, []);

  useEffect(() => {
    void loadCredential().then((c) => {
      setCredential(c);
      connect(c);
      setReady(true);
    });
  }, [connect]);

  const value = useMemo<AppState>(
    () => ({
      ready,
      credential,
      client,
      link,
      // The till forgot this phone (unpaired there) or it is beyond the plan: nobody is signed in.
      user: link?.state === 'unpaired' || link?.state === 'limit' ? null : user,
      phoneName: phoneName(),
      paired: async (c) => {
        await saveCredential(c);
        setCredential(c);
        connect(c);
      },
      forget: async () => {
        if (client?.signedIn) await client.rpc('auth:logout').catch(() => undefined);
        await clearCredential();
        setCredential(null);
        connect(null);
        setLink(null);
      },
      signIn: async (pin) => {
        if (!client) throw new Error('not paired');
        const me = await client.rpc('auth:pinLogin', { pin });
        setUser(me);
        return me;
      },
      signOut: async () => {
        if (client?.signedIn) await client.rpc('auth:logout').catch(() => undefined);
        client?.forgetSession();
        setUser(null);
      },
      onEvent: (listener) => {
        listeners.current.add(listener);
        return () => listeners.current.delete(listener);
      },
    }),
    [ready, credential, client, link, user, connect],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp outside AppStateProvider');
  return ctx;
}

/** The client, for screens that only exist while paired. */
export function useClient(): WaiterClient {
  const { client } = useApp();
  if (!client) throw new Error('no client: not paired');
  return client;
}
