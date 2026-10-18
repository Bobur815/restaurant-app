import { Schema, model } from "mongoose";

const recieptSettingsSchema = new Schema({
  // Asosiy “header”
  restaurantName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 80
  },
  address: {
    // Bitta satr yoki ko‘p qatorli matn (textarea) uchun qulay
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  phone: {
    type: String,
    required: true,
    trim: true,
    maxlength: 30
  },

  // Ixtiyoriy: qo‘shimcha telefon(lar)
  extraPhones: {
    type: [String],
    default: []
  },

  // “Pastki” qism: javob/izoh (footer)
  footerNote: {
    type: String,
    default: "",
    maxlength: 300
  },

  // UI/print sozlamalari (ixtiyoriy, lekin foydali)
  locale: {
    type: String,
    default: "uz-UZ"
  },
  currency: {
    type: String,
    default: "UZS"
  },
  print: {
    widthPx: { type: Number, default: 420, min: 200, max: 800 }, // kvitansiya kengligi
    useStarsSeparator: { type: Boolean, default: true },
    separatorChar: { type: String, default: "*", maxlength: 1 }, // * yoki -
    separatorCount: { type: Number, default: 38, min: 10, max: 120 },
    showAddress: { type: Boolean, default: true },
    showPhone: { type: Boolean, default: true },
    showDateTime: { type: Boolean, default: true },
    showOrderNumber: { type: Boolean, default: true }
  },

  // Logo (ixtiyoriy): URL yoki base64
  logoUrl: {
    type: String,
    default: null
  },

  // Yagona hujjat bo‘lishi uchun belgi (singleton pattern)
  slug: {
    type: String,
    unique: true,
    default: "default" // har doim bitta bo'lsin
  }
}, {
  timestamps: true
});

// Kichik normalizatsiya
recieptSettingsSchema.pre("save", function(next) {
  if (this.restaurantName) this.restaurantName = this.restaurantName.trim();
  if (this.address) this.address = this.address.trim();
  if (this.phone) this.phone = this.phone.trim();
  if (this.footerNote) this.footerNote = this.footerNote.trim();
  next();
});

export default model("RecieptSettings", recieptSettingsSchema);
