import { IPC_CHANNELS } from '@shared/ipc';
import { CHANNEL_EVENTS, eventsFor, READ_ONLY_CHANNELS } from './events';

describe('change events', () => {
  it('every channel is either read-only or declares what it changes, never both', () => {
    const readOnly = new Set<string>(READ_ONLY_CHANNELS);
    const mutating = new Set(Object.keys(CHANNEL_EVENTS));
    expect([...readOnly].filter((c) => mutating.has(c))).toEqual([]);
    expect(IPC_CHANNELS.filter((c) => !readOnly.has(c) && !mutating.has(c))).toEqual([]);
  });

  it('order changes name the table and refresh the shift (stock moved)', () => {
    const order = { id: 7, tableNumber: 4 };
    expect(eventsFor('orders:save', {}, order)).toEqual([
      { type: 'orders-changed', orderId: 7, tableNumber: 4 },
      { type: 'session-changed' },
    ]);
    // A payment may add debt, so the debtors list refreshes too.
    expect(eventsFor('payments:pay', {}, order)).toEqual([
      { type: 'orders-changed', orderId: 7, tableNumber: 4 },
      { type: 'debts-changed' },
    ]);
    expect(eventsFor('checks:delete', {}, order)).toContainEqual({ type: 'session-changed' });
    expect(eventsFor('debts:repay', {}, {})).toContainEqual({ type: 'debts-changed' });
  });

  it('reads and login announce nothing', () => {
    expect(eventsFor('menu:list', {}, [])).toEqual([]);
    expect(eventsFor('auth:pinLogin', {}, {})).toEqual([]);
  });
});
