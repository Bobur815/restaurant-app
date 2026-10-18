import UsersService from "../service/Users.service.js";

class UsersController {

  // GET /api/users/me
  async getProfile(req, res, next) {
    try {
        
      const user = await UsersService.getUserById();
      if (!user) return res.status(404).json({ message: "User not found" });
      res.status(200).json(user);
    } catch (error) {
      next(error);
    }
  }

  // POST /api/users
  async addUser(req, res, next) {
    try {
      await UsersService.createUser(req.body);
      res.status(201).json({ message: "User added successfully" });
    } catch (error) {
      next(error);
    }
  }

  // PUT /api/users/me     (faqat username)
  async updateProfile(req, res, next) {
    try {
      const { username } = req.body ?? {};
      const updatedUser = await UsersService.updateUsername(username);
      res.status(200).json({
        message: "✅ Profil muvaffaqiyatli yangilandi!",
        data: updatedUser
      });
    } catch (error) {
      next(error);
    }
  }

  // PUT /api/users/me/password  (parolni alohida o‘zgartirish)
  async changePassword(req, res, next) {
    try {
      const { newPassword } = req.body ?? {};
      await UsersService.changePassword(newPassword );
      res.status(200).json({ message: "🔒 Parol muvaffaqiyatli yangilandi!" });
    } catch (error) {
      next(error);
    }
  }
}

export default new UsersController();
