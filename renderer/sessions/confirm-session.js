import { showAlert } from "../../utils/alert.js";
import { withActionAnimation } from "../../utils/loadAnimation.js";
import { refreshLists } from "./render.sessions.js";

export async function confirmSession({ items }) {
  const postOpen = () => fetch('http://127.0.0.1:3000/api/session/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items /* your data */ }),
  });
  
  try {
    const resp = await withActionAnimation(
      postOpen,
      { type: 'open', title: 'Smena ochilmoqda…', icon: '🟢' }
    );
    const payload = await resp.json();
    if (!resp.ok) throw new Error(payload?.message || 'Smena yaratishda xatolik');

    await showAlert('Smena muvaffaqiyatli yaratildi! ✅');
    // optional: clear the table
    document.querySelectorAll("tr[id^='order-item-']").forEach(r => r.remove());
    await refreshLists();
    window.close();
    return payload;
  } catch (err) {
    console.error("confirmSession:", err);
    showAlert(err.message || "Server bilan bog‘lanishda xatolik yuz berdi");
    throw err;
  }
}
