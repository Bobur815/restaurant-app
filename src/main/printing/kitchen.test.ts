import {
  menuItemInput,
  moveTableInput,
  saveOpenOrderInput,
  saveTableOrderInput,
} from '@shared/schemas';
import type { Actor } from '../domain/db';
import { createMenuItem, updateMenuItem } from '../menu/menu-items';
import {
  cancelOpenOrder,
  cancelTableOrder,
  moveTableOrder,
  saveOpenOrder,
  saveTableOrder,
} from '../orders/orders';
import { getOpenSession, openSession } from '../sessions/sessions';
import { createTestDb, createUser, type TestDb } from '../test-utils/db';
import {
  buildKitchenTicketHtml,
  diffLines,
  listFailedTickets,
  printKitchenTickets,
  reprintKitchenTicket,
  type KitchenPayload,
} from './kitchen';
import type { PrinterService } from './printer';
import { createPrinter, updatePrinter } from './printers';

jest.setTimeout(60_000);

const item = (
  menuItemId: number,
  quantity: string,
  extra: { portion?: string; weightKg?: string; soldByWeight?: boolean } = {},
) => ({
  menuItemId,
  quantity,
  portion: extra.portion ?? null,
  weightKg: extra.weightKg ?? null,
  soldByWeight: extra.soldByWeight ?? false,
});

describe('diffLines', () => {
  const view = (old: ReturnType<typeof item>[], next: ReturnType<typeof item>[]) =>
    diffLines(old, next).map((c) => [c.menuItemId, c.portion, c.weightKg, c.delta.toFixed()]);

  it('a new order: every line is an addition', () => {
    expect(view([], [item(1, '2'), item(2, '1', { portion: '0.7' })])).toEqual([
      [1, null, null, '2'],
      [2, '0.7', null, '1'],
    ]);
  });

  it('more, less, gone and unchanged', () => {
    const old = [item(1, '2'), item(2, '3'), item(3, '1')];
    const next = [item(1, '5'), item(2, '1'), item(4, '1')];
    expect(view(old, next)).toEqual([
      [1, null, null, '3'],
      [2, null, null, '-2'],
      [4, null, null, '1'],
      [3, null, null, '-1'],
    ]);
    expect(view(old, old)).toEqual([]);
  });

  it('a portion or weight change is the old line off and a new one on', () => {
    expect(view([item(2, '1', { portion: '1' })], [item(2, '1', { portion: '0.5' })])).toEqual([
      [2, '0.5', null, '1'],
      [2, null, null, '-1'], // a whole portion reads as no portion
    ]);
    const w = (kg: string) => item(7, '2', { weightKg: kg, soldByWeight: true });
    expect(view([w('0.25')], [w('0.250')])).toEqual([]); // same weight, written differently
    expect(view([w('0.25')], [w('0.3')])).toEqual([
      [7, null, '0.3', '2'],
      [7, null, '0.25', '-2'],
    ]);
  });

  it('a whole portion and no portion are the same line', () => {
    expect(view([item(2, '1', { portion: '1' })], [item(2, '1')])).toEqual([]);
  });

  it('two lines of the same dish add up', () => {
    expect(view([item(1, '1')], [item(1, '1'), item(1, '2')])).toEqual([[1, null, null, '2']]);
  });
});

