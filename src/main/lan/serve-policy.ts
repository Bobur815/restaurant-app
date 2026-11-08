/**
 * Whether this till listens on the shop's network (feature F12; posgro serve-policy.ts).
 *
 * Only a main till with satellites switched on, and only while it has a paired satellite or an
 * open pairing code. Every till in the field is a main till after the upgrade; serving on that
 * alone would open a port in every shop the day the release lands.
 */
export function shouldServe(input: {
  role: 'main' | 'satellite';
  enabled: boolean;
  activeDevices: number;
  pairingOpen: boolean;
}): boolean {
  if (input.role !== 'main' || !input.enabled) return false;
  return input.activeDevices > 0 || input.pairingOpen;
}

/**
 * Callers allowed to talk to the server: the shop's own network (RFC 1918, link-local) and this
 * machine. Anything else is refused before it is read, whatever interface it came in on.
 */
export function isLocalAddress(address: string | undefined): boolean {
  if (!address) return false;
  const a = address.replace(/^::ffff:/, '');
  if (a === '::1') return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  if (!m) return /^fe80:/i.test(a);
  const [o1, o2] = [Number(m[1]), Number(m[2])];
  return (
    o1 === 10 ||
    o1 === 127 ||
    (o1 === 172 && o2 >= 16 && o2 <= 31) ||
    (o1 === 192 && o2 === 168) ||
    (o1 === 169 && o2 === 254)
  );
}

/**
 * `192.168.1.10`, `192.168.1.10:5180` or `http://...` -> `http://192.168.1.10:5180`, or null.
 * This machine (localhost, 127.x) only with `allowLoopback` (development, tests): an installed
 * satellite's main till is another computer.
 */
export function normaliseMainAddress(
  input: string,
  defaultPort: number,
  allowLoopback = false,
): string | null {
  const raw = input
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  const m = /^(\d{1,3}(?:\.\d{1,3}){3}|localhost)(?::(\d{1,5}))?$/.exec(raw);
  if (!m) return null;
  const host = m[1]!;
  const port = m[2] ? Number(m[2]) : defaultPort;
  if (port < 1024 || port > 65535) return null;
  const loopback = host === 'localhost' || host.startsWith('127.');
  if (loopback && !allowLoopback) return null;
  if (host !== 'localhost') {
    if (host.split('.').some((p) => Number(p) > 255)) return null;
    // The main till is on the shop's network, never a public address.
    if (!isLocalAddress(host)) return null;
  }
  return `http://${host}:${port}`;
}

/** Same major.minor: the IPC contract is the same on both sides. */
export function versionsCompatible(a: string, b: string): boolean {
  const mm = (v: string) => v.split('.').slice(0, 2).join('.');
  return mm(a) === mm(b);
}
