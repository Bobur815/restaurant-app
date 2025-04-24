import { Router } from "express";
import controller from "../controller/controller.js";

let router = Router()

router
    .get("/api/menu",controller.GET)
    .post("/api/menu",controller.POST)
    .delete("/api/menu/:item_id",controller.DELETE)
    .put("/api/menu/:item_id", controller.PUT)

export default router
