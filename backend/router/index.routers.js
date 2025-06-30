import menuRouter from "./menu.router.js";
import orderRouter from "./order.router.js";
import paymentRouter from "./payment.routes.js";

export default [
    { url: '/menu', funk: menuRouter },
    { url: '/orders', funk: orderRouter},
    { url: '/payment', funk: paymentRouter}
]