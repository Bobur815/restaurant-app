// server.js
import dotenv from "dotenv";
import helmet from "helmet";
dotenv.config();

import express from "express";
import cors from "cors";
import routes from "./router/index.routers.js";
import ErrorHandler from "./middleware/ErrorHandler.js";
// If you had category seeding, migrate that util to Prisma and import it:
import { myInitFunction } from "./utils/category-add-init.js"; // (Prisma version)
import prisma from "./database/prisma.js";

// Config
const PORT = process.env.PORT || 3000;

const app = express();
app.use(helmet());
app.use(cors({ origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check: uses Prisma now
app.get("/api/health", async (req, res) => {
  try {
    const flag = await prisma.setting.findUnique({ where: { key: "setup_complete" } });
    const adminExists = !!(await prisma.user.findFirst({ where: { role: "ADMIN" } }));

    res.json({
      ok: true,
      setupComplete: Boolean(flag?.value === true || adminExists),
    });
  } catch (e) {
    console.error("Health error:", e);
    res.status(500).json({ ok: false });
  }
});

// Mount your routers
routes.forEach(({ url, funk }) => {
  app.use(`/api${url}`, funk);
});

// Error handler (keep last)
app.use(ErrorHandler);

// --- Boot the API ---
(async () => {
  try {
    // Optional: run migrations if you deploy in environments without CI step
    // await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON"); // SQLite FK safety
    // You can also run short-lived boot tasks here.
    if (typeof myInitFunction === "function") {
      const result = await myInitFunction();
      if (result) console.log(result);
    }

    app.listen(PORT, "127.0.0.1", () => {
      console.log(`API on http://127.0.0.1:${PORT}`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err?.message || err);
    process.exit(1);
  }
})();

// Graceful shutdown (optional)
process.on("SIGINT", async () => {
  try { await prisma.$disconnect(); } catch {}
  process.exit(0);
});
process.on("SIGTERM", async () => {
  try { await prisma.$disconnect(); } catch {}
  process.exit(0);
});
