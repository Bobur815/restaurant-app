import CategoryModel from "../models/Category.model.js"
import MenuModel from "../models/Menu.model.js"
import CustomError from "../utils/CustomError.js"

class CategoryService {
    constructor() { }

    async getAll() {
        const categories = await CategoryModel.find()
        return categories
    }

    async getOne(categoryId) {
        const category = await CategoryModel.findById(categoryId)
        return category
    }

    async create(data) {
        const existingCategory = await CategoryModel.findOne({ name: data.name })
        if (existingCategory) {
            throw new CustomError("❌ Bu nomda kategoriya mavjud", 400, "ExistNameError")
        }
        const createdCategory = await CategoryModel.create(data)
        return createdCategory;
    }

    async update(categoryId, data) {
        const existingCategory = await CategoryModel.findById(categoryId)
        if (!existingCategory) {
            throw new CustomError("❌ Bu nomda kategoriya mavjud emas", 404, "NotFoundError")
        }

        const updated = await CategoryModel.findByIdAndUpdate(categoryId, data, { new: true, runValidators: true })
        return updated
    }

    async delete(categoryId) {
        // 1. Shu kategoriya bilan bog‘langan mahsulotlar sonini hisoblaymiz
        const linkedCount = await MenuModel.countDocuments({ categoryId });
        if (linkedCount > 0) {
            // 2. Agar bitta bo'lsa ham mahsulot topsa — o‘chirishni taqiqlaymiz
            throw new CustomError(
                `❌ Ushbu kategoriya (${linkedCount} ta mahsulotga) bog‘langan, o‘chirib bo‘lmaydi`,
                400,
                'ConflictError'
            );
        }

        const existingCategory = await CategoryModel.findByIdAndDelete(categoryId)
        if (!existingCategory) {
            throw new CustomError("❌ Bu nomda kategoriya mavjud emas", 404, "NotFoundError")
        }

        return "✅ Kategoriya muvaffaqqiyatli o'chirildi!";
    }
}

let categoryService = new CategoryService()
export default categoryService