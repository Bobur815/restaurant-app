import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    full_name: { type: String, required: false, trim: true, default: function () { return this.username } },
    password: { type: String, required: true },
    role: { type: String, enum: ["ADMIN", "STAFF"], default: "STAFF" },
    is_active: { type: Boolean, default: true },
  },
  { timestamps: true }
);


export default mongoose.model("User", userSchema);
