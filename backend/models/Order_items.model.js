
import { Schema, model, Types } from "mongoose";

const orderItemSchema = new Schema({
  order_id: {
    type: Types.ObjectId, // References the Order collection
    ref: "Order",
    required: true
  },
  menu_id: {
    type: Types.ObjectId, // References the Menu collection
    ref: "Menu",
    required: true
  },
  quantity: {
    type: Number,
    default: 1,
    min: 1
  },
  price: {
    type: Number,
    required: true
  },
  portions: {
    type: Schema.Types.Decimal128,
    default: null
  }
});

export default model("OrderItem", orderItemSchema);
