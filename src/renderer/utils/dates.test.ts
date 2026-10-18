import { addDays, daysBetween, presetRange } from './dates';

describe('report date ranges', () => {
  const now = new Date(2026, 9, 18, 15, 0); // 18 Oct 2026

  it('presets', () => {
    expect(presetRange('today', now)).toEqual({ start: '2026-10-18', end: '2026-10-18' });
    expect(presetRange('yesterday', now)).toEqual({ start: '2026-10-17', end: '2026-10-17' });
    expect(presetRange('week', now)).toEqual({ start: '2026-10-12', end: '2026-10-18' });
    expect(presetRange('month', now)).toEqual({ start: '2026-10-01', end: '2026-10-18' });
    expect(presetRange('lastMonth', now)).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(presetRange('lastMonth', new Date(2026, 0, 5))).toEqual({
      start: '2025-12-01',
      end: '2025-12-31',
    });
  });

  it('days between, across month and year ends, capped', () => {
    expect(daysBetween('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(daysBetween('2026-01-01', '2026-12-31')).toBeNull();
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
