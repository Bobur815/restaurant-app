import prisma from '../database/prisma.js';

class AuthService {

    async login({ username, password }) {
        if (!username || !password) {
            throw new Error("Username and password are required");
        }

        const user = await prisma.user.findUnique({
            where: { username },
        });

        if (!user) {
            throw new Error("Username not found");
        }

        if (!user.is_active) {
            throw new Error("User is inactive");
        }

        const isMatch = (user.password === password);

        if (!isMatch) {
            throw new Error("Invalid password");
        }
        return user;
    }

}

export default new AuthService()