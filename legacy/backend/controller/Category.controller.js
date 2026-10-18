import categoryService from "../service/Category.service.js"
import CustomError from "../utils/CustomError.js"
import { Validators } from "../utils/Joi.validation.js"

class CategoryController {
    constructor(){}

    async getAll(req,res,next){
        try {
            const categories = await categoryService.getAll()
            res.status(200).json(categories)
        } catch (error) {
            next(error)
        }
    }

    async getOne(req,res,next){
        try {
            const category = await categoryService.getOne(req.params.categoryId)
            res.status(200).json(category)
        } catch (error) {
            next(error)
        }
    }

    async create(req,res, next){
        try {
            const {error, value} = Validators.categoryValidator.validate(req.body)
            if(error){
                throw new CustomError(error.details[0].message, 400, "ValidationError");
            }

            const newCategory = await categoryService.create(req.body)
            res.status(201).json({
                message: "✅ Yangi kategoriya qo'shildi!", 
                data: newCategory
            })
        } catch (error) {
            next(error)
        }
    }

    async update(req,res,next){
        try {
            const {error, value} = Validators.categoryValidator.validate(req.body)
            if(error){
                throw new CustomError(error.details[0].message, 400, "ValidationError");
            }

            const updated = await categoryService.update(req.params.categoryId, value)
            res.status(201).json({
                message: "✅ Kategoriya o'zgartirildi!", 
                data: updated
            })
        } catch (error) {
            next(error)
        }
    }

    async deleteItem(req,res,next){
        try {
            const result = await categoryService.delete(req.params.categoryId)
            res.status(200).json({
                message: result
            })
        } catch (error) {
            next(error)
        }
    }
}

let categoryController = new CategoryController()
export default categoryController