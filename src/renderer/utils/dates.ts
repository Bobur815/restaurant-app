/** Local-date helpers for report ranges (YYYY-MM-DD, the till's clock). */

export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

export type RangePreset = 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth';

export function presetRange(
  preset: RangePreset,
  now: Date = new Date(),
): { start: string; end: string } {
  const today = isoDay(now);
  switch (preset) {
    case 'today':
      return { start: today, end: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { start: y, end: y };
    }
    case 'week':
      return { start: addDays(today, -6), end: today };
    case 'month':
      return { start: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), end: today };
    case 'lastMonth':
      return {
        start: isoDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        end: isoDay(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
  }
}

/** Every day from start to end inclusive; null when the range is longer than `max` days. */
export function daysBetween(start: string, end: string, max = 92): string[] | null {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    out.push(d);
    if (out.length > max) return null;
  }
  return out;
}
