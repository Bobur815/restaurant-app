import { Schema, model } from "mongoose";

const permissionSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  permissionModel: {
    type: String,
    enum: ["menu", "order", "payment", "user", "report", "branch"],
    required: true
  },
  read: {
    type: Boolean,
    default: false
  },
  write: {
    type: Boolean,
    default: false
  },
  update: {
    type: Boolean,
    default: false
  },
  delete: {
    type: Boolean,
    default: false
  }
}, {
  strict: true
});

export default model("Permission", permissionSchema);
