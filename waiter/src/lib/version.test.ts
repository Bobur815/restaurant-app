import pkg from '../../package.json';
import { versionCodeOf } from '../../app.config';

describe('app version', () => {
  it('orders versions for Android, from package.json', () => {
    expect(versionCodeOf('1.0.0')).toBe(10000);
    expect(versionCodeOf('1.2.3')).toBe(10203);
    expect(versionCodeOf('2.0.0')).toBeGreaterThan(versionCodeOf('1.99.99'));
    expect(() => versionCodeOf('1.100.0')).toThrow();
    expect(versionCodeOf(pkg.version)).toBeGreaterThan(0);
  });
});
