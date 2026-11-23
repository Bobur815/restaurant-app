import { dataOf, splitFrames } from './sse';

describe('event frames', () => {
  it('splits complete frames and keeps the rest for the next chunk', () => {
    expect(splitFrames(': connected\n\ndata: {"type":"menu-changed"}\n\ndata: {"ty')).toEqual({
      frames: [': connected', 'data: {"type":"menu-changed"}'],
      rest: 'data: {"ty',
    });
  });

  it('reads data lines only (pings are comments)', () => {
    expect(dataOf(': ping')).toEqual([]);
    expect(dataOf('data: {"a":1}')).toEqual(['{"a":1}']);
  });
});
