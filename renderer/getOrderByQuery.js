export async function getOrderByQuery(query){
    try {
        const queryString = new URLSearchParams(query).toString()
        const response = await fetch(`http://localhost:3000/api/orders?${queryString}`);
        
        if (response.ok) {   // Agar status 200-299 orasida bo'lsa
            const orders = await response.json(); // .json() qilish kerak
            return orders;
            
        } else {
            console.log("Buyurtmalar topilmadi.");
        }
    } catch (error) {
        console.error("Xatolik:", error);
    }
}

