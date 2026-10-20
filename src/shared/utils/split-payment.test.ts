import { settleTenders } from './split-payment';

describe('split payment', () => {
  it('one method for the whole check', () => {
    expect(settleTenders('100000', [{ method: 'card', amount: '100000' }])).toEqual({
      entered: '100000',
      remaining: '0',
      change: '0',
      applied: [{ method: 'card', amount: '100000' }],
      problem: 'none',
    });
  });

  it('cash over the total is change; the stored cash is net of it', () => {
    const s = settleTenders('100000', [
      { method: 'card', amount: '45000' },
      { method: 'cash', amount: '60000' },
    ]);
    expect(s).toMatchObject({ change: '5000', remaining: '0', problem: 'none' });
    expect(s.applied).toEqual([
      { method: 'cash', amount: '55000' },
      { method: 'card', amount: '45000' },
    ]);
  });

  it('card, Click and debt may never go over the total', () => {
    expect(
      settleTenders('100000', [
        { method: 'card', amount: '70000' },
        { method: 'debt', amount: '40000' },
      ]),
    ).toMatchObject({ problem: 'nonCashOver', applied: [] });
  });

  it('short, empty, zero lines and lines of one method added up, exactly', () => {
    expect(settleTenders('100000', [{ method: 'cash', amount: '99999.99' }])).toMatchObject({
      problem: 'short',
      remaining: '0.01',
    });
    expect(settleTenders('100000', [{ method: 'cash', amount: '0' }]).problem).toBe('empty');
    expect(settleTenders('100000', []).problem).toBe('empty');
    expect(
      settleTenders('100000.5', [
        { method: 'click', amount: '0.25' },
        { method: 'click', amount: '0.25' },
        { method: 'debt', amount: '100000' },
      ]),
    ).toMatchObject({
      problem: 'none',
      applied: [
        { method: 'click', amount: '0.5' },
        { method: 'debt', amount: '100000' },
      ],
    });
  });

  it('a free (0) check is paid by one 0 line', () => {
    expect(settleTenders('0', [{ method: 'card', amount: '0' }])).toMatchObject({
      problem: 'none',
      applied: [{ method: 'card', amount: '0' }],
    });
    expect(settleTenders('0', []).applied).toEqual([{ method: 'cash', amount: '0' }]);
  });

  it('cash exactly equal to the change is dropped, not stored as 0', () => {
    // 100 000 by card, plus 5 000 cash handed over by mistake: all of it goes back.
    const s = settleTenders('100000', [
      { method: 'card', amount: '100000' },
      { method: 'cash', amount: '5000' },
    ]);
    expect(s).toMatchObject({ change: '5000', problem: 'none' });
    expect(s.applied).toEqual([{ method: 'card', amount: '100000' }]);
  });
});
