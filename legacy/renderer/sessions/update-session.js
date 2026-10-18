import { showAlert } from "../../utils/alert.js";
import { withActionAnimation } from "../../utils/loadAnimation.js";
import  getMenuItemById from "../getMenuItemById.js";


async function safeGetNameByMenuId(getMenuItemById, menuId) {
  try {
    const item = await getMenuItemById(menuId);
    return item?.name ?? null;
  } catch {
    return null;
  }
}

// details massivini formatlash
async function formatDetails(details, getMenuItemById) {
  if (!Array.isArray(details) || details.length === 0) return '';

  // Har bir elementni matnga aylantiramiz
  const promises = details.map(async (d) => {
    if (d && typeof d === 'object') {
      // Backend obyekt maydonlari: menuId, soldQuantity, proposedInitial, name (ixtiyoriy)
      const nameFromObj = d.name ?? null;
      const nameFromDb = !nameFromObj && d.menuId ? await safeGetNameByMenuId(getMenuItemById, d.menuId) : null;

      const name = nameFromObj || nameFromDb || d.menuId || "Noma'lum mahsulot";
      const sold = d.soldQuantity ?? '?';
      const proposed = d.proposedInitial ?? d.expected ?? '?';
      return `• ${name}: allaqachon sotilgan ${sold}, kiritilgan ${proposed}`;
    }
    // oddiy string bo‘lsa
    return `• ${String(d)}`;
  });

  const lines = await Promise.all(promises);
  return lines.join('\n');
}

export async function updateSession(sessionId, payload) {
  const putEdit = () => fetch(`http://127.0.0.1:3000/api/session/update/${sessionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  try {
    const resp = await withActionAnimation(
      putEdit,
      { type: 'edit', title: 'O‘zgarishlar saqlanmoqda…', icon: '✏️' }
    );

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      const err = new Error(data?.message || `HTTP ${resp.status}`);
      if (data) {
        err.code = data.code;
        err.details = data.details;
      }
      throw err;
    }

    await showAlert('O‘zgarishlar saqlandi ✅');
    window.close();
    return data;

  } catch (err) {

    let message = err.message || 'Saqlashda xatolik';
    const detailsText = await formatDetails(err.details, getMenuItemById); 
    if (detailsText) {
      message += ':\n' + detailsText;
    } else {
      message += '\n(Hech qanday qo‘shimcha tafsilot yo‘q)';
    }

    await showAlert(message, { duration: 8000 });
  }
}
