import categoryRouter from "./category.routes.js";
import menuRouter from "./menu.router.js";
import orderRouter from "./order.router.js";
import paymentRouter from "./payment.routes.js";
import sessionRouter from "./session.routes.js";

export default [
    { url: '/menu', funk: menuRouter },
    { url: '/orders', funk: orderRouter },
    { url: '/payment', funk: paymentRouter },
    { url: '/category', funk: categoryRouter },
    { url: '/session', funk: sessionRouter }
]