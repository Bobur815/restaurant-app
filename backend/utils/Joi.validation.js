// backend/utils/Joi.validation.js
import Joi from "joi";

// Coerce "123" -> 123, reject non-digits
const toInt = (value, helpers) => {
  if (typeof value === "string") {
    if (!/^\d+$/.test(value.trim())) return helpers.error("number.base");
    return parseInt(value, 10);
  }
  return value;
};

export const idInt = (required = false) => {
  const alt = Joi.alternatives()
    .try(
      Joi.number().integer(),                 // already a number
      Joi.string().trim().pattern(/^\d+$/)    // numeric string
    )
    .custom((v) => (typeof v === 'string' ? parseInt(v, 10) : v), 'string-to-int')
    .prefs({ convert: true });

  return required ? alt.required() : alt.optional();
};

// Limited portions for non-weight items
const portionEnum = Joi.number().valid(1, 0.7, 0.5).allow(null);

// Common payment method enum (Prisma-side)
const paymentMethodEnum = Joi.string().valid("cash", "card", "click", "debt");

// Order status enum
const orderStatusEnum = Joi.string().valid("pending", "completed", "cancelled");

// Payment status enum
const paymentStatusEnum = Joi.string().valid("paid", "pending", "refunded");

export class Validators {
  constructor() { }

  static menuValidator = Joi.object({
    name: Joi.string().max(20).trim().required(),
    price: Joi.number().min(0).precision(2).required(),
    imageUrl: Joi.string().allow(null, ""),               // allow filename or empty
    description: Joi.string().allow(null, ""),
    categoryId: idInt(true),                              // accepts "3" or 3
    portions: Joi.boolean().truthy("true").falsy("false", "0", "").default(false),
    soldByWeight: Joi.boolean().truthy("true").falsy("false", "0", "").default(false),
  }).prefs({ convert: true, abortEarly: false });


  // ORDER (Prisma fields)
  static orderValidator = Joi.object({
    tableNumber: Joi.number().integer().min(1).allow(null),
    totalAmount: Joi.number().min(0).allow(null),    // Decimal ok
    status: orderStatusEnum.optional(),
    paymentMethod: paymentMethodEnum.required(),
  });

  // ORDER ITEM (supports weight + portions logic)
  static orderItemValidator = Joi.object({
    orderId: idInt(true),
    menuId: idInt(true),

    soldByWeight: Joi.boolean().required().default(false),

    // Effective quantity (for weight items: kg; for non-weight: integer "dona")
    quantity: Joi.number()
      .min(0)
      .when("soldByWeight", {
        is: true,
        then: Joi.number().precision(3).min(0.001), // kg > 0 for weight items
        otherwise: Joi.number().integer().min(1),
      })
      .required(),

    // Extra for weight items
    units: Joi.number()
      .integer()
      .min(1)
      .allow(null)
      .when("soldByWeight", {
        is: true,
        then: Joi.number().integer().min(1).allow(null),
        otherwise: Joi.valid(null),
      }),

    weightKg: Joi.number()
      .precision(3)
      .min(0.001)
      .allow(null)
      .when("soldByWeight", {
        is: true,
        then: Joi.number().precision(3).min(0.001).allow(null),
        otherwise: Joi.valid(null),
      }),

    // Portions only for non-weight items
    portions: portionEnum.when("soldByWeight", {
      is: true,
      then: Joi.valid(null),
      otherwise: portionEnum,
    }),

    unitPrice: Joi.number().min(0).required(),       // Decimal ok
    totalPrice: Joi.number().min(0).required(),      // Decimal ok
  });

  // PAYMENT
  static paymentValidator = Joi.object({
    orderId: idInt(true),
    amount: Joi.number().min(0).required(),          // Decimal ok
    paymentMethod: paymentMethodEnum.required(),
    status: paymentStatusEnum.optional(),
    paymentDate: Joi.date().iso().optional(),
  });

  // USER (Prisma fields; you said you return password as-is for now)
  static userValidator = Joi.object({
    full_name: Joi.string().min(3).max(50).optional(), // optional to match your current flow
    username: Joi.string().min(3).max(32).required(),
    password: Joi.string().min(4).max(128).required(),
    email: Joi.string().email().allow(null, ""),
    role: Joi.string().valid("ADMIN", "STAFF").optional(),
    is_active: Joi.boolean().optional(),
  });

  // CATEGORY
  static categoryValidator = Joi.object({
    name: Joi.string().trim().required(),
  });

  // SESSION (numeric IDs, decimals to 3 places)
  static sessionValidator = Joi.object({
    items: Joi.array()
      .min(1)
      .items(
        Joi.object({
          menuId: idInt(true),
          initialQuantity: Joi.number().precision(3).min(0).required(),
          soldQuantity: Joi.number().precision(3).min(0).default(0).optional(),
        })
      )
      .required(),
    status: Joi.string().valid("open", "closed").optional(),
    closedAt: Joi.date().iso().optional(),
  }).prefs({ convert: true, abortEarly: false });

  // RECEIPT SETTINGS (same API shape you had; nested print object)
  static receiptSettingsJoi = Joi.object({
    restaurantName: Joi.string().max(80).trim().required(),
    address: Joi.string().max(200).trim().required(),
    phone: Joi.string().max(50).trim().required(),
    extraPhones: Joi.string().max(200).allow(null, "").default(""),
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
    slug: Joi.string().default("default"),
  });
}
