import { Router } from "express";
import menuController from "../controller/Menu.controller.js";

let menuRouter = Router()

menuRouter
    .get("/all",menuController.getAllItems)
    .get("/:dish_id",menuController.GET_BY_ID)
    .get("/category/:category",menuController.GET_BY_CATEGORY)
    .post("/create",menuController.createItem)
    .delete("/delete/:dish_id",menuController.deleteItem)
    .put("/update/:dish_id", menuController.updateItem)

export default menuRouter
