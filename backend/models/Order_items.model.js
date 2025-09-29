import { Schema, model, Types } from "mongoose";

const orderItemSchema = new Schema({
  order_id: { type: Types.ObjectId, ref: "Order", required: true },
  menu_id: { type: Types.ObjectId, ref: "Menu", required: true },

  soldByWeight: { type: Boolean, required: true, default: false },

  // Effektiv birlik: non-weight → dona; weight → KG (units * weight_kg)
  quantity: {
    type: Number,
    required: true,
    min: 0,
    set: v => Math.round(Number(v) * 1000) / 1000,
    validate: {
      validator: function (v) {
        if (!this.soldByWeight) return Number.isInteger(v);
        return true;
      },
      message: 'Quantity must be an integer for non-weight items.'
    }
  },

  // ✅ Qo'shimcha maydonlar (weight uchun)
  units: {
    type: Number,
    default: null,
    min: 1,
    validate: {
      validator: function (v) {
        if (this.soldByWeight) return Number.isInteger(v ?? 0) && (v ?? 0) >= 1;
        return v == null; // non-weight bo'lsa units bo'lmasligi kerak
      },
      message: 'Units must be a positive integer when soldByWeight=true, else null.'
    }
  },
  weight_kg: {
    type: Number,
    default: null,
    min: 0,
    set: v => v == null ? null : Math.round(Number(v) * 1000) / 1000,
    validate: {
      validator: function (v) {
        if (this.soldByWeight) return Number(v) > 0;
        return v == null; // non-weight bo'lsa weight_kg bo'lmasligi kerak
      },
      message: 'weight_kg must be > 0 when soldByWeight=true, else null.'
    }
  },

  portions: {
    type: Number,
    default: null,
    enum: { values: [1, 0.7, 0.5], message: 'Portion must be one of 1, 0.7, 0.5' }
  },

  unit_price: {
    type: Number,
    required: true,
    min: 0,
    set: v => Math.round(Number(v) * 100) / 100
  },

  total_price: {
    type: Number,
    required: true,
    min: 0,
    set: v => Math.round(Number(v) * 100) / 100
  }
}, { timestamps: true });

// Server tomonda himoya & hosila maydonlari
orderItemSchema.pre('validate', function (next) {
  // soldByWeight => portions ishlatilmaydi
  if (this.soldByWeight) {
    this.portions = null;

    // ✅ quantity = units * weight_kg (inventar uchun)
    const u = Number(this.units ?? 0);
    const w = Number(this.weight_kg ?? 0);
    if (u > 0 && w > 0) {
      this.quantity = Math.round(u * w * 1000) / 1000;
    }
  } else {
    // non-weight => units/weight_kg yo'q
    this.units = null;
    this.weight_kg = null;
  }

  const qtyEff = Number(this.quantity || 0);
  const up = Number(this.unit_price || 0);
  const prt = this.soldByWeight ? 1 : Number(this.portions || 1);
  this.total_price = Math.round(qtyEff * up * prt * 100) / 100;

  next();
});


export default model("OrderItem", orderItemSchema);
