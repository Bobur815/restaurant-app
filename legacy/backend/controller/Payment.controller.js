import paymentService from "../service/Payment.service.js"

class PaymentController{
    constructor(){}

    async getCheck(req,res,next){
        try {
            const checks = await paymentService.getChecksByQuery(req.query)
            res.status(200).json(checks)
        } catch (error) {
            next(error)
        }
    }

    async getReportsOfPayment(req,res,next){
        try {
            const data = await paymentService.getReports(req.query)
            res.status(200).json(data)
        } catch (error) {
            next(error)
        }
    }
    
    async addPayment(req,res,next){
        try {
            const result = await paymentService.createPayment(req.body)
            res.status(201).json(result)
        } catch (error) {
            next(error)
        }
    }

    async updatePayment(req,res,next){
        try {
            const result = await paymentService.updatePayment(req.params.orderNumber,req.body)
            res.status(201).json({
                success: true,
                message: result
            })
        } catch (error) {
            next(error)
        }
    }

    async deletePaymentByOrderNumber(req,res,next){
        try {
            const { orderNumber } = req.params;
            const message = await paymentService.deletePayment(orderNumber);
            res.status(200).json({ 
                success: true, 
                message 
            });
        } catch (error) {
            next(error)
        }
    }
}

let paymentController = new PaymentController()
export default paymentController