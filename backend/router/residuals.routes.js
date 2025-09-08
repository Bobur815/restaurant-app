import { Router } from "express";
import ResidualController from "../controller/Residual.controller.js";

const residualRouter = Router()

residualRouter  
    .get('/', ResidualController.getToCarryResidual)

export default residualRouter