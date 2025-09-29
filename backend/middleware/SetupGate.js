import Settings from "../models/Settings.js";
import UsersModel from "../models/Users.model.js";

export async function setupStatus(req, res, next) {
  try {
    // cached on request object to avoid double queries in a single request
    if (typeof req.isSetupComplete !== "undefined") return next();

    // Check flag in settings first
    const flag = await Settings.findOne({ key: "setup_complete" }).lean();
    if (flag?.value === true) {
      req.isSetupComplete = true;
      return next();
    }

    // If no flag, check if any ADMIN user exists
    const adminExists = await UsersModel.exists({ role: "ADMIN" });
    if (adminExists) {
      req.isSetupComplete = true;
      // persist it to settings for faster checks next time
      await Settings.updateOne(
        { key: "setup_complete" },
        { $set: { value: true } },
        { upsert: true }
      );
      return next();
    }

    req.isSetupComplete = false;
    return next();
  } catch (e) {
    return next(e);
  }
}
