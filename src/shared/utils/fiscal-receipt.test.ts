import {
  buildFiscalReceipt,
  FiscalReceiptError,
  toMilli,
  toTiyin,
  vatValue,
  type FiscalCodes,
  type FiscalOrderInput,
} from './fiscal-receipt';

const MXIK = '10202001001000000';
const codes: FiscalCodes = {
  vatMode: 'nonPayer',
  defaultMxik: MXIK,
  defaultPackage: '1500',
  serviceMxik: '10305001001000000',
  servicePackage: '',
  deliveryMxik: '10305002001000000',
  deliveryPackage: '2000',
};

function order(over: Partial<FiscalOrderInput> = {}): FiscalOrderInput {
  return {
    lines: [
      {
        menuItemId: 3,
        name: 'Osh',
        mxik: null,
        packageCode: null,
        totalPrice: '45000',
        stockQuantity: '1.5',
      },
    ],
    serviceFee: '0',
    deliveryFee: '0',
    payments: [{ method: 'cash', amount: '45000' }],
    labels: { serviceFee: 'Xizmat haqi', deliveryFee: 'Yetkazib berish' },
    ...over,
  };
}

describe('fiscal receipt (F18)', () => {
  it('converts so‘m to tiyin and quantities to thousandths exactly', () => {
    expect(toTiyin('25000')).toBe(2_500_000);
    expect(toTiyin('0.1')).toBe(10);
    expect(toTiyin('19999.99')).toBe(1_999_999);
    expect(toMilli('0.7')).toBe(700);
    expect(toMilli('0.5')).toBe(500);
    expect(toMilli('1.250')).toBe(1250);
    expect(toMilli('3')).toBe(3000);
  });

  it('VAT: -1 for a non-payer, ceil(amount x 12 / 112) for a 12 % payer', () => {
    expect(vatValue(2_500_000, 'nonPayer')).toBe(-1);
    // 2 500 000 x 12 / 112 = 267 857.14 -> 267 858 (rounded up so VCR reads 12 %, not 11 %)
    expect(vatValue(2_500_000, 'vat12')).toBe(267_858);
    expect(vatValue(1_120_000, 'vat12')).toBe(120_000);
  });

  it('one position per line: amount, quantity from the stock quantity, default MXIK and package', () => {
    const { positions, payments } = buildFiscalReceipt(order(), codes);
    expect(positions).toEqual([
      {
        name: 'Osh',
        barcode: '000003',
        icps: MXIK,
        package_code: '1500',
        amount: 4_500_000,
        quantity: 1500,
        vat_value: -1,
        discount: 0,
        owner_type: 'BuyingAndSelling',
      },
    ]);
    expect(payments).toEqual([{ type: 1, value: 4_500_000 }]);
  });

  it('a dish with its own MXIK uses its own package code only', () => {
    const { positions } = buildFiscalReceipt(
      order({
        lines: [
          {
            menuItemId: 1,
            name: 'Choy',
            mxik: '02101001001000000',
            packageCode: null,
            totalPrice: '3000',
            stockQuantity: '1',
          },
          {
            menuItemId: 2,
            name: 'Non',
            mxik: '02101002001000000',
            packageCode: '777',
            totalPrice: '2000',
            stockQuantity: '0.5',
          },
        ],
        payments: [{ method: 'cash', amount: '5000' }],
      }),
      codes,
    );
    expect(positions.map((p) => [p.icps, p.package_code, p.quantity])).toEqual([
      ['02101001001000000', undefined, 1000],
      ['02101002001000000', '777', 500],
    ]);
  });

  it('service and delivery fees are their own positions with their own MXIK', () => {
    const { positions, payments } = buildFiscalReceipt(
      order({
        serviceFee: '4500',
        deliveryFee: '10000',
        payments: [{ method: 'card', amount: '59500' }],
      }),
      { ...codes, vatMode: 'vat12' },
    );
    expect(positions.slice(1)).toEqual([
      expect.objectContaining({
        name: 'Xizmat haqi',
        icps: codes.serviceMxik,
        amount: 450_000,
        quantity: 1000,
        vat_value: 48_215,
      }),
      expect.objectContaining({
        name: 'Yetkazib berish',
        icps: codes.deliveryMxik,
        package_code: '2000',
        amount: 1_000_000,
      }),
    ]);
    expect(positions[1]).not.toHaveProperty('package_code');
    expect(payments).toEqual([{ type: 2, value: 5_950_000, card_type: 2 }]);
  });

  it('cash, Click and a repaid debt part are type 1; card is type 2; the sums match', () => {
    const { payments } = buildFiscalReceipt(
      order({
        lines: [
          {
            menuItemId: 1,
            name: 'Osh',
            mxik: null,
            packageCode: null,
            totalPrice: '100000',
            stockQuantity: '1',
          },
        ],
        payments: [
          { method: 'cash', amount: '30000' },
          { method: 'click', amount: '20000' },
          { method: 'debt', amount: '10000' },
          { method: 'card', amount: '40000' },
        ],
      }),
      codes,
    );
    expect(payments).toEqual([
      { type: 1, value: 6_000_000 },
      { type: 2, value: 4_000_000, card_type: 2 },
    ]);
  });

  it('refuses a dish without any MXIK, a fee without one, and unbalanced sums', () => {
    expect(() => buildFiscalReceipt(order(), { ...codes, defaultMxik: '' })).toThrow(
      'MXIK kodi kiritilmagan: Osh',
    );
    expect(() =>
      buildFiscalReceipt(
        order({ serviceFee: '100', payments: [{ method: 'cash', amount: '45100' }] }),
        {
          ...codes,
          serviceMxik: '',
        },
      ),
    ).toThrow('MXIK kodi kiritilmagan: Xizmat haqi');
    try {
      buildFiscalReceipt(order({ payments: [{ method: 'cash', amount: '44000' }] }), codes);
      throw new Error('no error');
    } catch (e) {
      expect(e).toBeInstanceOf(FiscalReceiptError);
      expect((e as FiscalReceiptError).problem).toEqual({
        reason: 'UNBALANCED',
        positions: 4_500_000,
        payments: 4_400_000,
      });
    }
  });

  it('skips zero lines and refuses a receipt with nothing on it', () => {
    expect(() =>
      buildFiscalReceipt(
        order({
          lines: [
            {
              menuItemId: 1,
              name: 'Bepul',
              mxik: null,
              packageCode: null,
              totalPrice: '0',
              stockQuantity: '1',
            },
          ],
          payments: [],
        }),
        codes,
      ),
    ).toThrow("Chekda pozitsiya yo'q");
  });
});
