import { showAlert } from "../../utils/alert.js";
import { loadSessionsPage, refreshLists } from "./render.sessions.js";

export async function confirmSession({ items }) {
  try {
    const res = await fetch("http://localhost:3000/api/session/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });

    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload.message || "Smena yaratishda xatolik");
    }

    await showAlert("Smena muvaffaqiyatli yaratildi!");
    // optional: clear the table
    document.querySelectorAll("tr[id^='order-item-']").forEach(r => r.remove());
    await refreshLists()
    window.close()
    return payload;
  } catch (err) {
    console.error("confirmSession:", err);
    showAlert(err.message || "Server bilan bog‘lanishda xatolik yuz berdi");
    throw err;
  }
}
