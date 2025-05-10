import { Router } from "express";
import controller from "../controller/controller.js";

let router = Router()

router
    .get("/api/orders/:table_number",controller.GET_ORDERS_OF_TABLE)
    .post("/api/orders",controller.POST_ORDER)
    .put("/api/orders",controller.UPDATE_ORDER)
    .delete("/api/orders/:table_number",controller.CANCEL_ORDER)

export default router