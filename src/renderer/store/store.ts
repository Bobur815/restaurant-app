/** A tiny observable state container: get, set (shallow merge), subscribe. No framework. */
export interface Store<T extends object> {
  get(): T;
  set(patch: Partial<T> | ((state: T) => Partial<T>)): void;
  /** Called after every change with the new and previous state; returns an unsubscribe. */
  subscribe(listener: (state: T, previous: T) => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<(state: T, previous: T) => void>();

  return {
    get: () => state,
    set(patch) {
      const previous = state;
      const delta = typeof patch === 'function' ? patch(state) : patch;
      const changed = Object.keys(delta).some(
        (k) => !Object.is(delta[k as keyof T], previous[k as keyof T]),
      );
      if (!changed) return;
      state = { ...state, ...delta };
      for (const l of [...listeners]) l(state, previous);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
