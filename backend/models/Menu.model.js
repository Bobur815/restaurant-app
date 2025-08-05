import { Schema, Types, model } from "mongoose";

const menuSchema = new Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    maxlength: 20,
    trim: true
  },
  
  price: {
    type: Number,
    required: true
  },
  image_url: {
    type: String,
    default: null
  },
  description: {
    type: String,
    default: null
  },
  categoryId: {
    type: Types.ObjectId,
    ref:'Category',
    required: true
  },
  portions: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

export default model("Menu", menuSchema);
