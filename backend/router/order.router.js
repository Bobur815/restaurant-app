import { Router } from "express";
import orderController from "../controller/Order.controller.js";

let orderRouter = Router()

orderRouter
    .get("/:table_number",orderController.getOrders)
    .get("/",orderController.getOneOrder)
    .post("/",orderController.addOrder)
    .put("/",orderController.changeOrder)
    .delete("/:table_number",orderController.deleteOrder)

export default orderRouter