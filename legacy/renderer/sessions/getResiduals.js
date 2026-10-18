// Query objektini URLSearchParams ga aylantirish
function toQS(params = {}) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    sp.set(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/**
 * getResiduals({ action, status, page, limit, q, start, end, ... })
 * Default serverda: action=CARRY_TO_NEXT, status=pending
 */
export async function getResiduals(params = {}) {
  const qs = toQS(params);
  const res = await fetch(`http://localhost:3000/api/residual${qs}`, {
    method: 'GET',
  });
  if (!res.ok) throw new Error(`getResiduals: ${res.status}`);
  return res.json();
}
