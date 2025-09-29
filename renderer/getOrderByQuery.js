export async function getOrderByQuery(query) {
    try {
        const qs = new URLSearchParams(query).toString();
        const response = await fetch(`http://localhost:3000/api/orders?${qs}`);

        if (!response.ok) {
            return response;
        }

        const data = await response.json();
        if (Array.isArray(data)) {
            return data[0] || null;
        }
        return data;
    } catch (error) {
        console.error("Xatolik:", error);
        return null;
    }
}
