import { AppError } from '../domain/errors';
import { LOCK_LEASE_MS, TableLocks } from './table-locks';

const A = { terminal: 'local:1', userId: 1, userName: 'Aziz' };
const B = { terminal: 'lan:7', userId: 2, userName: 'Bobur' };
/** The same user on another till is someone else. */
const A_ELSEWHERE = { ...A, terminal: 'lan:8' };

function setup() {
  let now = 1_000_000;
  const changes: number[][] = [];
  const locks = new TableLocks({ now: () => now, onChange: (t) => changes.push(t) });
  return {
    locks,
    changes,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function refusal(fn: () => void): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('not refused');
}

describe('table locks (F13)', () => {
  it('one till at a time; the holder renews without announcing', () => {
    const { locks, changes } = setup();
    locks.take(5, A);
    expect(changes).toEqual([[5]]);
    locks.take(5, A);
    expect(changes).toEqual([[5]]);

    const e = refusal(() => locks.take(5, B));
    expect(e.code).toBe('CONFLICT');
    expect(e.details).toEqual({ reason: 'TABLE_IN_USE', tableNumber: 5, userName: 'Aziz' });
    expect(e.message).toBe('5-stol hozir Aziz tomonidan ochilgan');
    expect(refusal(() => locks.take(5, A_ELSEWHERE)).code).toBe('CONFLICT');

    expect(locks.list(B.terminal)).toEqual([{ tableNumber: 5, userName: 'Aziz', mine: false }]);
    expect(locks.list(A.terminal)).toEqual([{ tableNumber: 5, userName: 'Aziz', mine: true }]);
  });

  it('assertFree refuses other tills only; a free table is free for anyone', () => {
    const { locks } = setup();
    expect(() => locks.assertFree(3, B.terminal)).not.toThrow();
    locks.take(3, A);
    expect(() => locks.assertFree(3, A.terminal)).not.toThrow();
    expect(refusal(() => locks.assertFree(3, B.terminal)).details).toMatchObject({
      reason: 'TABLE_IN_USE',
    });
  });

  it('a lease runs out unless renewed; the sweep announces it', () => {
    const { locks, changes, advance } = setup();
    locks.take(1, A);
    advance(LOCK_LEASE_MS - 1);
    locks.take(1, A); // renewed
    advance(LOCK_LEASE_MS - 1);
    expect(() => locks.assertFree(1, B.terminal)).toThrow();
    advance(2);
    locks.sweep();
    expect(changes).toEqual([[1], [1]]);
    expect(locks.list(B.terminal)).toEqual([]);
    locks.take(1, B);
    expect(locks.list(A.terminal)).toEqual([{ tableNumber: 1, userName: 'Bobur', mine: false }]);
  });

  it('a till holds one table: taking another lets go of the first', () => {
    const { locks, changes } = setup();
    locks.take(1, A);
    locks.take(2, A);
    expect(changes).toEqual([[1], [1, 2]]);
    expect(locks.list(B.terminal).map((l) => l.tableNumber)).toEqual([2]);
    expect(() => locks.assertFree(1, B.terminal)).not.toThrow();
  });

  it('release only by the holder; releaseTerminal frees what a till holds', () => {
    const { locks, changes } = setup();
    locks.take(1, A);
    locks.take(3, B);
    changes.length = 0;
    locks.release(1, B.terminal);
    expect(changes).toEqual([]);
    locks.release(1, A.terminal);
    expect(changes).toEqual([[1]]);
    locks.take(2, A);
    changes.length = 0;
    locks.releaseTerminal(A.terminal);
    expect(changes).toEqual([[2]]);
    locks.releaseTerminal('local:99');
    expect(changes).toEqual([[2]]);
    expect(locks.list(A.terminal).map((l) => l.tableNumber)).toEqual([3]);
  });

  it('force takes a table over; the old holder is refused afterwards', () => {
    const { locks } = setup();
    locks.take(4, B);
    locks.take(4, A, true);
    expect(refusal(() => locks.assertFree(4, B.terminal)).message).toContain('Aziz');
  });

  it("a move drops the mover's lease and announces both tables", () => {
    const { locks, changes } = setup();
    locks.take(6, A);
    changes.length = 0;
    locks.move(6, 9, B.terminal); // not B's: kept
    expect(locks.list(A.terminal)).toEqual([{ tableNumber: 6, userName: 'Aziz', mine: true }]);
    locks.move(6, 9, A.terminal);
    expect(changes).toEqual([
      [6, 9],
      [6, 9],
    ]);
    expect(locks.list(A.terminal)).toEqual([]);
  });
});
