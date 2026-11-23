import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppEvent } from '@shared/ipc';
import { useApp } from './app';

/**
 * Loads something from the till and loads it again when one of `events` arrives (or the screen
 * comes back into view). Answers that cross are dropped: only the newest request's answer shows.
 */
export function useTill<T>(
  load: () => Promise<T>,
  events: AppEvent['type'][],
): { data: T | null; error: unknown; loading: boolean; reload: () => void } {
  const { onEvent } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const reload = useCallback(() => {
    const mine = ++seq.current;
    loadRef.current().then(
      (d) => {
        if (mine !== seq.current) return;
        setData(d);
        setError(null);
        setLoading(false);
      },
      (e: unknown) => {
        if (mine !== seq.current) return;
        setError(e);
        setLoading(false);
      },
    );
  }, []);

  const key = events.join(',');
  useEffect(() => {
    const wanted = new Set(key.split(','));
    return onEvent((e) => {
      if (wanted.has(e.type)) reload();
    });
  }, [onEvent, reload, key]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return { data, error, loading, reload };
}
