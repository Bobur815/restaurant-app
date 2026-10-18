import { appStore } from '../store/app';
import type { View, ViewInstance } from '../views/types';
import { matchRoute, pathFromHash, redirectFor, type RouteDef } from './routes';

export interface ShellInstance {
  /** Where shell-layout views are mounted. */
  outlet: HTMLElement;
  el: HTMLElement;
  /** Called on every shell route change (active nav item). */
  update(path: string): void;
  destroy(): void;
}

export interface RouterOptions {
  root: HTMLElement;
  routes: readonly RouteDef<View>[];
  createShell(navigate: (path: string) => void): ShellInstance;
}

export interface Router {
  navigate(path: string): void;
  /** Re-mounts the current view (and shell), e.g. after a language change. */
  refresh(): void;
  current(): string;
}

/**
 * Hash router: `#/tables/3` -> route table -> view. Access is decided by `redirectFor` (setup,
 * login, admin); views get params and `navigate`. A view's `canLeave()` can veto a navigation.
 */
export function startRouter(options: RouterOptions): Router {
  let view: ViewInstance | null = null;
  let shell: ShellInstance | null = null;
  let currentPath = '';
  let suppressNext = false;

  const navigate = (path: string) => {
    if (pathFromHash(location.hash) === path) void resolve(true);
    else location.hash = `#${path}`;
  };

  const mount = (path: string) => {
    const { setup, user } = appStore.get();
    const match = matchRoute(options.routes, path);
    const redirect = redirectFor(
      path,
      match?.route.access ?? null,
      setup ?? { setupComplete: false, hasAdmin: false },
      user,
    );
    if (redirect !== null && redirect !== path) {
      suppressNext = false;
      location.replace(`#${redirect}`);
      return;
    }
    if (!match) return;

    view?.destroy?.();
    view = null;

    let container: HTMLElement;
    if (match.route.layout === 'shell') {
      if (!shell) {
        shell = options.createShell(navigate);
        options.root.replaceChildren(shell.el);
      }
      shell.update(path);
      container = shell.outlet;
    } else {
      shell?.destroy();
      shell = null;
      container = options.root;
    }

    currentPath = path;
    view = match.route.view({ params: match.params, navigate });
    container.replaceChildren(view.el);
    window.scrollTo(0, 0);
  };

  const resolve = async (force = false) => {
    const path = pathFromHash(location.hash);
    if (suppressNext) {
      suppressNext = false;
      return;
    }
    if (!force && path === currentPath) return;
    if (view?.canLeave && currentPath && path !== currentPath) {
      const ok = await view.canLeave();
      if (!ok) {
        suppressNext = true;
        location.hash = `#${currentPath}`; // put the URL back; the view stays
        return;
      }
    }
    mount(path);
  };

  window.addEventListener('hashchange', () => void resolve());
  void resolve(true);

  return {
    navigate,
    refresh() {
      view?.destroy?.();
      view = null;
      shell?.destroy();
      shell = null;
      currentPath = '';
      mount(pathFromHash(location.hash));
    },
    current: () => currentPath,
  };
}
