import fs from 'fs';
import os from 'os';
import path from 'path';
import { menuItemInput } from '@shared/schemas';
import { importImage, ImageImportError, resolveImagePath, sniffImage } from '../images/image-store';
import { createTestDb, type TestDb } from '../test-utils/db';
import { createCategory, deleteCategory, listCategories, updateCategory } from './categories';
import {
  createMenuItem,
  deleteMenuItem,
  listMenuItems,
  normalizeForSearch,
  updateMenuItem,
} from './menu-items';

jest.setTimeout(30_000);

let t: TestDb;
let categoryId: number;
beforeEach(async () => {
  t = await createTestDb();
  categoryId = (await listCategories(t.db))[0]!.id;
});
afterEach(() => t.close());

const dish = (over: Record<string, unknown> = {}) =>
  menuItemInput.parse({ nameUz: "O'rama", nameRu: 'Шаурма', price: '28000', categoryId, ...over });

describe('categories', () => {
  it('lists the seeded defaults with active dish counts', async () => {
    await createMenuItem(t.db, dish());
    const cats = await listCategories(t.db);
    expect(cats).toHaveLength(5);
    expect(cats[0]).toMatchObject({ nameUz: 'Ovqatlar', nameRu: 'Блюда', menuItemCount: 1 });
  });

  it('duplicate names are a CONFLICT, rename keeps the rest', async () => {
    await expect(
      createCategory(t.db, { nameUz: 'Ovqatlar', nameRu: null, sortOrder: 0 }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const renamed = await updateCategory(t.db, { id: categoryId, nameRu: 'Еда' });
    expect(renamed).toMatchObject({ nameUz: 'Ovqatlar', nameRu: 'Еда' });
  });

  it('only an empty category can be deleted', async () => {
    await createMenuItem(t.db, dish());
    await expect(deleteCategory(t.db, categoryId)).rejects.toMatchObject({ code: 'CONFLICT' });
    const empty = (await listCategories(t.db))[1]!;
    await deleteCategory(t.db, empty.id);
    expect(await listCategories(t.db)).toHaveLength(4);
  });
});

describe('menu items', () => {
  it('stores the price exactly and returns it as a decimal string', async () => {
    const created = await createMenuItem(t.db, dish({ price: '28000.50' }));
    expect(created).toMatchObject({ price: '28000.5', categoryNameUz: 'Ovqatlar', isActive: true });
  });

  it('search ignores case, Cyrillic case and apostrophe variants', async () => {
    await createMenuItem(t.db, dish());
    await createMenuItem(t.db, dish({ nameUz: 'Osh', nameRu: 'Плов' }));
    const names = async (search: string) =>
      (await listMenuItems(t.db, { search, includeInactive: false })).map((m) => m.nameUz);
    expect(await names('o‘RAMA')).toEqual(["O'rama"]);
    expect(await names('ПЛОВ')).toEqual(['Osh']);
    expect(await names('')).toHaveLength(2);
    expect(normalizeForSearch('Gʻijduvon')).toBe("g'ijduvon");
  });

  it('cannot switch pieces/portions/kg while the dish is in the open shift', async () => {
    const m = await createMenuItem(t.db, dish());
    await t.db.session.create({
      data: { items: { create: { menuItemId: m.id, initialQuantity: 10 } } },
    });
    await expect(updateMenuItem(t.db, { id: m.id, soldByWeight: true })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(updateMenuItem(t.db, { id: m.id, price: '30000' })).resolves.toMatchObject({
      price: '30000',
    });
  });

  it('delete removes an unused dish, hides one with history', async () => {
    const unused = await createMenuItem(t.db, dish({ nameUz: 'Yangi' }));
    expect(await deleteMenuItem(t.db, unused.id)).toBe('deleted');

    const used = await createMenuItem(t.db, dish());
    const s = await t.db.session.create({
      data: { items: { create: { menuItemId: used.id, initialQuantity: 1 } } },
    });
    await expect(deleteMenuItem(t.db, used.id)).rejects.toMatchObject({ code: 'CONFLICT' }); // open shift
    await t.db.session.update({ where: { id: s.id }, data: { status: 'closed' } });
    expect(await deleteMenuItem(t.db, used.id)).toBe('deactivated');
    expect(await listMenuItems(t.db, { includeInactive: false })).toHaveLength(0);
    expect(await listMenuItems(t.db, { includeInactive: true })).toHaveLength(1);
  });
});

describe('image store', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'savdochef-img-'));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32),
  ]);
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('copies a real image under a random name, judging the format by its bytes', () => {
    const src = path.join(dir, 'photo.jpeg'); // wrong extension on purpose
    fs.writeFileSync(src, png);
    const name = importImage(src, path.join(dir, 'img'));
    expect(name).toMatch(/^[a-f0-9]{32}\.png$/);
    expect(fs.readFileSync(path.join(dir, 'img', name))).toEqual(png);
  });

  it('refuses non-images and oversized files', () => {
    const exe = path.join(dir, 'virus.png');
    fs.writeFileSync(exe, Buffer.from('MZ\x90\x00 this is not an image'));
    expect(() => importImage(exe, path.join(dir, 'img'))).toThrow(ImageImportError);
    expect(sniffImage(Buffer.from('RIFF....WEBPVP8 '))).toBe('webp');
  });

  it('resolves only names it could have issued, inside the image dir', () => {
    const ok = 'a'.repeat(32) + '.jpg';
    expect(resolveImagePath(dir, ok)).toBe(path.join(path.resolve(dir), ok));
    for (const bad of [
      '../secret.jpg',
      '..\\..\\win.ini',
      'a'.repeat(32) + '.exe',
      '/etc/passwd',
      'C:\\x.jpg',
      '',
    ]) {
      expect(resolveImagePath(dir, bad)).toBeNull();
    }
  });
});
