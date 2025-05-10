import { getOrdersOfTable } from "./ordersOfTable.js";

async function submitOrder(order) {
    try {
        const method = await handleOrderMethod(order.table_number);
        const url = 'http://localhost:3000/api/orders';

        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(order)
        });

        const result = await response.json();

        if (method === "POST") {
            alert("✅ Buyurtma berildi!");
        } else {
            alert("✅ Buyurtma o'zgartirildi!");
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