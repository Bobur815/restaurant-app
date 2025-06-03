import menuRouter from "./menu.router.js";
import orderRouter from "./order.router.js";

export default [
    { url: '/menu', funk: menuRouter },
    { url: '/orders', funk: orderRouter}
]