/**
 * Feature F13: a till's lease on a table it has open (main/orders/table-locks.ts) lives
 * TABLE_LOCK_LEASE_MS unless the order page renews it, which it does every TABLE_LOCK_RENEW_MS.
 * A till that crashed or lost the network frees its table within the lease.
 */
export const TABLE_LOCK_LEASE_MS = 45_000;
export const TABLE_LOCK_RENEW_MS = 15_000;
