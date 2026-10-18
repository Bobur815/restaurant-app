import type { CurrentUser, Role, SetupStatus } from '@shared/types';

/**
 * Route matching and access decisions, pure (tested without a DOM). router.ts wires them to
 * location.hash and mounts views.
 */

export type Access = 'public' | 'user' | 'admin';

export interface RouteDef<V> {
  /** e.g. '/tables/:table'. Segments starting with ':' are params. */
  path: string;
  access: Access;
  /** 'shell' = inside the app frame with navigation; 'bare' = full screen (setup, login). */
  layout: 'shell' | 'bare';
  view: V;
}

export interface Match<V> {
  route: RouteDef<V>;
  params: Record<string, string>;
}

export function matchRoute<V>(routes: readonly RouteDef<V>[], path: string): Match<V> | null {
  const parts = path.split('/').filter(Boolean);
  for (const route of routes) {
    const pattern = route.path.split('/').filter(Boolean);
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const ok = pattern.every((seg, i) => {
      const part = parts[i]!;
      if (seg.startsWith(':')) {
        params[seg.slice(1)] = decodeURIComponent(part);
        return true;
      }
      return seg === part;
    });
    if (ok) return { route, params };
  }
  return null;
}

export const HOME = '/tables';

/** Where to go instead of `path`, or null to show it. Order matters: setup, then login, then role. */
export function redirectFor(
  path: string,
  access: Access | null,
  setup: SetupStatus,
  user: CurrentUser | null,
): string | null {
  if (!setup.setupComplete) return path === '/setup' ? null : '/setup';
  if (path === '/setup') return user ? HOME : '/login';
  if (path === '/login') return user ? HOME : null;
  if (access === null) return user ? HOME : '/login'; // unknown route
  if (access === 'public') return null;
  if (!user) return '/login';
  if (access === 'admin' && !isAdmin(user.role)) return HOME;
  return null;
}

export const isAdmin = (role: Role) => role === 'ADMIN';

/** location.hash ('#/tables/3?x') -> '/tables/3'. */
export function pathFromHash(hash: string): string {
  const p = hash.replace(/^#/, '').split('?')[0] ?? '';
  return p.startsWith('/') ? p : `/${p}`;
}
