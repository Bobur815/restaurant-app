import { setupInput } from '@shared/schemas';
import { login } from '../auth/auth';
import { createTestDb, type TestDb } from '../test-utils/db';
import { getReceiptSettings, getSettings, updateReceiptSettings, updateSettings } from './settings';
import { completeSetup, getSetupStatus } from './setup';

jest.setTimeout(30_000);

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(() => t.close());

const wizard = setupInput.parse({
  admin: { username: 'owner', password: 'owner-pass' },
  receipt: { restaurantName: 'Test Oshxona', phone: '+998 90 000 00 00' },
  tableCount: 16,
});

describe('setup', () => {
  it('a fresh database is not set up', async () => {
    expect(await getSetupStatus(t.db)).toEqual({ setupComplete: false, hasAdmin: false });
  });

  it('creates the admin, receipt settings and table count together', async () => {
    const admin = await completeSetup(t.db, wizard);
    expect(admin).toMatchObject({ username: 'owner', role: 'ADMIN' });
    expect(await getSetupStatus(t.db)).toEqual({ setupComplete: true, hasAdmin: true });
    expect((await getSettings(t.db)).tableCount).toBe(16);
    expect(await getReceiptSettings(t.db)).toMatchObject({
      restaurantName: 'Test Oshxona',
      printWidthPx: 420,
    });
    await expect(login(t.db, { username: 'owner', password: 'owner-pass' })).resolves.toBeTruthy();
  });

  it('cannot be run twice (cannot be used to add admins later)', async () => {
    await completeSetup(t.db, wizard);
    await expect(
      completeSetup(t.db, { ...wizard, admin: { ...wizard.admin, username: 'intruder' } }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await t.db.user.count()).toBe(1);
  });

  it('is all or nothing', async () => {
    // A username that breaks the insert (duplicate) after nothing else was written.
    await t.db.user.create({ data: { username: 'owner', passwordHash: 'x', role: 'STAFF' } });
    await expect(completeSetup(t.db, wizard)).rejects.toBeTruthy();
    expect(await getReceiptSettings(t.db)).toBeNull();
    expect((await getSettings(t.db)).setupComplete).toBe(false);
  });
});

describe('settings', () => {
  it('reads defaults and updates only what was sent', async () => {
    expect(await getSettings(t.db)).toEqual({
      tableCount: 10,
      language: 'uz',
      theme: 'system',
      clickSound: true,
      lanEnabled: false,
      setupComplete: false,
    });
    const after = await updateSettings(t.db, { language: 'ru' });
    expect(after).toMatchObject({ language: 'ru', tableCount: 10 });
  });

  it('falls back to the default for a corrupt stored value', async () => {
    await t.db.setting.update({ where: { key: 'table_count' }, data: { value: '"lots"' } });
    await t.db.setting.update({ where: { key: 'theme' }, data: { value: '{not json' } });
    expect(await getSettings(t.db)).toMatchObject({ tableCount: 10, theme: 'system' });
  });

  it('receipt settings: partial update keeps the other fields', async () => {
    await completeSetup(t.db, wizard);
    const updated = await updateReceiptSettings(t.db, { footerNote: 'Rahmat!' });
    expect(updated).toMatchObject({
      footerNote: 'Rahmat!',
      restaurantName: 'Test Oshxona',
      phone: '+998 90 000 00 00',
    });
  });
});
