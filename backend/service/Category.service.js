// backend/services/category.service.js
import prisma from "../database/prisma.js";
import CustomError from "../utils/CustomError.js";

class CategoryService {
  constructor() {}

  // GET /categories
  async getAll() {
    // If you need ordering: orderBy: { name: 'asc' }
    return prisma.category.findMany();
  }

  // GET /categories/:id
  async getOne(categoryId) {
    const id = Number(categoryId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new CustomError("❌ Noto‘g‘ri kategoriya ID", 400, "ValidationError");
    }
    return prisma.category.findUnique({ where: { id } });
  }

  // POST /categories
  async create(data) {
    const name = String(data?.name || "").trim();
    if (!name) {
      throw new CustomError("❌ Kategoriya nomi talab qilinadi", 400, "ValidationError");
    }

    // Option A: pre-check (explicit)
    const exists = await prisma.category.findUnique({ where: { name } });
    if (exists) {
      throw new CustomError("❌ Bu nomda kategoriya mavjud", 400, "ExistNameError");
    }

    // Option B: rely on unique and catch P2002
    try {
      return await prisma.category.create({ data: { name } });
    } catch (err) {
      if (err?.code === "P2002" && err?.meta?.target?.includes("name")) {
        throw new CustomError("❌ Bu nomda kategoriya mavjud", 400, "ExistNameError");
      }
      throw err;
    }
  }

  // PATCH/PUT /categories/:id
  async update(categoryId, data) {
    const id = Number(categoryId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new CustomError("❌ Noto‘g‘ri kategoriya ID", 400, "ValidationError");
    }

    // Ensure the category exists (to mirror your NotFound behavior)
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) {
      throw new CustomError("❌ Bu nomda kategoriya mavjud emas", 404, "NotFoundError");
    }

    // Only allow name change for now (mirror your model)
    const next = {};
    if (data?.name != null) {
      const name = String(data.name).trim();
      if (!name) {
        throw new CustomError("❌ Kategoriya nomi bo‘sh bo‘lishi mumkin emas", 400, "ValidationError");
      }
      next.name = name;
    }

    if (!Object.keys(next).length) {
      return existing; // nothing to update
    }

    try {
      return await prisma.category.update({
        where: { id },
        data: next,
      });
    } catch (err) {
      if (err?.code === "P2002" && err?.meta?.target?.includes("name")) {
        throw new CustomError("❌ Bu nomda kategoriya mavjud", 400, "ExistNameError");
      }
      throw err;
    }
  }

  // DELETE /categories/:id
  async delete(categoryId) {
    const id = Number(categoryId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new CustomError("❌ Noto‘g‘ri kategoriya ID", 400, "ValidationError");
    }

    // 1) Check linked menus
    const linkedCount = await prisma.menu.count({ where: { categoryId: id } });
    if (linkedCount > 0) {
      throw new CustomError(
        `❌ Ushbu kategoriya (${linkedCount} ta mahsulotga) bog‘langan, o‘chirib bo‘lmaydi`,
        400,
        "ConflictError"
      );
    }

    // 2) Delete if exists
    try {
      await prisma.category.delete({ where: { id } });
      return "✅ Kategoriya muvaffaqqiyatli o'chirildi!";
    } catch (err) {
      // If it doesn't exist, Prisma throws P2025 (record not found)
      if (err?.code === "P2025") {
        throw new CustomError("❌ Bu nomda kategoriya mavjud emas", 404, "NotFoundError");
      }
      throw err;
    }
  }
}

export default new CategoryService();
