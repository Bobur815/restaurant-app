import { Router } from "express";
import ResidualController from "../controller/Residual.controller.js";

const residualRouter = Router()

residualRouter  
    .get('/', ResidualController.getToCarryResidual)
    .post('/apply', ResidualController.applyResidualsToSession)

export default residualRouter