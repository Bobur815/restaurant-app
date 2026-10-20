import { hasPermission, type Permission } from '@shared/permissions';
import type { CurrentUser, SetupStatus } from '@shared/types';

/**
 * Route matching and access decisions, pure (tested without a DOM). router.ts wires them to
 * location.hash and mounts views.
 */

/** public; any logged-in user; or users with (any of) these permissions. */
export type Access = 'public' | 'user' | Permission | readonly Permission[];

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

/** Where a user starts: the tables if they take orders, else checks, else shifts (anyone). */
export function homeFor(user: CurrentUser): string {
  if (hasPermission(user, 'orders')) return '/tables';
  if (hasPermission(user, 'checks')) return '/checks';
  return '/sessions';
}

export function canAccess(user: CurrentUser, access: Access): boolean {
  if (access === 'public' || access === 'user') return true;
  const needed: readonly Permission[] = typeof access === 'string' ? [access] : access;
  return needed.some((p) => hasPermission(user, p));
}

/** Where to go instead of `path`, or null to show it. Order matters: setup, then login, then role. */
export function redirectFor(
  path: string,
  access: Access | null,
  setup: SetupStatus,
  user: CurrentUser | null,
): string | null {
  if (!setup.setupComplete) return path === '/setup' ? null : '/setup';
  if (path === '/setup') return user ? homeFor(user) : '/login';
  // The lock screen is the login keypad: skipped, like login, once someone is logged in.
  if (path === '/login' || path === '/lock') return user ? homeFor(user) : null;
  if (access === null) return user ? homeFor(user) : '/login'; // unknown route
  if (access === 'public') return null;
  if (!user) return '/login';
  if (!canAccess(user, access)) return homeFor(user);
  return null;
}

/** location.hash ('#/tables/3?x') -> '/tables/3'. */
export function pathFromHash(hash: string): string {
  const p = hash.replace(/^#/, '').split('?')[0] ?? '';
  return p.startsWith('/') ? p : `/${p}`;
}
