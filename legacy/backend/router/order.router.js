import { Router } from "express";
import orderController from "../controller/Order.controller.js";

let orderRouter = Router()

orderRouter
    .get("/:tableNumber",orderController.getOrders)
    .get("/",orderController.getOneOrder)
    .post("/",orderController.addOrder)
    .put("/",orderController.changeOrder)
    .delete("/:tableNumber",orderController.deleteOrder)

export default orderRouter