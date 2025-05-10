import { Router } from "express";
import controller from "../controller/controller.js";

let router = Router()

router
    .get("/api/menu",controller.GET)
    .get("/api/menu/:dish_id",controller.GET_BY_ID)
    .get("/api/menu/category/:category",controller.GET_BY_CATEGORY)
    .post("/api/menu",controller.POST)
    .delete("/api/menu/:dish_id",controller.DELETE)
    .put("/api/menu/:dish_id", controller.PUT)

export default router
