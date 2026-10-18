import { Schema, model } from "mongoose";
import Counter from "./Counter.model.js"; // adjust the path if needed

const orderSchema = new Schema({
  order_number: {
    type: String,
    unique: true
  },  
  table_number: {
    type: Number,
    default: null
  },
  order_date: {
    type: Date,
    default: Date.now
  },
  total_amount: {
    type: Number,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'cancelled'],
    default: 'pending'
  },
  payment_method: {
    type: String,
    enum: ['cash', 'card', 'klik'],
    required: true
  },
  update_date: {
    type: Date,
    default: Date.now
  }
});

orderSchema.pre("save", async function (next) {
  if (this.isNew && !this.order_number) {
    const counter = await Counter.findByIdAndUpdate(
      { _id: "orders" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    this.order_number = `ORD-${String(counter.seq).padStart(6, "0")}`;
  }
  next();
});

export default model("Order", orderSchema);