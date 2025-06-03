import { Schema, model } from "mongoose";

const orderSchema = new Schema({
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

export default model("Order", orderSchema);