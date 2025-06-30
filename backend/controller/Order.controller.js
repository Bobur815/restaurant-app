import orderService from "../service/Order.service.js";

class OrderController{
    constructor(){}

    async getOrders(req,res,next){
        try {
            const orders = await orderService.getOrdersOfTable(req.params.table_number)
            res.status(200).json(orders)
        } catch (error) {
            next(error)
        }
    }

    async getOneOrder(req,res,next){
        try {
            const order = await orderService.getOrder(req.query)
            res.status(200).json(order)
        } catch (error) {
            next(error)
        }
    }

    async addOrder(req,res,next){
        try {
            const result = await orderService.createOrder(req.body)
            res.status(201).json({ 
                message: result 
            });
        } catch (error) {
            next(error)
        }
    }

    async changeOrder(req,res,next){
        try {
            const result = await orderService.updateOrder(req.body)
            res.status(202).json({
                message: "✅ Buyurtma muvaffaqqiyatli yangilandi!",
                insertedId: result
            });

        } catch (error) {
            next(error)
        }
    }

    async deleteOrder(req,res,next){
        try {
            const result = await orderService.cancelOrder(req.params.table_number)
            res.status(200).json({
                message: result
            });

        } catch (error) {
            next(error)
        }
    }
}

let orderController = new OrderController()
export default orderController