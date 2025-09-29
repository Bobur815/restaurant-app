// router/setup.js
import { Router } from "express";
import bcrypt from "bcrypt";
import Settings from "../models/Settings.js";
import UsersModel from "../models/Users.model.js";
import RecieptSettingsModel from "../models/RecieptSetting.model.js";

const setupRouter = Router();

/** Frontendga holat qaytarish */
setupRouter.get("/status", async (req, res) => {
  try {
    const flag = await Settings.findOne({ key: "setup_complete" }).lean();
    const adminExists = await UsersModel.exists({ role: "ADMIN" });
    const receiptExists = await RecieptSettingsModel.exists({}); // bitta bo‘lsa ham yetarli

    // Setup tugagan deb 2 ta shart ham qanoatlantirilsa bo‘ladi:
    const setupComplete = Boolean((flag?.value === true) || (adminExists && receiptExists));

    return res.json({
      adminExists: Boolean(adminExists),
      receiptExists: Boolean(receiptExists),
      setupComplete
    });
  } catch (e) {
    return res.status(500).json({ message: "Ichki server xatosi" });
  }
});

/** Admin yaratish (faqat admin yo‘q bo‘lsa) */
setupRouter.post("/", async (req, res) => {
  try {
    const flag = await Settings.findOne({ key: "setup_complete" }).lean();
    const adminExists = await UsersModel.exists({ role: "ADMIN" });
    if (flag?.value === true || adminExists) {
      return res.status(403).json({ message: "Setup allaqachon tugallangan." });
    }

    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ message: "Iltimos, foydalanuvchi nomi va parolni kiriting" });
    }
    if (String(username).length < 3) {
      return res.status(400).json({ message: "Foydalanuvchi nomi kamida 3 ta belgidan iborat bo'lishi kerak" });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ message: "Parol kamida 6 ta belgidan iborat bo'lishi kerak" });
    }

    const rounds = Number(process.env.BCRYPT_ROUNDS || 10);
    const passwordHash = await bcrypt.hash(password, rounds);

    const admin = await UsersModel.create({
      username,
      password: passwordHash,
      role: "ADMIN",
    });

    // setup_complete ni alohida settings’da saqlashni davom ettirsangiz ham bo‘ladi.
    // Uni faqat ikkala qadam (admin + receipt) tugagach true qilishingiz mumkin.

    return res.status(201).json({
      message: "Admin muvaffaqiyatli yaratildi",
      admin: { id: admin._id, username: admin.username, role: admin.role },
    });
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ message: "Admin allaqachon mavjud" });
    }
    console.error(e);
    return res.status(500).json({ message: "Ichki server xatosi" });
  }
});

export default setupRouter;
