
import menuService from "../service/Menu.service.js";
import CustomError from "../utils/CustomError.js";
import { Validators } from "../utils/Joi.validation.js";

class MenuController {
    constructor() { }

    async getAllItems(req, res, next) {
        try {
            const menuItems = await menuService.getMenu()
            res.status(200).json(menuItems)
        } catch (error) {
            next(error)
        }
    }

    async GET_BY_ID(req, res, next) {
        try {
            const item = await menuService.getById(req.params.dish_id)
            if (!item) {
                throw new CustomError("No menu items found", 404, "NotFoundError");
            }

            res.status(200).json(item)
        } catch (error) {
            next(error)
        }
    }

    async GET_FILTERED(req, res) {
        try {
            const { category = 'all', search = '' } = req.query;
            const items = await menuService.getFiltered(category, search);
            return res.json(items);
        } catch (err) {
            return res.status(500).json({ message: err.message });
        }
    }

    async createItem(req, res, next) {
        try {
            const { error, value } = Validators.menuValidator.validate(req.body, {
                convert: true,
                abortEarly: false,
            });
            console.log(value);
            
            if (error) {
                throw new CustomError(error.details[0].message, 400, "ValidationError");
            }

            const createdItem = await menuService.createMenuItem(value)
            res.status(201).json({
                message: "✅ Menu item qo'shildi!",
                data: createdItem
            })

        } catch (error) {
            next(error)
        }
    }

    async deleteItem(req, res, next) {
        try {
            const result = await menuService.deleteMenuItem(req.params.dish_id)
            res.status(200).json({
                message: result
            })
        } catch (error) {
            next(error)
        }
    }

    async updateItem(req, res, next) {
        try {
            const { error, value } = Validators.menuValidator.validate(req.body);
            if (error) {
                throw new CustomError(error.details[0].message, 400, "ValidationError");
            }
            const result = await menuService.updateMenuItem(req.body, req.params.dish_id)
            res.status(201).json({
                message: "✅ Mahsulot o'zgartirildi!",
                data: result
            })

        } catch (error) {
            next(error)
        }
    }
}

let menuController = new MenuController()
export default menuController
