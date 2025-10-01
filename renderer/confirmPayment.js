import { showAlert } from "../utils/alert.js";
import { withActionAnimation } from "../utils/loadAnimation.js";

async function confirmPayment(orderData, payment_method) {
    let status = payment_method === 'debt' ? 'pending' : 'paid'
    let paymentData = {
        payment_method,
        order_id: orderData.order_id,
        amount: orderData.total_amount,
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