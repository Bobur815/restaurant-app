import authRouter from "./Auth.routes.js";
import categoryRouter from "./category.routes.js";
import expenseRouter from "./expenses.routes.js";
import menuRouter from "./menu.router.js";
import orderRouter from "./order.router.js";
import paymentRouter from "./payment.routes.js";
import RecieptSettingRouter from "./RecieptSetting.routes.js";
import residualRouter from "./residuals.routes.js";
import sessionRouter from "./session.routes.js";
import setupRouter from "./setup.js";
import usersRouter from "./Users.routes.js";


export default [
    { url: '/menu', funk: menuRouter },
    { url: '/orders', funk: orderRouter },
    { url: '/payment', funk: paymentRouter },
    { url: '/category', funk: categoryRouter },
    { url: '/session', funk: sessionRouter },
    { url: '/residual', funk: residualRouter },
    { url: '/expense', funk: expenseRouter },
    { url: '/setup', funk: setupRouter },
    { url: '/receipt-settings', funk: RecieptSettingRouter },
    { url: '/users', funk: usersRouter },
    { url: '/auth', funk: authRouter },
]