import { Schema, model, Types } from "mongoose";

/**
 * Qoldiq yozuvi:
 * - session_id: qaysi smenadan qoldi
 * - menu_id: qaysi mahsulot qoldi
 * - quantity: qoldiq miqdori (dona, porsiya, ml – biznesga qarab)
 * - action: egani tanlovi (keyingi kunga o‘tkazish yoki chiqimga yozish)
 * - status: bajarilmagan/pending yoki allaqachon qo‘llangan/applied
 * - appliedToSession: qaysi yangi smenaga qo‘shib yuborilgan (agar action=CARRY)
 * - expense_id: agar action=WRITE_OFF bo‘lsa, yaratilgan Expense hujjatiga link
 */
const residualSchema = new Schema(
  {
    session_id: {
      type: Types.ObjectId,
      ref: "Session",
      required: true,
      index: true,
    },
    menu_id: {
      type: Types.ObjectId,
      ref: "Menu",
      required: true,
      index: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [0, "Quantity cannot be negative"],
    },
    action: {
      type: String,
      enum: ["CARRY_TO_NEXT", "WRITE_OFF"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "applied"],
      default: "pending",
      index: true,
    },
    appliedToSession: {
      type: Types.ObjectId,
      ref: "Session",
      default: null,
    },
    expense_id: {
      type: Types.ObjectId,
      ref: "Expense",
      default: null,
    },
    note: { type: String, maxlength: 500 },
  },
  { timestamps: true }
);

// Bir smena + bir mahsulot uchun bitta residual:
// (agar har item bo‘yicha bitta qaror bo‘lsa)
residualSchema.index(
  { session_id: 1, menu_id: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } }
);

export default model("Residual", residualSchema);
