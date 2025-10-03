// backend/services/users.service.js
import prisma from "../database/prisma.js";

class UsersService {
  constructor() {}

  /**
   * Returns ADMIN user if exists, otherwise the first user (or null if none).
   * NOTE: returns password (as you requested).
   */
  async getUserById() {
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    if (admin) return admin;

    const anyUser = await prisma.user.findFirst();
    return anyUser || null;
  }

  /**
   * Create a user (no bcrypt, returns password).
   * - username required
   * - password required
   * - username must be unique
   * For your current use-case we mark it as ADMIN.
   */
  async createUser(userData) {
    const payload = {
      username: String(userData?.username || "").trim(),
      password: String(userData?.password || ""),
    };

    if (!payload.username || !payload.password) {
      throw new Error("Username va parol majburiy");
    }

    // Try create directly; rely on unique constraint and catch P2002
    try {
      const created = await prisma.user.create({
        data: {
          username: payload.username,
          full_name: payload.username,     // same default as your mongoose model
          password: payload.password,      // no hashing (your current requirement)
          role: "ADMIN",                   // you said "for now it is only admin"
          is_active: true,
        },
      });
      return created; // includes password (as you asked)
    } catch (err) {
      // Prisma unique constraint violation
      if (err?.code === "P2002" && err?.meta?.target?.includes("username")) {
        throw new Error("Ushbu username band");
      }
      throw err;
    }
  }

  /**
   * Update username of the single-user system.
   * We follow your previous logic: get one user (prefer ADMIN), update username.
   */
  async updateUsername(rawUsername) {
    const username = String(rawUsername || "").trim();
    if (!username) throw new Error("Username bo‘sh bo‘lishi mumkin emas");

    // Prefer ADMIN, else any user
    const target =
      (await prisma.user.findFirst({ where: { role: "ADMIN" } })) ||
      (await prisma.user.findFirst());

    if (!target) throw new Error("User not found");

    try {
      const updated = await prisma.user.update({
        where: { id: target.id },
        data: { username },
      });
      return updated; // includes password as-is
    } catch (err) {
      if (err?.code === "P2002" && err?.meta?.target?.includes("username")) {
        throw new Error("Ushbu username band");
      }
      throw err;
    }
  }

  /**
   * Change password (no bcrypt).
   * - newPassword required
   * - min length 6 (same rule you had)
   */
  async changePassword(newPassword) {
    const np = String(newPassword || "");
    if (!np.trim()) {
      throw new Error("Joriy va yangi parolni to‘ldiring");
    }
    if (np.length < 6) {
      throw new Error("Yangi parol uzunligi kamida 6 ta bo‘lishi kerak");
    }

    // Prefer ADMIN, else any user
    const target =
      (await prisma.user.findFirst({ where: { role: "ADMIN" } })) ||
      (await prisma.user.findFirst());

    if (!target) throw new Error("User not found");

    await prisma.user.update({
      where: { id: target.id },
      data: { password: np },
    });

    return true;
  }
}

export default new UsersService();
