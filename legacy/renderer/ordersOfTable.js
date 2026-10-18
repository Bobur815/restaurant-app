export async function getOrdersOfTable(tableNumber){
    try {
        const response = await fetch(`http://localhost:3000/api/orders/${tableNumber}`);
        
        if (response.ok) {   // Agar status 200-299 orasida bo'lsa
            const orders = await response.json(); // .json() qilish kerak
            
            return orders;
            
        }
    } catch (error) {
        console.error("Xatolik:", error);
    }
}

