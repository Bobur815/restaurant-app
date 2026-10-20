import { PERMISSIONS } from '@shared/permissions';
import { matchRoute, pathFromHash, redirectFor, type RouteDef } from './routes';

const routes: RouteDef<string>[] = [
  { path: '/setup', access: 'public', layout: 'bare', view: 'setup' },
  { path: '/login', access: 'public', layout: 'bare', view: 'login' },
  { path: '/tables', access: 'orders', layout: 'shell', view: 'tables' },
  { path: '/tables/:table', access: 'orders', layout: 'shell', view: 'order' },
  { path: '/users', access: 'users', layout: 'shell', view: 'users' },
];

const done = { setupComplete: true, hasAdmin: true };
const fresh = { setupComplete: false, hasAdmin: false };
const staff = {
  id: 2,
  fullName: 'S',
  phone: null,
  role: 'STAFF' as const,
  permissions: ['orders' as const],
};
const admin = {
  id: 1,
  fullName: 'A',
  phone: null,
  role: 'ADMIN' as const,
  permissions: [...PERMISSIONS],
};
/** Reports only: never sent to a page it may not open (no redirect loop). */
const accountant = { ...staff, id: 3, permissions: ['reports' as const] };

describe('matchRoute', () => {
  it('matches static and param routes', () => {
    expect(matchRoute(routes, '/tables')?.route.view).toBe('tables');
    expect(matchRoute(routes, '/tables/12')).toMatchObject({
      route: { view: 'order' },
      params: { table: '12' },
    });
    expect(matchRoute(routes, '/tables/12/x')).toBeNull();
    expect(matchRoute(routes, '/nope')).toBeNull();
  });

  it('pathFromHash normalises', () => {
    expect(pathFromHash('#/tables/3?x=1')).toBe('/tables/3');
    expect(pathFromHash('')).toBe('/');
    expect(pathFromHash('#tables')).toBe('/tables');
  });
});

describe('redirectFor', () => {
  it('everything goes to setup until it is done', () => {
    expect(redirectFor('/tables', 'user', fresh, null)).toBe('/setup');
    expect(redirectFor('/login', 'public', fresh, null)).toBe('/setup');
    expect(redirectFor('/setup', 'public', fresh, null)).toBeNull();
  });

  it('setup is closed once done', () => {
    expect(redirectFor('/setup', 'public', done, null)).toBe('/login');
    expect(redirectFor('/setup', 'public', done, admin)).toBe('/tables');
  });

  it('protected pages need a login; login page skipped when logged in', () => {
    expect(redirectFor('/tables', 'user', done, null)).toBe('/login');
    expect(redirectFor('/login', 'public', done, staff)).toBe('/tables');
    expect(redirectFor('/tables', 'user', done, staff)).toBeNull();
  });

  it('the lock screen behaves like login', () => {
    expect(redirectFor('/lock', 'public', done, null)).toBeNull();
    expect(redirectFor('/lock', 'public', done, staff)).toBe('/tables');
    expect(redirectFor('/lock', 'public', fresh, null)).toBe('/setup');
  });

  it('pages need their permission; without it the user goes to their own home', () => {
    expect(redirectFor('/users', 'users', done, staff)).toBe('/tables');
    expect(redirectFor('/users', 'users', done, admin)).toBeNull();
    expect(redirectFor('/tables', 'orders', done, accountant)).toBe('/sessions');
    expect(redirectFor('/settings', ['settings', 'users'], done, admin)).toBeNull();
    expect(redirectFor('/settings', ['settings', 'users'], done, staff)).toBe('/tables');
  });

  it('unknown routes go home or to login', () => {
    expect(redirectFor('/nope', null, done, staff)).toBe('/tables');
    expect(redirectFor('/nope', null, done, null)).toBe('/login');
  });
});
