export interface ViewContext {
  params: Record<string, string>;
  navigate(path: string): void;
}

export interface ViewInstance {
  el: Node;
  /** Remove listeners, timers, subscriptions. Called when the view is replaced. */
  destroy?(): void;
  /** Return false to stay (e.g. unsaved changes the user chose to keep). */
  canLeave?(): boolean | Promise<boolean>;
}

/** A page: a function that builds its DOM and wires itself up. No framework. */
export type View = (ctx: ViewContext) => ViewInstance;
