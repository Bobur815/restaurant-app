import mongoose from "mongoose";

export async function connectDB() {
    console.log("🔍 MONGO_URL:", process.env.MONGO_URL);

    const uri = process.env.MONGO_URL;
    if (!uri) {
        console.error("❌ MONGO_URL is undefined");
        process.exit(1);
    }

    await mongoose.connect(uri)
        .then(() => console.log("✅ MongoDB connected!"))
        .catch((error) => {
            console.error("MongoDB connection error:", error.message);
            process.exit(1);
        });
}
