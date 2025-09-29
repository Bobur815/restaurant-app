import UsersModel from "../models/Users.model.js";
import bcrypt from 'bcrypt';

class AuthService {

    async login({username, password}) {
        const user = await UsersModel.findOne({ username });
        
        if (!user) {
            throw new Error('Username not found');
        }
        const isMatch = password == user.password;
        if (!isMatch) {
            throw new Error('Invalid password');
        }
        return user;
    }

}

export default new AuthService()