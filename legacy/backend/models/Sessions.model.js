import { Schema, model, Types } from "mongoose";

const round3 = (v) => Math.round(Number(v) * 1000) / 1000;

// Sub‐schema for each item in the session
const sessionItemSchema = new Schema({
  menu_id: {
    type: Types.ObjectId,
    ref: "Menu",
    required: true,
    index: true
  },
  initialQuantity: {
    type: Number,
    required: true,
    min: 0,
    set: round3
  },
  soldQuantity: {
    type: Number,
    default: 0,
    min: 0,
    set: round3
  }
}, {
  _id: false,
  toJSON:   { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual: remaining = initial - sold (3 xonagacha)
sessionItemSchema.virtual("remainingQuantity").get(function() {
  const initial = Number(this.initialQuantity || 0);
  const sold    = Number(this.soldQuantity || 0);
  return round3(initial - sold);
});

const sessionSchema = new Schema({
  items: {
    type: [sessionItemSchema],
    validate: {
      validator: (items) => Array.isArray(items) && items.length > 0,
      message: "Session kamida bitta mahsulotga ega bo‘lishi kerak"
    }
  },
  status: {
    type: String,
    enum: ["open", "closed"],
    default: "open"
  },
  closedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// (Ixtiyoriy, lekin tavsiya) — oversellni bloklaymiz:
sessionSchema.pre("validate", function(next) {
  for (const it of this.items ?? []) {
    if (it.soldQuantity < 0) it.soldQuantity = 0;
    if (it.initialQuantity < 0) it.initialQuantity = 0;
    // Agar oversellga ruxsat bermasangiz:
    if (it.soldQuantity > it.initialQuantity) {
      return next(new Error("Sold quantity initialQuantity dan oshib ketmasligi kerak"));
    }
  }
  next();
});

// Status 'closed' bo‘lsa, closedAt qo‘yamiz
sessionSchema.pre("save", function(next) {
  if (this.isModified("status") && this.status === "closed" && !this.closedAt) {
    this.closedAt = new Date();
  }
  next();
});

// Qo‘shimcha: xavfsiz sotuv yozish uchun yordamchi metod
sessionSchema.methods.recordSaleSafe = function(menuId, deltaQty) {
  const idStr = String(menuId);
  const item = this.items.find(i => String(i.menu_id) === idStr);
  if (!item) throw new Error("Menu item not found in session");

  const nextSold = round3(Number(item.soldQuantity || 0) + Number(deltaQty || 0));
  if (nextSold < 0) throw new Error("Sold quantity manfiy bo‘lishi mumkin emas");

  // Agar oversell man etilgan bo‘lsa:
  if (nextSold > round3(item.initialQuantity)) {
    throw new Error("Mahsulot yetarli emas (oversell)");
  }

  item.soldQuantity = nextSold;
  return item.remainingQuantity; // qolgan miqdorni qaytarish qulay
};

export default model("Session", sessionSchema);
