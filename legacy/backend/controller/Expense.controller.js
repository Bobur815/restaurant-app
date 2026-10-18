import ExpensesService from "../service/Expenses.service.js";

class ExpenseController {
    constructor () {}

    async getAllExpenses(req,res,next){
        try {

            const expenses = await ExpensesService.getAllExpenses(req.query)
            res.json({ ok: true, data: expenses });
        } catch (error) {
            next(error)
        }
    }
}

export default new ExpenseController()