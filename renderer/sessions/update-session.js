export async function updateSession(sessionId, payload) {
  const res = await fetch(`http://127.0.0.1:3000/api/session/update/${sessionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(()=> ({}));
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return data;
}