describe('the ticket document', () => {
  const payload: KitchenPayload = {
    orderNumber: '2026-00042',
    orderType: 'DINE_IN',
    tableNumber: 7,
    hallName: 'Asosiy zal',
    fromTable: null,
    customerName: null,
    waiter: 'Aziz <b>',
    at: '2026-11-08T12:30:00.000Z',
    printerLabel: 'Oshxona',
    lines: [
      {
        nameUz: '<script>x</script>',
        nameRu: null,
        qty: '2',
        portion: '0.5',
        weightKg: null,
        soldByWeight: false,
      },
    ],
    cancelled: [],
  };

  it('escapes every value and shows table, waiter and lines, no prices', () => {
    const html = buildKitchenTicketHtml('NEW', payload, 'uz');
    expect(html).toContain('YANGI BUYURTMA');
    expect(html).toContain('Stol 7');
    expect(html).toContain('Asosiy zal');
    expect(html).toContain('Aziz &lt;b&gt;');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt; (yarim)');
    expect(html).not.toContain('<script>');
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/so'm|сум/);
  });

  it('a save that only took dishes off says so; a move names both tables; takeaway has no table', () => {
    const off = buildKitchenTicketHtml(
      'ADD',
      { ...payload, cancelled: payload.lines, lines: [] },
      'ru',
    );
    expect(off).toContain('ИЗМЕНЕНИЕ');
    expect(off).toContain('ОТМЕНА');
    expect(buildKitchenTicketHtml('MOVE', { ...payload, fromTable: 3, lines: [] }, 'uz')).toContain(
      'Stol 3 → 7',
    );
    const takeaway = buildKitchenTicketHtml(
      'NEW',
      { ...payload, orderType: 'TAKEAWAY', tableNumber: null, customerName: 'Aziza' },
      'uz',
    );
    expect(takeaway).toContain('Olib ketish');
    expect(takeaway).toContain('Aziza');
  });
});

