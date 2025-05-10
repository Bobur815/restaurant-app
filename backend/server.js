import express from 'express';
import cors from 'cors';
import menuRouter from "./router/menu.router.js";
import orderRouter from "./router/order.router.js";
import "dotenv/config";

const PORT = process.env.PORT;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

app.use(menuRouter)
app.use(orderRouter)

app.listen(PORT, () => console.log(`✅ Backend running at http://localhost:${PORT}`));
