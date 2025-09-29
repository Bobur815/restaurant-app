import UsersModel from "../models/Users.model.js";
import bcrypt from "bcrypt";
import mongoose from "mongoose";

class UsersService {
  constructor() { }

  async getUserById() {
    const admin = await UsersModel.findOne({ role: "ADMIN" });
    if (admin) return admin;
    const user = await UsersModel.findOne();
    return user;
  }

  async createUser(userData) {
    const payload = {
      username: String(userData.username || "").trim(),
      password: String(userData.password || "")
    };

    if (!payload.username || !payload.password) {
      throw new Error("Username va parol majburiy");
    }

    // username unikal bo‘lsin
    const exists = await UsersModel.findOne({ username: payload.username }).lean();
    if (exists) throw new Error("Ushbu username band");

    // const salt = await bcrypt.genSalt(10);
    // payload.password = await bcrypt.hash(payload.password, salt);
    return UsersModel.create(payload);
  }

  // Faqat username yangilash (parol bu yerda o‘zgarmaydi)
  async updateUsername(rawUsername) {
    const user = await UsersModel.find();
    
    if (!user) throw new Error("User not found");

    const username = String(rawUsername || "").trim();
    if (!username) throw new Error("Username bo‘sh bo‘lishi mumkin emas");

    // // Kolliziya tekshiruvi
    // const exists = await UsersModel.findOne({ username, _id: { $ne: id } }).lean();
    // if (exists) throw new Error("Ushbu username allaqachon ishlatilmoqda");

    user[0].username = rawUsername;
    await user[0].save();
    return user[0];
  }

  // Parolni alohida o‘zgartirish (joriy parolni tekshiradi)
  async changePassword(newPassword) {

    const user = await UsersModel.find();
    
    if (!user) throw new Error("User not found");

    if (!newPassword.trim()) {
      throw new Error("Joriy va yangi parolni to‘ldiring");
    }

    // const ok = await bcrypt.compare(currentPassword, user.password || "");
    // if (!ok) throw new Error("Joriy parol noto‘g‘ri");

    if (newPassword.length < 6) {
      throw new Error("Yangi parol uzunligi kamida 6 ta bo‘lishi kerak");
    }

    // const salt = await bcrypt.genSalt(10);
    user[0].password = newPassword;
    
    await user[0].save();
    return true;
  }
}

export default new UsersService();