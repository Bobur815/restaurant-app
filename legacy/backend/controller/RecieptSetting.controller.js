import RecieptSettingService from "../service/RecieptSetting.service.js";

class RecieptSettingsController {
    constructor() { }

    async getDefaultSettings(req, res, next) {
        try {

            const settings = await RecieptSettingService.getDefaultSettings();

            if (!settings) {
                return res.status(404).json({ message: "Default settings not found" });
            }
            res.status(200).json(settings);
        } catch (error) {
            next(error);
        }
    }

    async createDefaultSettings(req, res, next) {
        try {
            const newSettings = await RecieptSettingService.createDefaultSettings(req.body);
            res.status(201).json(newSettings);
        } catch (error) {
            next(error);
        }
    }

    async updateSettings(req, res, next) {
        try {
            const updatedSettings = await RecieptSettingService.updateSettings(req.body);
            if (!updatedSettings) {
                return res.status(404).json({ message: "Default settings not found" });
            }
            res.status(200).json({
                message: "✅ Ma'lumotlar muvaffaqiyatli yangilandi!",
                data: updatedSettings
            });
        } catch (error) {
            next(error);
        }
    }
}

let recieptSettingsController = new RecieptSettingsController();
export default recieptSettingsController;