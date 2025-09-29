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
  constructor() { }

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

    categoryId: Joi.string()
      .required(),

    portions: Joi.boolean()
      .optional()
      .default(false),

    soldByWeight: Joi.boolean()
      .optional()
      .default(false)

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

    email: Joi.string()
      .email()
      .optional()
      .allow(null, ""),

    role: Joi.string()
      .valid("ADMIN", "STAFF")
      .optional()
  });

  static categoryValidator = Joi.object({
    name: Joi.string()
      .required()
  });

  static sessionValidator = Joi.object({
    items: Joi.array()
      .min(1)
      .items(
        Joi.object({
          menu_id: Joi.string()
            .pattern(/^[0-9a-fA-F]{24}$/)
            .required()
            .messages({
              "string.pattern.base": `"menu_id" must be a valid 24-hexadecimal ObjectId`,
            }),

          // ⬇️ integer emas – kasrga ruxsat, 3 xonagacha (0.001)
          initialQuantity: Joi.number()
            .precision(3)
            .min(0)
            .required(),

          // ⬇️ kasrga ruxsat, default 0
          soldQuantity: Joi.number()
            .precision(3)
            .min(0)
            .default(0)
            .optional()
        })
      )
      .required(),

    status: Joi.string().valid("open", "closed").optional(),
    closedAt: Joi.date().iso().optional()
  })
    .prefs({ convert: true, abortEarly: false });

  static receiptSettingsJoi = Joi.object({
    restaurantName: Joi.string().max(80).trim().required(),
    address: Joi.string().max(200).trim().required(),
    phone: Joi.string().max(50).trim().required(),
    extraPhones: Joi.array().items(Joi.string().max(30)).default([]),
    footerNote: Joi.string().max(300).allow("").default(""),
    locale: Joi.string().default("uz-UZ"),
    currency: Joi.string().default("UZS"),
    print: Joi.object({
      widthPx: Joi.number().min(200).max(800).default(420),
      useStarsSeparator: Joi.boolean().default(true),
      separatorChar: Joi.string().max(1).default("*"),
      separatorCount: Joi.number().min(10).max(120).default(38),
      showAddress: Joi.boolean().default(true),
      showPhone: Joi.boolean().default(true),
      showDateTime: Joi.boolean().default(true),
      showOrderNumber: Joi.boolean().default(true),
    }).default(),
    logoUrl: Joi.string().uri().allow(null).default(null),
    slug: Joi.string().default("default")
  });
}
