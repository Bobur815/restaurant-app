import { t } from '../i18n';
import { html } from '../ui/html';
import { icon } from '../ui/icons';
import type { View } from './types';

/** Routes whose screens arrive in Phase 5b. */
export function placeholderView(titleKey: string): View {
  return () => {
    const el = document.createElement('section');
    el.className = 'page';
    el.append(
      html`<header class="page-header"><h1>${t(titleKey)}</h1></header>
        <div class="empty-state">
          ${icon('timer', 40)}
          <p>${t('app.comingSoon')}</p>
        </div>`,
    );
    return { el };
  };
}
