import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

import express from 'express';
import cors from 'cors';
import { connectDB } from "./config/Database.js";
import routes from './router/index.routers.js';
import ErrorHandler from './middleware/ErrorHandler.js';

const PORT = process.env.PORT;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

routes.forEach(({ url, funk }) => {
    app.use(`/api${url}`, funk);
});

app.use(ErrorHandler)

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