import { showAlert } from "../utils/alert.js";
import { getOrdersOfTable } from "./ordersOfTable.js";

async function submitOrder(order) {
    try {
        document.querySelector('.pay-btn').disabled = true;
        document.querySelector('.cancel-order').disabled = true;
        
        const method = await handleOrderMethod(order.table_number);
        const url = 'http://localhost:3000/api/orders';
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(order)
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }

        const result = await response.json();

        if (method === "POST") {
            showAlert("✅ Buyurtma berildi!");
        } else {
            showAlert("✅ Buyurtma o'zgartirildi!");
        }

        document.querySelector('.pay-btn').disabled = false;
        document.querySelector('.cancel-order').disabled = false;
        return result;

    } catch (error) {
        console.error("Xato:", error);
        alert("❌ Buyurtmani jo'natishda xatolik yuz berdi.");
    }
}

async function handleOrderMethod(table_number) {
    const orders = await getOrdersOfTable(table_number);
    return orders.length ? "PUT" : "POST";
}

export default submitOrder