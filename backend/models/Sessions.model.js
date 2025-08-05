
import { Schema, model, Types } from "mongoose";

// Sub‐schema for each item in the session
const sessionItemSchema = new Schema({
  menu_id: {
    type: Types.ObjectId,
    ref: "Menu",
    required: true
  },
  initialQuantity: {
    type: Number,
    required: true,
    min: 0
  },
  soldQuantity: {
    type: Number,
    default: 0,
    min: 0
  }
}, {
  _id: false,
  toJSON:   { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual to compute remaining stock per item
sessionItemSchema.virtual("remainingQuantity").get(function() {
  return this.initialQuantity - this.soldQuantity;
});

const sessionSchema = new Schema({
  items: {
    type: [sessionItemSchema],
    validate: items => items.length > 0 // at least one product per session
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

// When you flip status → "closed", stamp closedAt
sessionSchema.pre("save", function(next) {
  if (this.isModified("status") && this.status === "closed" && !this.closedAt) {
    this.closedAt = new Date();
  }
  next();
});

export default model("Session", sessionSchema);
