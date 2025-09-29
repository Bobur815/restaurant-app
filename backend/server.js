import dotenv from "dotenv";

dotenv.config();

import express from 'express';
import cors from 'cors';
import { connectDB } from "./config/Database.js";
import routes from './router/index.routers.js';
import ErrorHandler from './middleware/ErrorHandler.js';
import Settings from "./models/Settings.js";
import UsersModel from "./models/Users.model.js";

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

app.get("/api/health", async (req, res) => {
    try {
        const flag = await Settings.findOne({ key: "setup_complete" }).lean();
        const adminExists = await UsersModel.exists({ role: "ADMIN" });
        res.json({
            ok: true,
            setupComplete: Boolean(flag?.value === true || adminExists),
        });
    } catch (e) {
        res.status(500).json({ ok: false });
    }
});

routes.forEach(({ url, funk }) => {
    app.use(`/api${url}`, funk);
});


app.use(ErrorHandler)

// ❗️Call AFTER routes are mounted (even after app.listen)


!(async () => {
    try {
        await connectDB();
        app.listen(PORT, () =>
            console.log(`🚀 Server running on http://localhost:${PORT}`)

    );

    } catch (err) {
        logger.error("❌ Failed to start server: " + err.message);
        process.exit(1);
    }
})();