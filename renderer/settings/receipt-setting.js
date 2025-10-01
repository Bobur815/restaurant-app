export async function getReceiptSetting(){
    try {
        const response = await fetch(`http://localhost:3000/api/receipt-settings`)
        if (!response.ok) throw new Error("Failed to fetch receipt settings");
        return await response.json();
    } catch (error) {
        console.error(error.message)
    }
}