import MenuModel from "../models/Menu.model.js";
import CustomError from "../utils/CustomError.js";

class MenuService{
    constructor(){}

    async getMenu(){
        const menuItems = await MenuModel.find()
        return menuItems
    }

    async getById(menu_id){
        const menuItem = await MenuModel.findById(menu_id)
        return menuItem
    }

    async getByCategory(category){
        const items = await MenuModel.find({category})
        return items
    }

    async createMenuItem(data){
        const existingItem = await MenuModel.findOne({name:data.name})
        if(existingItem){
            throw new CustomError("❌ Bu nomda mahsulot mavjud",400,"ExistNameError")
        }
        const createdItem = await MenuModel.create(data)
        return createdItem;
    }

    async deleteMenuItem(menu_id){

        const deletedItem = await MenuModel.findByIdAndDelete(menu_id)
        if(!deletedItem){
            throw new CustomError("❌ Mahsulot bazada topilmadi",404,"NotFoundError");
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