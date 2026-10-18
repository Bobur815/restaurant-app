import { initials } from './shell';

describe('sidebar avatar initials', () => {
  it('takes the first letters of the first two words, else the first two letters', () => {
    expect(initials('Bobur Ergashev')).toBe('BE');
    expect(initials('  aziz   kassir  extra ')).toBe('AK');
    expect(initials('owner')).toBe('OW');
    expect(initials('Ф')).toBe('Ф');
    expect(initials('')).toBe('?');
  });
});
