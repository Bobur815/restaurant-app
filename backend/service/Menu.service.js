import { Types } from "mongoose";
import MenuModel from "../models/Menu.model.js";
import CustomError from "../utils/CustomError.js";
import CategoryModel from "../models/Category.model.js";

class MenuService {
    constructor() { }

    async getMenu() {
        const menuItems = await MenuModel
            .find()
            .populate('categoryId', 'name')     // faqatgina name maydonini olib keladi
            .lean()
        return menuItems
    }

    async getById(menu_id) {
        if (!Types.ObjectId.isValid(menu_id)) return null
        const menuItem = await MenuModel
            .findById(menu_id)
            .populate('categoryId', 'name')
            .lean()
        return menuItem
    }

    async getFiltered(category = 'all', search = '') {
        const filter = {};

        // category filter
        if (category && category !== 'all') {
            let categoryDoc = Types.ObjectId.isValid(category)
                ? await CategoryModel.findById(category)
                : await CategoryModel.findOne({ name: category.trim() });

            if (!categoryDoc) return [];
            filter.categoryId = categoryDoc._id;
        }

        // name‐search filter
        if (search && typeof search === 'string') {
            filter.name = new RegExp(search.trim(), 'i');
        }

        return MenuModel
            .find(filter)
            .populate('categoryId', 'name')
            .lean();
    }

    async createMenuItem(data) {
        const existingItem = await MenuModel.findOne({ name: data.name })
        if (existingItem) {
            throw new CustomError("❌ Bu nomda mahsulot mavjud", 400, "ExistNameError")
        }
        const createdItem = await MenuModel.create(data)
        return createdItem;
    }

    async deleteMenuItem(menu_id) {

        const deletedItem = await MenuModel.findByIdAndDelete(menu_id)
        if (!deletedItem) {
            throw new CustomError("❌ Mahsulot bazada topilmadi", 404, "NotFoundError");
        }
        return "✅ Mahsulot muvaffaqqiyatli o'chirildi!";
    }

    async updateMenuItem(data, menu_id) {
        const existingItem = await MenuModel.findById(menu_id);
        if (!existingItem) {
            throw new CustomError("❌ Mahsulot bazada topilmadi", 404, "NotFoundError");
        }

        const updatedItem = await MenuModel.findByIdAndUpdate(menu_id, data, { new: true, runValidators: true });
        return updatedItem;
    }

}

let menuService = new MenuService()
export default menuService