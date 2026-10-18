import { Router } from "express";
import sessionController from "../controller/Session.controller.js";

const sessionRouter = Router()

sessionRouter
    .get('/', sessionController.getAll)
    .get('/:sessionId', sessionController.getOne)
    .post('/create', sessionController.create)
    .put('/update/:sessionId', sessionController.update)
    .put('/close/:sessionId', sessionController.close)
    .delete('/delete/:sessionId', sessionController.deleteSession)

export default sessionRouter