describe('tickets written with the order', () => {
  let t: TestDb;
  let waiter: Actor;
  let osh: number; // kitchen, portions
  let choy: number; // bar
  let non: number; // no printer
  let somsa: number; // a hidden printer
  let kitchen: number;
  let bar: number;

  const tickets = (orderId: number) =>
    t.db.kitchenTicket.findMany({ where: { orderId }, orderBy: { id: 'asc' } });
  const payloadOf = (row: { payload: string }) => JSON.parse(row.payload) as KitchenPayload;
  const lineNames = (lines: KitchenPayload['lines']) =>
    lines.map((l) => `${l.qty} ${l.nameUz}${l.portion ? ` ${l.portion}` : ''}`);
  const save = (tableNumber: number, lines: unknown[], expectedVersion?: number, sink?: number[]) =>
    saveTableOrder(
      t.db,
      waiter,
      saveTableOrderInput.parse({ tableNumber, lines, expectedVersion }),
      sink,
    );

  beforeAll(async () => {
    t = await createTestDb();
    waiter = await createUser(t.db, { username: 'Aziz' });
    kitchen = (await createPrinter(t.db, { label: 'Oshxona', windowsName: 'K-80' })).id;
    bar = (await createPrinter(t.db, { label: 'Bar', windowsName: 'B-58' })).id;
    const hidden = (await createPrinter(t.db, { label: 'Eski', windowsName: 'OLD' })).id;
    const categoryId = (await t.db.category.findFirstOrThrow()).id;
    const mk = async (over: Record<string, unknown>) =>
      (await createMenuItem(t.db, menuItemInput.parse({ categoryId, ...over }))).id;
    osh = await mk({ nameUz: 'Osh', price: '25000', hasPortions: true, printerId: kitchen });
    choy = await mk({ nameUz: 'Choy', price: '3000', printerId: bar });
    non = await mk({ nameUz: 'Non', price: '5000' });
    somsa = await mk({ nameUz: 'Somsa', price: '8000', printerId: hidden });
    await updatePrinter(t.db, { id: hidden, isActive: false });
    await openSession(t.db, waiter, {
      items: [osh, choy, non, somsa].map((menuItemId) => ({ menuItemId, initialQuantity: '50' })),
    });
  });
  afterAll(() => t.close());

  it('a new order: one ticket per printer with only its dishes; stock and total as always', async () => {
    const sink: number[] = [];
    const order = await save(
      1,
      [
        { menuItemId: osh, quantity: 2, portion: '0.7' },
        { menuItemId: choy, quantity: 3 },
        { menuItemId: non, quantity: 4 },
        { menuItemId: somsa, quantity: 1 },
      ],
      undefined,
      sink,
    );
    // Money and stock: exactly what the order rules give, tickets or not.
    expect(order.totalAmount).toBe('72000'); // 35 000 + 9 000 + 20 000 + 8 000
    const sold = Object.fromEntries(
      (await getOpenSession(t.db))!.items.map((i) => [i.nameUz, i.soldQuantity]),
    );
    expect(sold).toEqual({ Osh: '1.4', Choy: '3', Non: '4', Somsa: '1' });

    const rows = await tickets(order.id);
    expect(sink).toEqual(rows.map((r) => r.id));
    expect(rows.map((r) => [r.printerId, r.kind, r.createdById, r.printedAt])).toEqual([
      [kitchen, 'NEW', waiter.id, null],
      [bar, 'NEW', waiter.id, null],
    ]);
    const k = payloadOf(rows[0]!);
    expect(k).toMatchObject({
      orderNumber: order.orderNumber,
      orderType: 'DINE_IN',
      tableNumber: 1,
      hallName: expect.any(String),
      waiter: 'Aziz',
      printerLabel: 'Oshxona',
      cancelled: [],
    });
    expect(lineNames(k.lines)).toEqual(['2 Osh 0.7']);
    expect(lineNames(payloadOf(rows[1]!).lines)).toEqual(['3 Choy']);
  });

  it('a later save sends only what changed; an unchanged save sends nothing', async () => {
    const before = await t.db.order.findUniqueOrThrow({ where: { pendingTable: 1 } });
    const order = await save(
      1,
      [
        { menuItemId: osh, quantity: 3, portion: '0.7' },
        { menuItemId: non, quantity: 4 },
        { menuItemId: somsa, quantity: 1 },
      ],
      before.version,
    );
    const added = (await tickets(order.id)).slice(2);
    expect(added.map((r) => [r.printerId, r.kind])).toEqual([
      [kitchen, 'ADD'],
      [bar, 'ADD'],
    ]);
    expect(lineNames(payloadOf(added[0]!).lines)).toEqual(['1 Osh 0.7']);
    expect(payloadOf(added[0]!).cancelled).toEqual([]);
    expect(payloadOf(added[1]!).lines).toEqual([]);
    expect(lineNames(payloadOf(added[1]!).cancelled)).toEqual(['3 Choy']);

    const sink: number[] = [];
    const same = await save(
      1,
      [
        { menuItemId: osh, quantity: 3, portion: '0.7' },
        { menuItemId: non, quantity: 4 },
        { menuItemId: somsa, quantity: 1 },
      ],
      order.version,
      sink,
    );
    expect(sink).toEqual([]);
    expect(await tickets(same.id)).toHaveLength(4);
  });

  it('a refused save (old version, shortage) writes no ticket', async () => {
    const order = await t.db.order.findUniqueOrThrow({ where: { pendingTable: 1 } });
    const count = await t.db.kitchenTicket.count();
    await expect(
      save(1, [{ menuItemId: choy, quantity: 1 }], order.version - 1),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      save(1, [{ menuItemId: choy, quantity: 500 }], order.version),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await t.db.kitchenTicket.count()).toBe(count);
  });

  it('a move tells the printers cooking for it; a cancel lists everything to stop', async () => {
    const order = await t.db.order.findUniqueOrThrow({ where: { pendingTable: 1 } });
    const sink: number[] = [];
    await moveTableOrder(
      t.db,
      moveTableInput.parse({ fromTable: 1, toTable: 2, expectedVersion: order.version }),
      { actor: waiter, tickets: sink },
    );
    const moved = await t.db.kitchenTicket.findMany({ where: { id: { in: sink } } });
    // Choy is off the order: only the kitchen hears about the move.
    expect(moved.map((r) => [r.printerId, r.kind])).toEqual([[kitchen, 'MOVE']]);
    expect(payloadOf(moved[0]!)).toMatchObject({ fromTable: 1, tableNumber: 2, lines: [] });

    const cancelSink: number[] = [];
    const current = await t.db.order.findUniqueOrThrow({ where: { pendingTable: 2 } });
    await cancelTableOrder(
      t.db,
      { tableNumber: 2, expectedVersion: current.version },
      { actor: waiter, tickets: cancelSink },
    );
    const cancelled = await t.db.kitchenTicket.findMany({ where: { id: { in: cancelSink } } });
    expect(cancelled.map((r) => [r.printerId, r.kind])).toEqual([[kitchen, 'CANCEL']]);
    expect(lineNames(payloadOf(cancelled[0]!).lines)).toEqual(['3 Osh 0.7']);
  });

  it('takeaway orders get tickets too, without a table', async () => {
    const sink: number[] = [];
    const order = await saveOpenOrder(
      t.db,
      waiter,
      saveOpenOrderInput.parse({
        orderType: 'TAKEAWAY',
        customerName: 'Aziza',
        lines: [{ menuItemId: choy, quantity: 2 }],
      }),
      sink,
    );
    const [row] = await t.db.kitchenTicket.findMany({ where: { id: { in: sink } } });
    expect(row).toMatchObject({ printerId: bar, kind: 'NEW' });
    expect(payloadOf(row!)).toMatchObject({
      orderType: 'TAKEAWAY',
      tableNumber: null,
      customerName: 'Aziza',
    });
    const cancelSink: number[] = [];
    await cancelOpenOrder(
      t.db,
      { orderId: order.id, expectedVersion: order.version },
      { actor: waiter, tickets: cancelSink },
    );
    expect(cancelSink).toHaveLength(1);
  });

  it('a dish moved to another printer prints there from the next save', async () => {
    await updateMenuItem(t.db, { id: non, printerId: kitchen });
    const sink: number[] = [];
    await save(5, [{ menuItemId: non, quantity: 1 }], undefined, sink);
    const rows = await t.db.kitchenTicket.findMany({ where: { id: { in: sink } } });
    expect(rows.map((r) => r.printerId)).toEqual([kitchen]);
  });

  describe('printing', () => {
    const jobs: Array<{ html: string; preferredName: string | null; exact?: boolean }> = [];
    let failOn: string | undefined;
    const fakePrinter: PrinterService = {
      list: async () => [],
      print: async (html, opts) => {
        if (failOn !== undefined && opts.preferredName === failOn) throw new Error('offline');
        jobs.push({ html, ...opts });
        return { printer: opts.preferredName ?? 'auto' };
      },
      preview: async () => '',
    };

    it('prints each ticket to its own printer, exactly; a failure is recorded, not thrown', async () => {
      const sink: number[] = [];
      await save(
        6,
        [
          { menuItemId: osh, quantity: 1, portion: '1' },
          { menuItemId: choy, quantity: 1 },
        ],
        undefined,
        sink,
      );
      failOn = 'B-58';
      jobs.length = 0;
      const failed = await printKitchenTickets(t.db, fakePrinter, sink, () => undefined);
      expect(jobs.map((j) => [j.preferredName, j.exact])).toEqual([['K-80', true]]);
      expect(failed).toEqual([sink[1]]);

      const rows = await t.db.kitchenTicket.findMany({ where: { id: { in: sink } } });
      expect(rows[0]!.printedAt).not.toBeNull();
      expect(rows[1]!).toMatchObject({ printedAt: null, error: "Chop etib bo'lmadi" });
      expect(
        (await listFailedTickets(t.db)).map((f) => [f.id, f.printerLabel, f.tableNumber]),
      ).toEqual([[sink[1], 'Bar', 6]]);

      failOn = undefined;
      await expect(reprintKitchenTicket(t.db, fakePrinter, sink[1]!)).resolves.toEqual({
        printer: 'B-58',
      });
      expect(await listFailedTickets(t.db)).toEqual([]);
    });

    it('a dish on the main printer prints there the way receipts do (automatic pick allowed)', async () => {
      const main = await t.db.printer.findFirstOrThrow({ where: { isMain: true } });
      await updateMenuItem(t.db, { id: non, printerId: main.id });
      const sink: number[] = [];
      await save(8, [{ menuItemId: non, quantity: 1 }], undefined, sink);
      jobs.length = 0;
      await printKitchenTickets(t.db, fakePrinter, sink, () => undefined);
      expect(jobs.map((j) => [j.preferredName, j.exact])).toEqual([[null, false]]);
    });
  });
});

