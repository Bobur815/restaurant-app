import { t } from '../../i18n';
import { html } from '../../ui/html';
import { icon, type IconName } from '../../ui/icons';
import type { View, ViewInstance } from '../types';
import { usersView } from '../users/users-view';
import { hallsSection } from './halls-section';
import { printerSection } from './printer-section';
import { receiptSection } from './receipt-section';
import { systemSection } from './system-section';

interface Section {
  id: string;
  label: string;
  icon: IconName;
  view: View;
}

/** Settings sections, in menu order. Each is a View that renders its own page header. */
export const SETTINGS_SECTIONS: readonly Section[] = [
  { id: 'system', label: 'settings.sectionSystem', icon: 'sliders', view: systemSection },
  { id: 'halls', label: 'settings.sectionHalls', icon: 'halls', view: hallsSection },
  { id: 'receipt', label: 'settings.sectionReceipt', icon: 'receipt', view: receiptSection },
  { id: 'printer', label: 'settings.sectionPrinter', icon: 'printer', view: printerSection },
  { id: 'users', label: 'settings.sectionUsers', icon: 'users', view: usersView },
];

/**
 * Settings (admin): a section list on the left (a strip of tabs on narrow screens) and the chosen
 * section, `/settings/<section>`. `/settings` and unknown sections open the first one.
 */
export const settingsView: View = (ctx) => {
  const current =
    SETTINGS_SECTIONS.find((s) => s.id === ctx.params['section']) ?? SETTINGS_SECTIONS[0]!;

  const el = document.createElement('section');
  el.className = 'page settings-page';

  const nav = document.createElement('nav');
  nav.className = 'settings-nav';
  nav.setAttribute('aria-label', t('settings.navLabel'));
  nav.append(
    html`<h2 class="settings-nav-title">${t('settings.title')}</h2>`,
    ...SETTINGS_SECTIONS.map((s) => {
      const a = document.createElement('a');
      a.href = `#/settings/${s.id}`;
      a.className = 'settings-nav-link';
      if (s === current) a.setAttribute('aria-current', 'page');
      a.append(
        icon(s.icon),
        Object.assign(document.createElement('span'), { textContent: t(s.label) }),
      );
      return a;
    }),
  );

  const content = document.createElement('div');
  content.className = 'settings-content';
  const section: ViewInstance = current.view(ctx);
  content.append(section.el);
  el.append(nav, content);

  return {
    el,
    destroy: () => section.destroy?.(),
    canLeave: () => section.canLeave?.() ?? true,
  };
};
