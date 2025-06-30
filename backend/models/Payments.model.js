// src/models/payment.model.js
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
    enum: ["cash", "card", "click", "debt"],
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

/**
 * @param {{ type: string, date?:string, start?:string, end?:string }} opts
 * @returns {Promise<Array<{ key:string, orders:number, total:number }>>}
 */
paymentSchema.statics.generateReport = async function({ type, date, start, end }) {
  // 1) Build a match filter on payment_date
  const match = {};
  if (type === 'custom') {
    if (!start || !end) throw new Error("Both start and end required for custom reports");
    match.payment_date = { $gte: new Date(start), $lte: new Date(end) };
  } else {
    const d = date ? new Date(date) : new Date();
    d.setHours(0,0,0,0);
    let next;
    switch(type) {
      case 'daily':
        next = new Date(d);
        next.setDate(next.getDate()+1);
        match.payment_date = { $gte: d, $lt: next };
        break;
      case 'weekly':
        const day = d.getDay() || 7;
        const monday = new Date(d);
        monday.setDate(d.getDate() - (day-1));
        monday.setHours(0,0,0,0);
        next = new Date(monday);
        next.setDate(monday.getDate()+7);
        match.payment_date = { $gte: monday, $lt: next };
        break;
      case 'monthly':
        const first = new Date(d.getFullYear(), d.getMonth(), 1);
        const firstNext = new Date(d.getFullYear(), d.getMonth()+1, 1);
        match.payment_date = { $gte: first, $lt: firstNext };
        break;
      case 'yearly':
        const yearStart = new Date(d.getFullYear(),0,1);
        const yearNext  = new Date(d.getFullYear()+1,0,1);
        match.payment_date = { $gte: yearStart, $lt: yearNext };
        break;
      default:
        throw new Error("Invalid report type");
    }
  }

  // 2) Pick a grouping format
  const fmt = {
    daily:   "%Y-%m-%d",
    weekly:  "%Y-%m-%d",
    monthly: "%Y-%m",
    yearly:  "%Y",
    custom:  "%Y-%m-%d"
  }[type];

  // 3) Run the aggregation
  const raw = await this.aggregate([
    { $match: match },
    { $group: {
        _id: { $dateToString: { format: fmt, date: "$payment_date" } },
        orders: { $sum: 1 },
        total:  { $sum: "$amount" }
    }},
    { $sort: { "_id": 1 } }
  ]);

  // 4) Normalize
  return raw.map(r => ({
    key:    r._id,
    orders: r.orders,
    total:  r.total
  }));
};

export default model("Payment", paymentSchema);
