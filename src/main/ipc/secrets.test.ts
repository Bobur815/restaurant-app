import type { IpcChannel } from '@shared/ipc';
import { setPin } from '../auth/auth';
import type { Actor } from '../domain/db';
import { createTestDb, createUser, type TestDb } from '../test-utils/db';
import { READ_ONLY_CHANNELS } from './events';
import { HANDLERS } from './handlers';
import { invokeHandler, type HandlerContext } from './ipc-safe';

jest.setTimeout(60_000);

/**
 * Phase 6 audit: no response, on any channel, ever carries a password or PIN hash. Users here
 * have both set, and the database has a shift, an order and a payment, so the read channels
 * return real rows (users, orders with createdBy, checks...).
 */
const SECRET = /\$2[aby]\$\d\d\$|passwordHash|pinCode/;

let t: TestDb;
let admin: Actor;

beforeAll(async () => {
  t = await createTestDb();
  admin = await createUser(t.db, { username: 'boss', role: 'ADMIN', password: 'boss-pass' });
  await setPin(t.db, admin, { currentPassword: 'boss-pass', pin: '1234' });
  const staff = await createUser(t.db, { username: 'kassa', password: 'kassa-pass' });
  await setPin(t.db, staff, { currentPassword: 'kassa-pass', pin: '4321' });

  const category = await t.db.category.findFirstOrThrow();
  const dish = await t.db.menuItem.create({
    data: { nameUz: 'Non', price: '5000', categoryId: category.id },
  });
  const session = await t.db.session.create({
    data: { openedById: admin.id, items: { create: { menuItemId: dish.id, initialQuantity: 10 } } },
  });
  await t.db.order.create({
    data: {
      orderNumber: '2026-00001',
      tableNumber: 1,
      sessionId: session.id,
      createdById: staff.id,
      status: 'completed',
      totalAmount: '5000',
      items: {
        create: {
          menuItemId: dish.id,
          quantity: 1,
          unitPrice: '5000',
          totalPrice: '5000',
          stockQuantity: 1,
        },
      },
      payments: { create: { amount: '5000', method: 'cash', createdById: staff.id } },
    },
  });
});
afterAll(() => t.close());

const today = new Date().toISOString().slice(0, 10);
const INPUTS: Partial<Record<IpcChannel, unknown>> = {
  'menu:get': { id: 1 },
  'sessions:get': { id: 1 },
  'orders:getTable': { tableNumber: 1 },
  'orders:getByNumber': { orderNumber: '2026-00001' },
  'checks:list': { startDate: today, endDate: today },
  'reports:sales': { start: today, end: today },
};

function ctx(actor: Actor | null): HandlerContext {
  return {
    db: t.db,
    actor,
    setActor: () => undefined,
    services: {
      appInfo: () => ({ name: 'x', version: '0', isPackaged: false }),
      printer: {
        list: async () => [],
        print: async () => ({ printer: 'Test' }),
        preview: async () => 'data:image/png;base64,',
      },
      pickImage: async () => null,
    },
    log: () => undefined,
  };
}

describe('no secrets over IPC', () => {
  it.each([...READ_ONLY_CHANNELS])('%s', async (channel) => {
    const result = await invokeHandler(
      channel,
      HANDLERS[channel] as never,
      ctx(admin),
      INPUTS[channel] ?? {},
    );
    expect(JSON.stringify(result)).not.toMatch(SECRET);
  });

  it('login, PIN login and user management answers carry no hashes', async () => {
    const calls: Array<[IpcChannel, unknown]> = [
      ['auth:login', { username: 'boss', password: 'boss-pass' }],
      ['auth:pinLogin', { userId: admin.id, pin: '1234' }],
      ['users:list', undefined],
      ['users:create', { username: 'yangi', password: 'yangi-pass' }],
      ['users:updateProfile', { fullName: 'Boss' }],
    ];
    for (const [channel, input] of calls) {
      const result = await invokeHandler(channel, HANDLERS[channel] as never, ctx(admin), input);
      expect(result.ok).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(SECRET);
    }
  });

  it('a check that the pattern does catch a hash (guards the test itself)', () => {
    expect(JSON.stringify({ a: '$2a$10$abcdefghijklmnopqrstuv' })).toMatch(SECRET);
  });
});
