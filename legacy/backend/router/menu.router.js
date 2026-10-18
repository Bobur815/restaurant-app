import { Router } from "express";
import menuController from "../controller/Menu.controller.js";

let menuRouter = Router()

menuRouter
    .get("/",menuController.GET_FILTERED)
    .get("/all",menuController.getAllItems)
    .get("/:dish_id",menuController.GET_BY_ID)
    .post("/create",menuController.createItem)
    .delete("/delete/:dish_id",menuController.deleteItem)
    .put("/update/:dish_id", menuController.updateItem)

export default menuRouter
