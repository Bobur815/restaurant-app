// router/setup.js
import { Router } from "express";
import prisma from "../database/prisma.js";

const setupRouter = Router();


/**
 * GET /api/setup/status
 * - setupComplete = flag.value === true OR (adminExists && receiptExists)
 */
setupRouter.get("/status", async (req, res) => {
  try {
    const flag = await prisma.setting.findUnique({ where: { key: "setup_complete" } });
    const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
    const receiptCount = await prisma.recieptSettings.count();

    const adminExists = adminCount > 0;
    const receiptExists = receiptCount > 0;
    const setupComplete = Boolean(flag?.value === true || (adminExists && receiptExists));

    return res.json({ adminExists, receiptExists, setupComplete });
  } catch (e) {
    console.error("GET /setup/status error:", e);
    return res.status(500).json({ message: "Ichki server xatosi" });
  }
});

/**
 * POST /api/setup
 * Create initial ADMIN only if setup not finished
 */
setupRouter.post("/", async (req, res) => {
  try {
    const flag = await prisma.setting.findUnique({ where: { key: "setup_complete" } });
    const adminExists = (await prisma.user.count({ where: { role: "ADMIN" } })) > 0;

    if (flag?.value === true || adminExists) {
      return res.status(403).json({ message: "Setup allaqachon tugallangan." });
    }

    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ message: "Iltimos, foydalanuvchi nomi va parolni kiriting" });
    }
    if (String(username).trim().length < 3) {
      return res.status(400).json({ message: "Foydalanuvchi nomi kamida 3 ta belgidan iborat bo'lishi kerak" });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ message: "Parol kamida 6 ta belgidan iborat bo'lishi kerak" });
    }

    const admin = await prisma.user.create({
      data: {
        username: String(username).trim(),
        password: password,
        role: "ADMIN",             // matches enum UserRole
        is_active: true,
        full_name: String(username).trim(),
      },
      select: { id: true, username: true, role: true },
    });

    // Do NOT set setup_complete here — your flow says it becomes "complete"
    // after both admin and receipt settings exist.
    // You can set it in your receipt settings save endpoint.

    return res.status(201).json({
      message: "Admin muvaffaqiyatli yaratildi",
      admin,
    });
  } catch (e) {
    // Unique username
    if (e?.code === "P2002") {
      return res.status(409).json({ message: "Bu username allaqachon mavjud" });
    }
    console.error("POST /setup error:", e);
    return res.status(500).json({ message: "Ichki server xatosi" });
  }
});

export default setupRouter;
