import {
  createUserInput,
  pinCode,
  setPinInput,
  menuItemInput,
  saveTableOrderInput,
  updateCategoryInput,
  updateMenuItemInput,
  updateProfileInput,
  updateReceiptSettingsInput,
  updateUserInput,
} from './schemas';

describe('update schemas leave unmentioned fields out (never reset them)', () => {
  // zod 4 applies .default() inside .partial(); these guard against that coming back.
  it.each([
    ['receipt settings', updateReceiptSettingsInput, { phone: '+998' }, { phone: '+998' }],
    ['category', updateCategoryInput, { id: 1 }, { id: 1 }],
    ['menu item', updateMenuItemInput, { id: 1, price: '100' }, { id: 1, price: '100' }],
    ['user', updateUserInput, { id: 1, isActive: false }, { id: 1, isActive: false }],
    ['profile', updateProfileInput, { username: 'ali' }, { username: 'ali' }],
  ] as const)('%s', (_name, schema, input, expected) => {
    expect(schema.parse(input)).toEqual(expected);
  });

  it('menu cost price: absent leaves it, null clears it', () => {
    expect(updateMenuItemInput.parse({ id: 1 })).toEqual({ id: 1 });
    expect(updateMenuItemInput.parse({ id: 1, costPrice: null })).toEqual({
      id: 1,
      costPrice: null,
    });
    expect(updateMenuItemInput.parse({ id: 1, costPrice: '1500' })).toEqual({
      id: 1,
      costPrice: '1500',
    });
  });

  it('an explicit empty optional text clears it', () => {
    expect(updateProfileInput.parse({ fullName: '' })).toEqual({ fullName: null });
  });
});

describe('create schemas apply defaults', () => {
  it('user defaults to STAFF, empty full name to null', () => {
    expect(createUserInput.parse({ username: 'kassir', password: 'secret1' })).toEqual({
      username: 'kassir',
      password: 'secret1',
      fullName: null,
      role: 'STAFF',
    });
  });

  it('menu item cannot be both portioned and sold by weight', () => {
    const base = { nameUz: 'Osh', price: '25000', categoryId: 1 };
    expect(
      menuItemInput.safeParse({ ...base, hasPortions: true, soldByWeight: true }).success,
    ).toBe(false);
    expect(menuItemInput.parse(base)).toMatchObject({
      hasPortions: false,
      soldByWeight: false,
      imageFile: null,
    });
  });
});

describe('order input', () => {
  it('accepts portions only from the allowed set, quantities as whole numbers', () => {
    const line = { menuItemId: 1, quantity: 2, portion: '0.7' };
    expect(saveTableOrderInput.safeParse({ tableNumber: 1, lines: [line] }).success).toBe(true);
    expect(
      saveTableOrderInput.safeParse({ tableNumber: 1, lines: [{ ...line, portion: '0.6' }] })
        .success,
    ).toBe(false);
    expect(
      saveTableOrderInput.safeParse({ tableNumber: 1, lines: [{ ...line, quantity: 1.5 }] })
        .success,
    ).toBe(false);
    expect(saveTableOrderInput.safeParse({ tableNumber: 1, lines: [] }).success).toBe(false);
  });
});

describe('PIN code', () => {
  it('is exactly 4 digits', () => {
    for (const ok of ['0000', '1234', '0707']) expect(pinCode.safeParse(ok).success).toBe(true);
    for (const bad of ['', '1', '123', '12345', '12a4', ' 1234', '١٢٣٤']) {
      expect(pinCode.safeParse(bad).success).toBe(false);
    }
  });

  it('setPin takes a 4-digit PIN or null (remove)', () => {
    expect(setPinInput.safeParse({ currentPassword: 'x', pin: null }).success).toBe(true);
    expect(setPinInput.safeParse({ currentPassword: 'x', pin: '12' }).success).toBe(false);
  });
});
