import RecieptSettingsModel from "../models/RecieptSetting.model.js";
import { Validators } from "../utils/Joi.validation.js";

class RecieptSettingService {
  constructor() {}

  async getDefaultSettings() {
      
      let settings = await RecieptSettingsModel.findOne({ slug: "default" });
      if (!settings) {
          return null
        }
    return settings;
  }

  async createDefaultSettings(data) {
    const defaultSettings = {
      restaurantName: data.restaurantName || "Shoxona Milliy Taomlar",
      address: data.address || "Arabmozor, Toshloq, Farg‘ona",
      phone: data.phone || "+998 90 123 45 67",
      footerNote: data.footerNote || "Rahmat! Yana kutib qolamiz.",
      slug: "default"
    };
    const { error, value } = Validators.receiptSettingsJoi.validate(defaultSettings);
    if (error) throw new Error(`Validation error: ${error.message}`);

    const newSettings = new RecieptSettingsModel(value);
    await newSettings.save();
    return newSettings;
  }

  async updateSettings(newSettings) {
    const { error, value } = Validators.receiptSettingsJoi.validate(newSettings);
    if (error) throw new Error(`Validation error: ${error.message}`);
    
    const updatedSettings = await RecieptSettingsModel.findOneAndUpdate(
      { slug: "default" },
      newSettings,
      { new: true }
    );
    return updatedSettings;
  }
}

export default new RecieptSettingService();
