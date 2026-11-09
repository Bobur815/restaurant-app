/**
 * App versions (`0.9.0`). Two tills work together over the LAN only in the same major.minor
 * series (the IPC contract is the same; feature F12). Feature F15: which side is behind decides
 * whether a satellite can update itself to its main till.
 */

function parts(v: string): number[] {
  return v
    .split('-')[0]!
    .split('.')
    .slice(0, 3)
    .map((p) => (/^\d+$/.test(p) ? Number(p) : 0));
}

/** < 0 when a is older, 0 when equal, > 0 when newer (major, minor, patch; pre-release ignored). */
export function compareVersions(a: string, b: string): number {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Same major.minor: the IPC contract is the same on both sides. */
export function versionsCompatible(a: string, b: string): boolean {
  const mm = (v: string) => v.split('.').slice(0, 2).join('.');
  return mm(a) === mm(b);
}