describe('review fixes (F11)', () => {
  let t: TestDb;
  let waiter: Actor;
  let shashlik: number;
  let kitchen: number;
  const fakePrinter: PrinterService = {
    list: async () => [],
    print: async (_html, opts) => ({ printer: opts.preferredName ?? 'auto' }),
    preview: async () => '',
  };

  beforeAll(async () => {
    t = await createTestDb();
    waiter = await createUser(t.db, { username: 'Aziz' });
    kitchen = (await createPrinter(t.db, { label: 'Mangal', windowsName: 'K-80' })).id;
    const categoryId = (await t.db.category.findFirstOrThrow()).id;
    shashlik = (
      await createMenuItem(
        t.db,
        menuItemInput.parse({
          nameUz: 'Shashlik',
          price: '180000',
          soldByWeight: true,
          categoryId,
          printerId: kitchen,
        }),
      )
    ).id;
    await openSession(t.db, waiter, { items: [{ menuItemId: shashlik, initialQuantity: '20' }] });
  });
  afterAll(() => t.close());

  it('an unchanged weight line (stored 0.45, sent 0.450) sends nothing; a stale move or cancel writes nothing', async () => {
    const first = await saveTableOrder(
      t.db,
      waiter,
      saveTableOrderInput.parse({
        tableNumber: 3,
        lines: [{ menuItemId: shashlik, quantity: 2, weightKg: '0.450' }],
      }),
    );
    const count = await t.db.kitchenTicket.count();
    const sink: number[] = [];
    await saveTableOrder(
      t.db,
      waiter,
      saveTableOrderInput.parse({
        tableNumber: 3,
        expectedVersion: first.version,
        lines: [{ menuItemId: shashlik, quantity: 2, weightKg: '0.45' }],
      }),
      sink,
    );
    expect(sink).toEqual([]);
    await expect(
      moveTableOrder(
        t.db,
        moveTableInput.parse({ fromTable: 3, toTable: 4, expectedVersion: first.version }),
        { actor: waiter },
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      cancelTableOrder(t.db, { tableNumber: 3, expectedVersion: first.version }, { actor: waiter }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await t.db.kitchenTicket.count()).toBe(count);
  });

  it('lists a ticket never tried after two minutes; a reprint goes once, never to a hidden printer', async () => {
    const [ticket] = await t.db.kitchenTicket.findMany({ orderBy: { id: 'asc' } });
    expect(await listFailedTickets(t.db)).toEqual([]); // just written: the background print may be on it
    await t.db.kitchenTicket.update({
      where: { id: ticket!.id },
      data: { createdAt: new Date(Date.now() - 5 * 60_000) },
    });
    expect((await listFailedTickets(t.db)).map((f) => f.id)).toEqual([ticket!.id]);

    await reprintKitchenTicket(t.db, fakePrinter, ticket!.id);
    await expect(reprintKitchenTicket(t.db, fakePrinter, ticket!.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const other = await t.db.kitchenTicket.create({
      data: { orderId: ticket!.orderId, printerId: kitchen, kind: 'ADD', payload: ticket!.payload },
    });
    await updatePrinter(t.db, { id: kitchen, isActive: false });
    await expect(reprintKitchenTicket(t.db, fakePrinter, other.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await updatePrinter(t.db, { id: kitchen, isActive: true });
    await t.db.kitchenTicket.update({
      where: { id: other.id },
      data: { createdAt: new Date(Date.now() - 13 * 60 * 60_000) },
    });
    await expect(reprintKitchenTicket(t.db, fakePrinter, other.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('a paper that came out stays printed even if recording it fails', async () => {
    const [ticket] = await t.db.kitchenTicket.findMany({
      where: { printedAt: null },
      orderBy: { id: 'desc' },
      take: 1,
    });
    await t.db.kitchenTicket.update({ where: { id: ticket!.id }, data: { createdAt: new Date() } });
    const update = jest
      .spyOn(t.db.kitchenTicket, 'update')
      .mockRejectedValueOnce(new Error('busy'));
    try {
      await expect(reprintKitchenTicket(t.db, fakePrinter, ticket!.id)).resolves.toEqual({
        printer: 'K-80',
      });
    } finally {
      update.mockRestore();
    }
    const row = await t.db.kitchenTicket.findUniqueOrThrow({ where: { id: ticket!.id } });
    expect(row.error).toBeNull(); // not marked failed
  });
});
