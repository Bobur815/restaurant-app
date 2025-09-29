import { Router } from "express";
import usersController from "../controller/Users.controller.js";

const usersRouter = Router()


usersRouter
    .get("/me", usersController.getProfile)
    .post("/create", usersController.addUser)
    .put("/me", usersController.updateProfile)
    .put("/me/password", usersController.changePassword)

export default usersRouter;