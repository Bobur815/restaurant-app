export async function httpDelete(url) {
  const res = await fetch(url, { method: 'DELETE' });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}
