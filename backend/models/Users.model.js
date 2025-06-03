import { Schema, model } from "mongoose";

const userSchema = new Schema({
  full_name: {
    type: String,
    required: true,
    trim: true
  },
  username: {
    type:String,
    required: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ["admin", "kassir", "ofitsant","oshpaz"],
    default: "kassir"
  }
}, {
  timestamps: true
});

export default model("User", userSchema);
