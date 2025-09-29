import { Schema, model, Types } from "mongoose";

/**
 * Chiqimlar:
 * - type: xarajat turi (residual_writeoff – qoldiqni chiqimga yo‘zish)
 * - amount: pul ko‘rinishida (ixtiyoriy, agar hisob-kitob bo‘lsa)
 * - quantity: miqdor ko‘rinishida (masalan, 7 dona “Tabaka” chiqib ketdi)
 * - unitCost: 1 dona narxi (ixtiyoriy, umumiy amount = quantity * unitCost)
 */
const expenseSchema = new Schema(
  {
    session_id: {
      type: Types.ObjectId,
      ref: "Session",
      index: true,
    },
    menu_id: {
      type: Types.ObjectId,
      ref: "Menu",
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "residual_writeoff", // qoldiqni chiqimga yozish (eng ko‘p ishlatiladigan)
        "waste",             // isrof/eskirgan
        "breakage",          // shikast, singan
      ],
      required: true,
      index: true,
    },

    note: { type: String, default: "" }, // ixtiyoriy

    // Miqdoriy va pul ko‘rinishidagi maydonlar:
    quantity: { type: Number, min: 0, default: 0 }, // ixtiyoriy
    unitCost: { type: Number, min: 0, default: 0 }, // ixtiyoriy
    amount:   { type: Number, min: 0, default: 0 }, // ixtiyoriy, agar bevosita kiritilsa
  },
  { timestamps: true }
);

// Agar amount ko‘rsatilmagan bo‘lsa, unitCost * quantity dan hisoblab qo‘yish (ixtiyoriy)
expenseSchema.pre("save", function (next) {
  if ((this.amount ?? 0) === 0 && this.unitCost > 0 && this.quantity > 0) {
    this.amount = this.unitCost * this.quantity;
  }
  next();
});

export default model("Expense", expenseSchema);
