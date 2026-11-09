import { sum } from './decimal';
import { equalShares, guestChange, guestTenders, rebalance, type GuestShare } from './guest-split';
import { settleTenders } from './split-payment';

const g = (share: string, method: GuestShare['method'] = 'cash', fixed = false): GuestShare => ({
  share,
  method,
  fixed,
});

describe('equal shares (F14)', () => {
  it.each([
    ['25000', 3, ['8334', '8333', '8333']],
    ['100000', 7, ['14286', '14286', '14286', '14286', '14286', '14285', '14285']],
    ['50000', 2, ['25000', '25000']],
    ['0', 3, ['0', '0', '0']],
    ['10000.5', 3, ['3334.5', '3333', '3333']],
    ['2', 3, ['1', '1', '0']],
  ])('%s / %d', (total, n, expected) => {
    const shares = equalShares(total, n);
    expect(shares).toEqual(expected);
    expect(sum(shares).toFixed()).toBe(total);
  });

  it('refuses a bad count', () => {
    expect(() => equalShares('100', 0)).toThrow();
    expect(() => equalShares('100', 1.5)).toThrow();
  });
});

describe('rebalance', () => {
  it('keeps typed shares and divides the rest among the others', () => {
    const r = rebalance('30000', [g('10000'), g('20000', 'card', true), g('0')]);
    expect(r.problem).toBe('none');
    expect(r.guests.map((x) => x.share)).toEqual(['5000', '20000', '5000']);
    expect(r.guests[1]).toMatchObject({ fixed: true, method: 'card' });
  });

  it('over: the typed shares alone exceed the total', () => {
    const r = rebalance('30000', [g('31000', 'cash', true), g('0')]);
    expect(r.problem).toBe('over');
    expect(r.guests.map((x) => x.share)).toEqual(['31000', '0']);
  });

  it('every share typed: short when they do not reach the total, none when they do', () => {
    expect(rebalance('30000', [g('10000', 'cash', true), g('10000', 'card', true)]).problem).toBe(
      'short',
    );
    expect(rebalance('30000', [g('10000', 'cash', true), g('20000', 'card', true)]).problem).toBe(
      'none',
    );
  });
});

describe('what is stored', () => {
  it('adds the shares up per method; settleTenders accepts it with no change', () => {
    const guests = [g('8334', 'cash'), g('8333', 'card'), g('8333', 'cash')];
    const tenders = guestTenders(guests);
    expect(tenders).toEqual([
      { method: 'cash', amount: '16667' },
      { method: 'card', amount: '8333' },
    ]);
    expect(settleTenders('25000', tenders)).toMatchObject({
      problem: 'none',
      change: '0',
      applied: tenders,
    });
  });

  it('a 0 share (free check part) is left out; debt goes as its own line', () => {
    expect(guestTenders([g('0', 'click'), g('12000', 'debt'), g('3000', 'cash')])).toEqual([
      { method: 'cash', amount: '3000' },
      { method: 'debt', amount: '12000' },
    ]);
  });

  it("a guest's change is what they gave over their share", () => {
    expect(guestChange('8334', '10000')).toBe('1666');
    expect(guestChange('8334', '8000')).toBe('0');
    expect(guestChange('8334', null)).toBe('0');
  });
});
