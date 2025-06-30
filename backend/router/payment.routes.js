import { Router } from "express";
import paymentController from "../controller/Payment.controller.js";

let paymentRouter = Router()

paymentRouter
    .get("/", paymentController.getCheck)
    .get("/report", paymentController.getReportsOfPayment)
    .post("/", paymentController.addPayment)
    .put("/:orderNumber", paymentController.updatePayment)
    .delete("/:orderNumber", paymentController.deletePaymentByOrderNumber)

export default paymentRouter