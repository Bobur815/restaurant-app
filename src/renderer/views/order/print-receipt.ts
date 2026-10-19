import { api } from '../../api';
import { errorMessage, toast } from '../../components/toast';
import { t } from '../../i18n';

/**
 * Prints an order's receipt and reports the outcome as a toast. Never throws and is never
 * awaited by the sale: a printer that is off or out of paper must not block taking money.
 */
export function printReceipt(orderId: number): void {
  api.printing
    .printReceipt({ orderId })
    .then((r) => toast(t('printing.printed', { printer: r.printer }), 'success'))
    .catch((error: unknown) =>
      toast(t('printing.failed', { reason: errorMessage(error) }), 'error', 8000),
    );
}
