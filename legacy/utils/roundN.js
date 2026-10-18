export function roundN(x, n = 2) {
  const p = 10 ** n;
  return Math.round((Number(x) + Number.EPSILON) * p) / p;
}