import { Router } from "express";
import ExpenseController from "../controller/Expense.controller.js";

const expenseRouter =  Router()

expenseRouter
    .get('/', ExpenseController.getAllExpenses)

export default expenseRouter