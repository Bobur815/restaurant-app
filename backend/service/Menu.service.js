// backend/services/menu.service.js
import prisma from "../database/prisma.js";
import CustomError from "../utils/CustomError.js";

function toIntId(maybe) {
  const n = Number(maybe);
  return Number.isInteger(n) && n > 0 ? n : null;
}

class MenuService {
  constructor() {}

  /**
   * GET all menu items with category name (populate-like).
   */
  async getMenu() {
    return prisma.menu.findMany({
      include: {
        category: { select: { id: true, name: true } },
      },
      orderBy: { id: "asc" },
    });
  }

  /**
   * GET one menu item by id with category name.
   * Returns null if id is invalid or not found (mirrors your ObjectId check).
   */
  async getById(menuId) {
    const id = toIntId(menuId);
    if (!id) return null;

    return prisma.menu.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Filtered list:
   * - category: 'all' | category id | category name
   * - search: substring match on name (case-insensitive)
   */
  async getFiltered(category = "all", search = "") {
    const where = {};

    // category filter
    if (category && category !== "all") {
      // Try as numeric id first
      const catId = toIntId(category);
      if (catId) {
        // Ensure category exists (behavior: if not found -> return [])
        const exists = await prisma.category.findUnique({ where: { id: catId } });
        if (!exists) return [];
        where.categoryId = catId;
      } else {
        // Treat as category name
        const cat = await prisma.category.findUnique({
          where: { name: String(category).trim() },
        });
        if (!cat) return [];
        where.categoryId = cat.id;
      }
    }

    // name search (regex -> contains, insensitive)
    if (search && typeof search === "string") {
      where.name = { contains: search.trim(), mode: "insensitive" };
    }

    return prisma.menu.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
      },
      orderBy: { id: "asc" },
    });
  }

  /**
   * Create menu item
   * - Enforces unique name
   * - Mirrors your default behaviors
   * Expected fields in data: { name, price, imageUrl?, description?, categoryId, portions?, soldByWeight? }
   */
  async createMenuItem(data) {
    const name = String(data?.name || "").trim();
    if (!name) {
      throw new CustomError("❌ Nomi talab qilinadi", 400, "ValidationError");
    }

    const categoryId = toIntId(data?.categoryId);
    if (!categoryId) {
      throw new CustomError("❌ Kategoriya ID noto‘g‘ri", 400, "ValidationError");
    }

    // Optional pre-check (not required, but keeps your previous semantics)
    const exists = await prisma.menu.findUnique({ where: { name } });
    if (exists) {
      throw new CustomError("❌ Bu nomda mahsulot mavjud", 400, "ExistNameError");
    }

    try {
      const created = await prisma.menu.create({
        data: {
          name,
          price: data?.price ?? 0, // Decimal field; Prisma will coerce numbers
          imageUrl: data?.imageUrl ?? null,
          description: data?.description ?? null,
          categoryId,
          portions: !!data?.portions,
          soldByWeight: !!data?.soldByWeight,
        },
        include: {
          category: { select: { id: true, name: true } },
        },
      });
      return created;
    } catch (err) {
      if (err?.code === "P2002" && err?.meta?.target?.includes("name")) {
        throw new CustomError("❌ Bu nomda mahsulot mavjud", 400, "ExistNameError");
      }
      // Foreign key error if categoryId invalid
      if (err?.code === "P2003") {
        throw new CustomError("❌ Kategoriya topilmadi", 400, "ValidationError");
      }
      throw err;
    }
  }

  /**
   * Delete by id
   */
  async deleteMenuItem(menuId) {
    const id = toIntId(menuId);
    if (!id) {
      throw new CustomError("❌ Mahsulot bazada topilmadi", 404, "NotFoundError");
    }

    try {
      await prisma.menu.delete({ where: { id } });
      return "✅ Mahsulot muvaffaqqiyatli o'chirildi!";
    } catch (err) {
      if (err?.code === "P2025") {
        // record not found
        throw new CustomError("❌ Mahsulot bazada topilmadi", 404, "NotFoundError");
      }
      throw err;
    }
  }

  /**
   * Update by id
   */
  async updateMenuItem(data, menuId) {
    const id = toIntId(menuId);
    if (!id) {
      throw new CustomError("❌ Mahsulot bazada topilmadi", 404, "NotFoundError");
    }

    // Ensure it exists (to mirror your NotFound error first)
    const existing = await prisma.menu.findUnique({ where: { id } });
    if (!existing) {
      throw new CustomError("❌ Mahsulot bazada topilmadi", 404, "NotFoundError");
    }

    const patch = {};
    if (data?.name != null) {
      const name = String(data.name).trim();
      if (!name) {
        throw new CustomError("❌ Nomi bo‘sh bo‘lishi mumkin emas", 400, "ValidationError");
      }
      patch.name = name;
    }
    
    if (data?.price != null) patch.price = data.price;
    if (data?.imageUrl !== undefined) patch.imageUrl = data.imageUrl ?? null;
    if (data?.description !== undefined) patch.description = data.description ?? null;
    if (data?.categoryId != null) {
      const cid = toIntId(data.categoryId);
      if (!cid) throw new CustomError("❌ Kategoriya ID noto‘g‘ri", 400, "ValidationError");
      patch.categoryId = cid;
    }
    if (data?.portions !== undefined) patch.portions = !!data.portions;
    if (data?.soldByWeight !== undefined) patch.soldByWeight = !!data.soldByWeight;

    try {
      const updated = await prisma.menu.update({
        where: { id },
        data: patch,
        include: {
          category: { select: { id: true, name: true } },
        },
      });
      return updated;
    } catch (err) {
      if (err?.code === "P2002" && err?.meta?.target?.includes("name")) {
        throw new CustomError("❌ Bu nomda mahsulot mavjud", 400, "ExistNameError");
      }
      if (err?.code === "P2003") {
        throw new CustomError("❌ Kategoriya topilmadi", 400, "ValidationError");
      }
      throw err;
    }
  }
}

export default new MenuService();
