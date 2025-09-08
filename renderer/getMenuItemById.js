import { showAlert } from "../utils/alert.js";

export default async function getMenuItemById(dishId) {
    if (!dishId) throw new Error('dishId kiritilmadi');

    try {
        const res = await fetch(`http://localhost:3000/api/menu/${dishId}`)

        const text = await res.text();
        const data = text ? JSON.parse(text) : null;

        if (!res.ok) {
            const msg = data?.message || `HTTP ${res.status}`;
            throw new Error(msg);
        }
        return data;
    } catch (error) {
        console.error('editDish error:', error);
        showAlert?.(`❌ Ma'lumotni olishda xato: ${error.message}`) || alert(`Xato: ${error.message}`);
    }
}