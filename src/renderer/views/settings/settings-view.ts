import type { Permission } from '@shared/permissions';
import { t } from '../../i18n';
import { appStore, can, updatePending } from '../../store/app';
import { html } from '../../ui/html';
import { icon, type IconName } from '../../ui/icons';
import type { View, ViewInstance } from '../types';
import { usersView } from '../users/users-view';
import { hallsSection } from './halls-section';
import { ordersSection } from './orders-section';
import { paymentsSection } from './payments-section';
import { printerSection } from './printer-section';
import { receiptSection } from './receipt-section';
import { systemSection } from './system-section';
import { updateSection } from './update-section';

interface Section {
  id: string;
  label: string;
  icon: IconName;
  view: View;
  /** Who sees the section (main checks each call again). */
  needs: Permission;
}

/** Settings sections, in menu order. Each is a View that renders its own page header. */
export const SETTINGS_SECTIONS: readonly Section[] = [
  { id: 'system', label: 'settings.sectionSystem', icon: 'sliders', view: systemSection, needs: 'settings' },
  { id: 'halls', label: 'settings.sectionHalls', icon: 'halls', view: hallsSection, needs: 'settings' },
  { id: 'orders', label: 'settings.sectionOrders', icon: 'delivery', view: ordersSection, needs: 'settings' },
  { id: 'payments', label: 'settings.sectionPayments', icon: 'cash', view: paymentsSection, needs: 'settings' },
  { id: 'receipt', label: 'settings.sectionReceipt', icon: 'receipt', view: receiptSection, needs: 'settings' },
  { id: 'printer', label: 'settings.sectionPrinter', icon: 'printer', view: printerSection, needs: 'settings' },
  { id: 'users', label: 'settings.sectionUsers', icon: 'users', view: usersView, needs: 'users' },
  { id: 'update', label: 'settings.sectionUpdate', icon: 'update', view: updateSection, needs: 'settings' },
];

/**
 * Settings: the sections this user may open (settings, users), as a section list on the left (a strip of tabs on narrow screens) and the chosen
 * section, `/settings/<section>`. `/settings` and unknown sections open the first one.
 */
export const settingsView: View = (ctx) => {
  const sections = SETTINGS_SECTIONS.filter((s) => can(s.needs));
  // The route lets in only users with settings or users, so there is always a section.
  const current = sections.find((s) => s.id === ctx.params['section']) ?? sections[0]!;

  const el = document.createElement('section');
  el.className = 'page settings-page';

  const nav = document.createElement('nav');
  nav.className = 'settings-nav';
  nav.setAttribute('aria-label', t('settings.navLabel'));
  nav.append(
    html`<h2 class="settings-nav-title">${t('settings.title')}</h2>`,
    ...sections.map((s) => {
      const a = document.createElement('a');
      a.href = `#/settings/${s.id}`;
      a.className = 'settings-nav-link';
      if (s === current) a.setAttribute('aria-current', 'page');
      a.dataset['section'] = s.id;
      a.append(
        icon(s.icon),
        Object.assign(document.createElement('span'), { textContent: t(s.label) }),
      );
      return a;
    }),
  );
  // A dot on "Dastur yangilanishi" while a newer version waits.
  const updateLink = nav.querySelector<HTMLElement>('[data-section="update"]');
  const renderDot = () => updateLink?.classList.toggle('has-dot', updatePending());
  renderDot();
  const stopDot = appStore.subscribe(renderDot);

  const content = document.createElement('div');
  content.className = 'settings-content';
  const section: ViewInstance = current.view(ctx);
  content.append(section.el);
  el.append(nav, content);

  return {
    el,
    destroy: () => {
      stopDot();
      section.destroy?.();
    },
    canLeave: () => section.canLeave?.() ?? true,
  };
};
