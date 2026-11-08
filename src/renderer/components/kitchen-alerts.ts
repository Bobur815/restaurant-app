import type { KitchenTicketDto } from '@shared/types';
import { api } from '../api';
import { t } from '../i18n';
import { can } from '../store/app';
import { errorMessage, toast } from './toast';

/**
 * Feature F11: tells whoever takes orders when a kitchen ticket did not print, with a "Qayta"
 * button. Main prints the tickets in the background after a save and announces `kitchen-changed`;
 * this re-reads the failed list and shows each failure once per window.
 */
export function watchKitchenFailures(): void {
  const shown = new Set<number>();

  const where = (f: KitchenTicketDto) =>
    f.tableNumber !== null ? t('kitchen.table', { table: f.tableNumber }) : f.orderNumber;
  const printerName = (f: KitchenTicketDto) =>
    f.printerLabel || f.printerWindowsName || t('kitchen.printer');

  const reprint = async (f: KitchenTicketDto) => {
    try {
      await api.kitchen.reprint({ ticketId: f.id });
      shown.delete(f.id);
      toast(t('kitchen.reprinted', { printer: printerName(f) }), 'success');
    } catch (error) {
      // Still failing: offer it again.
      shown.delete(f.id);
      toast(
        t('kitchen.failed', {
          printer: printerName(f),
          where: where(f),
          reason: errorMessage(error),
        }),
        'error',
        20_000,
        { label: t('kitchen.retry'), onClick: () => void reprint(f) },
      );
      shown.add(f.id);
    }
  };

  const check = async () => {
    if (!can('orders')) return;
    let failed: KitchenTicketDto[];
    try {
      failed = await api.kitchen.failed();
    } catch {
      return;
    }
    for (const f of failed) {
      if (shown.has(f.id)) continue;
      shown.add(f.id);
      toast(
        t('kitchen.failed', { printer: printerName(f), where: where(f), reason: f.error ?? '' }),
        'error',
        20_000,
        { label: t('kitchen.retry'), onClick: () => void reprint(f) },
      );
    }
  };

  api.events.subscribe((e) => {
    if (e.type === 'kitchen-changed') void check();
  });
}
