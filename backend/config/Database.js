import mongoose from "mongoose";
import { exec } from "child_process";
import { myInitFunction } from "../utils/category-add-init.js";

export async function connectDB() {
    const uri = process.env.MONGO_URL;
    
    if (!uri) {
        console.error("❌ MONGO_URL is undefined");
        process.exit(1);
    }

    try {
        await mongoose.connect(uri);
        console.log("✅ MongoDB connected!");
        const result = await myInitFunction()
        if(result) console.log(result);
    } catch (error) {
        console.error("MongoDB connection error:", error.message);

        // Attempt to start MongoDB service on Windows
        if (process.platform === 'win32') {
            console.log("🛠 Attempting to start MongoDB service...");
            exec('net start MongoDB', (err, stdout, stderr) => {
                if (err) {
                    console.error("❌ Failed to start MongoDB service:", stderr);
                    process.exit(1);
                } else {
                    console.log("🔁 MongoDB service started. Retrying connection...");

                    // Retry the connection once after starting service
                    mongoose.connect(uri)
                        .then(() => console.log("✅ MongoDB connected on retry!"))
                        .catch(err => {
                            console.error("❌ Retry failed:", err.message);
                            process.exit(1);
                        });
                }
            });
        } else {
            process.exit(1);
        }
    }
}
