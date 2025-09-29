import AuthService from "../service/Auth.service.js"

class AuthController {
    constructor() { }

    async login(req, res, next) {
        try {
            
            const user = await AuthService.login(req.body)
            
            if (!user) return res.status(404).json({ message: "User not found" });
            res.status(200).json(user);
        } catch (error) {
            next(error)
        }
    }
}

export default new AuthController();