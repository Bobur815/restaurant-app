import { Router } from "express";
import categoryController from "../controller/Category.controller.js";

const categoryRouter = Router()

categoryRouter
    .get('/', categoryController.getAll)
    .get('/:categoryId', categoryController.getOne)
    .post('/create', categoryController.create)
    .put('/update/:categoryId', categoryController.update)
    .delete('/delete/:categoryId', categoryController.deleteItem)

export default categoryRouter