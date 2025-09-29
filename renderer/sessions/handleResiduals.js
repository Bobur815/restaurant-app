import getMenuItemById from "../getMenuItemById.js";
import { selectProduct } from "./open-session.js";

// --- helper: safe response unwrap
export function unwrapResidualItems(residuals) {
    if (!residuals) return [];
    if (Array.isArray(residuals.items)) return residuals.items;
    if (residuals.data && Array.isArray(residuals.data.items)) return residuals.data.items;
    return [];
}

// --- helper: jadvalda bor bo'lsa jamlash, bo'lmasa selectProduct bilan qo'shish
export async function addOrMergeRowFromResidual({ menu_id, quantity }) {
    // menu ma'lumotini olib kelamiz (nom, rasm)
    const menuItem = await getMenuItemById(menu_id);
    const id = (menu_id?._id ?? menu_id); // ObjectId yoki string
    const rowId = `order-item-${id}`;
    let row = document.getElementById(rowId);

    if (!row) {
        // yangi qator qo'shish (sizda bor selectProduct ishlatamiz)
        const item = {
            _id: id,
            name: menuItem?.name ?? '—',
            image_url: menuItem?.image_url ?? '',
        };
        await selectProduct(item);
        row = document.getElementById(rowId);
    }

    if (row) {
        const qtyEl = row.querySelector('.quantity');
        const current = Number(qtyEl?.value || 0);
        qtyEl.value = current + Number(quantity || 0);
        // optional: highlight
        row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 800);
    }
}