import { Schema, model, Types } from "mongoose";

const paymentSchema = new Schema({
  order_id: {
    type: Types.ObjectId,
    ref: "Order",
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  payment_date: {
    type: Date,
    default: Date.now
  },
  payment_method: {
    type: String,
    enum: ["cash", "card", "klik", "nasiya"],
    required: true
  },
  status: {
    type: String,
    enum: ["paid", "pending", "refunded"],
    default: "paid"
  }
}, {
  timestamps: {
    createdAt: 'payment_date',
    updatedAt: false
  }
});

export default model("Payment", paymentSchema);
