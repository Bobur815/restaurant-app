import { showAlert } from "../utils/alert.js";

async function cancelOrder(table_number) {
    try {
        const response = await fetch(`http://localhost:3000/api/orders/${table_number}`, {
            method: 'DELETE'
        });

        const result = await response.json();
        if (response.ok) {
            showAlert("❌ Buyurtma bekor qilindi.");
        } else {
            showAlert("⚠️ Buyurtmani bekor qilib bo'lmadi: " + result.message);
        }
    } catch (error) {
        console.error("Server xatosi:", error);
    }
}

export default cancelOrder;