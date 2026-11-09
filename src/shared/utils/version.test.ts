import { compareVersions, versionsCompatible } from './version';

describe('versions (F15)', () => {
  it('compares major, minor and patch as numbers', () => {
    expect(compareVersions('0.9.0', '0.8.0')).toBeGreaterThan(0);
    expect(compareVersions('0.8.9', '0.9.0')).toBeLessThan(0);
    expect(compareVersions('0.10.0', '0.9.5')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareVersions('0.9.1', '0.9.1')).toBe(0);
    expect(compareVersions('0.9.1-beta.1', '0.9.1')).toBe(0);
  });

  it('compatible = same major.minor', () => {
    expect(versionsCompatible('0.9.0', '0.9.7')).toBe(true);
    expect(versionsCompatible('0.9.0', '0.10.0')).toBe(false);
    expect(versionsCompatible('1.9.0', '0.9.0')).toBe(false);
  });
});
