import { Router } from "express";
import RecieptSettingController from "../controller/RecieptSetting.controller.js";

const RecieptSettingRouter = Router();


RecieptSettingRouter
  .get("/", RecieptSettingController.getDefaultSettings)
  .get("",  RecieptSettingController.getDefaultSettings) 
  .post("/create", RecieptSettingController.createDefaultSettings)
  .put("/update", RecieptSettingController.updateSettings);

export default RecieptSettingRouter;