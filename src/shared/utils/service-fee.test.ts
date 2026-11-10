import { serviceFeeFor, type ServiceFeeRule } from './service-fee';

const rule = (r: Partial<ServiceFeeRule>): ServiceFeeRule => ({
  type: 'off',
  percent: '0',
  perGuest: '0',
  ...r,
});

describe('service fee (F17)', () => {
  it('off: nothing', () => {
    expect(serviceFeeFor(rule({ percent: '10' }), '50000', 3).toFixed()).toBe('0');
  });

  it('percent of the dishes, whole so‘m half up', () => {
    const p = rule({ type: 'percent', percent: '10' });
    expect(serviceFeeFor(p, '50000', null).toFixed()).toBe('5000');
    expect(serviceFeeFor(p, '33335', null).toFixed()).toBe('3334'); // 3333.5 -> 3334
    expect(serviceFeeFor(rule({ type: 'percent', percent: '12.5' }), '3333', 2).toFixed()).toBe(
      '417',
    ); // 416.625
  });

  it('per guest; no guest count counts one guest', () => {
    const g = rule({ type: 'perGuest', perGuest: '5000' });
    expect(serviceFeeFor(g, '20000', 3).toFixed()).toBe('15000');
    expect(serviceFeeFor(g, '20000', null).toFixed()).toBe('5000');
    expect(serviceFeeFor(g, '20000', 0).toFixed()).toBe('5000');
  });

  it('an empty order carries no fee', () => {
    expect(serviceFeeFor(rule({ type: 'perGuest', perGuest: '5000' }), '0', 4).toFixed()).toBe('0');
  });
});
