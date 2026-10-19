import type { CustomerLookupDto } from '@shared/types';
import { isUzPhoneComplete, normalizeUzPhone } from '@shared/utils/phone';
import type { DbOrTx, Tx } from '../domain/db';

/**
 * Customers, found by phone (stored 998XXXXXXXXX). Created and kept current from takeaway and
 * delivery orders, so the next order from the same phone fills itself in. Debt (F1-C) builds on
 * the same records.
 */

/**
 * Autofill for the order form: the name, address and landmark stored for this phone (typed in any
 * form); null when unknown or incomplete. A reverse lookup any logged-in user can make, so it
 * returns nothing else (review again before this is reachable over the LAN, Phase 8.5).
 */
export async function findCustomerByPhone(
  db: DbOrTx,
  phone: string,
): Promise<CustomerLookupDto | null> {
  if (!isUzPhoneComplete(phone)) return null;
  const c = await db.customer.findUnique({ where: { phone: normalizeUzPhone(phone) } });
  return c && c.isActive ? { name: c.name, address: c.address, landmark: c.landmark } : null;
}

/**
 * Finds or creates the customer for an order and returns the id. What the order says wins: a
 * given name, address or landmark replaces the stored one (people move, couriers learn better
 * landmarks); a missing one never erases what is stored.
 */
export async function upsertCustomer(
  tx: Tx,
  c: { phone: string; name: string | null; address: string | null; landmark: string | null },
): Promise<number> {
  const data = {
    ...(c.name ? { name: c.name } : {}),
    ...(c.address ? { address: c.address } : {}),
    ...(c.landmark ? { landmark: c.landmark } : {}),
  };
  const existing = await tx.customer.findUnique({ where: { phone: c.phone } });
  if (existing) {
    if (Object.keys(data).length > 0 || !existing.isActive)
      await tx.customer.update({ where: { id: existing.id }, data: { ...data, isActive: true } });
    return existing.id;
  }
  return (await tx.customer.create({ data: { phone: c.phone, ...data } })).id;
}
