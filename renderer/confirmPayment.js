async function confirmPayment(orderData,payment_method){
    let status = payment_method === 'debt' ? 'pending' : 'paid'
    let paymentData = {
        payment_method,
        order_id: orderData.order_id,
        amount: orderData.total_amount,
        status
    }
    
    const response = await fetch("http://localhost:3000/api/payment",{
        method: "POST",
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(paymentData)
    })

    if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
    }

    const result = await response.json();
    alert("✅ To'lov amalga oshirildi!");

}

export default confirmPayment