import Joi from "joi";
import mongoose from "mongoose";

const objectId = () =>
  Joi.string()
    .custom((value, helpers) => {
      if (!mongoose.Types.ObjectId.isValid(value)) {
        return helpers.error("any.invalid");
      }
      return value;
    }, "ObjectId Validation")
    .message("Invalid ObjectId");

export class Validators {
  constructor() {}

  static menuValidator = Joi.object({
    name: Joi.string()
      .max(20)
      .trim()
      .required(),

    price: Joi.number()
      .integer()
      .min(0)
      .required(),

    image_url: Joi.string()
      .optional()
      .allow(null, ""),

    description: Joi.string()
      .optional()
      .allow(null, ""),

    category: Joi.string()
      .max(20)
      .trim()
      .required(),

    portions: Joi.boolean()
      .optional()
  });

  static orderValidator = Joi.object({
    table_number: Joi.number()
      .integer()
      .min(1)
      .optional()
      .allow(null),

    total_amount: Joi.number()
      .integer()
      .min(0)
      .optional()
      .allow(null),

    status: Joi.string()
      .valid("pending", "completed", "cancelled")
      .optional(),

    payment_method: Joi.string()
      .valid("cash", "card", "klik")
      .required()
  });

  static orderItemValidator = Joi.object({
    order_id: objectId().required(),
    menu_id: objectId().required(),

    quantity: Joi.number()
      .integer()
      .min(1)
      .default(1),

    price: Joi.number()
      .min(0)
      .required(),

    portions: Joi.number()
      .precision(2)
      .optional()
      .allow(null)
  });

  static paymentValidator = Joi.object({
    order_id: objectId().required(),

    amount: Joi.number()
      .min(0)
      .required(),

    payment_method: Joi.string()
      .valid("cash", "card", "klik", "nasiya")
      .required(),

    status: Joi.string()
      .valid("paid", "pending", "refunded")
      .optional()
  });

  static userValidator = Joi.object({
    full_name: Joi.string()
      .min(3)
      .max(50)
      .required(),

    username: Joi.string()
        .min(3)
        .max(16)
        .required(),

    password: Joi.string()
      .min(4)
      .max(128)
      .required(),

    role: Joi.string()
      .valid("admin", "kassir", "ofitsant")
      .optional()
  });
}
