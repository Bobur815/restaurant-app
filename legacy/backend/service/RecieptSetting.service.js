// backend/services/reciept-setting.service.js
import prisma from "../database/prisma.js";
import { Validators } from "../utils/Joi.validation.js";

/**
 * Map DB (flat columns) -> API shape (with nested print object).
 * Expects a Prisma RecieptSettings row.
 */
function toApiShape(db) {
  if (!db) return null;
  return {
    id: db.id,
    restaurantName: db.restaurantName,
    address: db.address,
    phone: db.phone,
    extraPhones: db.extraPhones || [],
    footerNote: db.footerNote || "",
    locale: db.locale,
    currency: db.currency,
    print: {
      widthPx: db.print_widthPx,
      useStarsSeparator: db.print_useStarsSep,
      separatorChar: db.print_separatorChar,
      separatorCount: db.print_separatorCount,
      showAddress: db.print_showAddress,
      showPhone: db.print_showPhone,
      showDateTime: db.print_showDateTime,
      showOrderNumber: db.print_showOrderNumber,
    },
    logoUrl: db.logoUrl,
    slug: db.slug, // "default"
    createdAt: db.createdAt,
    updatedAt: db.updatedAt,
  };
}

/**
 * Map API shape (with print object) -> DB flat columns for Prisma create/update.
 * Accepts partial objects; only maps provided fields.
 */
function toDbPayload(api) {
  const data = {};
  if (api.restaurantName != null) data.restaurantName = String(api.restaurantName);
  if (api.address != null) data.address = String(api.address);
  if (api.phone != null) data.phone = String(api.phone);
  if (api.extraPhones != null) data.extraPhones = api.extraPhones ?? "";
  if (api.footerNote != null) data.footerNote = String(api.footerNote);
  if (api.locale != null) data.locale = String(api.locale);
  if (api.currency != null) data.currency = String(api.currency);
  if (api.logoUrl !== undefined) data.logoUrl = api.logoUrl ?? null;
  if (api.slug != null) data.slug = String(api.slug);

  if (api.print && typeof api.print === "object") {
    const p = api.print;
    if (p.widthPx != null) data.print_widthPx = Number(p.widthPx);
    if (p.useStarsSeparator != null) data.print_useStarsSep = !!p.useStarsSeparator;
    if (p.separatorChar != null) data.print_separatorChar = String(p.separatorChar);
    if (p.separatorCount != null) data.print_separatorCount = Number(p.separatorCount);
    if (p.showAddress != null) data.print_showAddress = !!p.showAddress;
    if (p.showPhone != null) data.print_showPhone = !!p.showPhone;
    if (p.showDateTime != null) data.print_showDateTime = !!p.showDateTime;
    if (p.showOrderNumber != null) data.print_showOrderNumber = !!p.showOrderNumber;
  }

  return data;
}

class RecieptSettingService {
  constructor() {}

  /**
   * Returns the singleton "default" settings or null.
   */
  async getDefaultSettings() {
    const row = await prisma.recieptSettings.findUnique({
      where: { slug: "default" },
    });
    if (!row) return null;
    return toApiShape(row);
  }

  /**
   * Create default settings if missing.
   * Applies your Joi validation before write.
   */
  async createDefaultSettings(data = {}) {
    const defaults = {
      restaurantName: data.restaurantName || "Shoxona Milliy Taomlar",
      address: data.address || "Arabmozor, Toshloq, Farg‘ona",
      phone: data.phone || "+998 90 123 45 67",
      footerNote: data.footerNote || "Rahmat! Yana kutib qolamiz.",
      slug: "default",
      locale: data.locale || "uz-UZ",
      currency: data.currency || "UZS",
      print: {
        widthPx: data.print?.widthPx ?? 420,
        useStarsSeparator: data.print?.useStarsSeparator ?? true,
        separatorChar: data.print?.separatorChar ?? "*",
        separatorCount: data.print?.separatorCount ?? 38,
        showAddress: data.print?.showAddress ?? true,
        showPhone: data.print?.showPhone ?? true,
        showDateTime: data.print?.showDateTime ?? true,
        showOrderNumber: data.print?.showOrderNumber ?? true,
      },
      extraPhones: data.extraPhones ?? "",
      logoUrl: data.logoUrl ?? null,
    };

    // Joi validation (same as your code)
    const { error, value } = Validators.receiptSettingsJoi.validate(defaults);
    if (error) throw new Error(`Validation error: ${error.message}`);

    // If it already exists, just return it
    const exists = await prisma.recieptSettings.findUnique({
      where: { slug: "default" },
    });
    if (exists) return toApiShape(exists);

    // Create new row
    const created = await prisma.recieptSettings.create({
      data: toDbPayload(value),
    });
    return toApiShape(created);
  }

  /**
   * Update default settings.
   * Applies Joi, then updates by slug="default".
   */
  async updateSettings(newSettings = {}) {
    // Merge incoming with slug enforcement
    const withSlug = { ...newSettings, slug: "default" };

    const { error, value } = Validators.receiptSettingsJoi.validate(withSlug);
    if (error) throw new Error(`Validation error: ${error.message}`);

    const updated = await prisma.recieptSettings.upsert({
      where: { slug: "default" },
      update: toDbPayload(value),
      create: toDbPayload(value), // if missing, create it
    });

    return toApiShape(updated);
  }
}

export default new RecieptSettingService();
