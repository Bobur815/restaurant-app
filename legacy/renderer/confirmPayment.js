import { showAlert } from "../utils/alert.js";
import { withActionAnimation } from "../utils/loadAnimation.js";

async function confirmPayment(orderData, paymentMethod) {
    let status = paymentMethod === 'debt' ? 'pending' : 'paid'
    let paymentData = {
        paymentMethod,
        orderId: orderData.orderId,
        amount: orderData.totalAmount,
        status
    }

    const postPayment = () => fetch("http://localhost:3000/api/payment", {
        method: "POST",
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(paymentData)
    });

    try {
        const response = await withActionAnimation(
            postPayment,
            { type: 'open', title: "To'lov amalga oshirilmoqda…", icon: '💰' }
        );
        const result = await response.json();
        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }
        await showAlert("✅ To'lov amalga oshirildi!");
        return result;
    } catch (error) {
        console.error(error);
    }


}

export default confirmPayment