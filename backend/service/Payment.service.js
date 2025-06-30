import OrdersModel from "../models/Orders.model.js";
import PaymentsModel from "../models/Payments.model.js";
import CustomError from "../utils/CustomError.js";
import orderService from "./Order.service.js";

class PaymentService{
    constructor(){}

    async getChecksByQuery(filter) {

        const start = new Date(filter.startDate);
        const end   = new Date(filter.endDate);
        end.setHours(23, 59, 59, 999);
      
        const tableNum = filter.table_number != null
          ? parseInt(filter.table_number, 10)
          : null;
      
        const pipeline = [];
      
        const rootMatch = {
          payment_date: { $gte: start, $lte: end }
        };
        
        if (filter.payment_method && filter.payment_method !== 'all') {
          rootMatch.payment_method = filter.payment_method;
        }
        if (filter.status && filter.status !== 'all') {
          rootMatch.status = filter.status;
        }
        pipeline.push({ $match: rootMatch });
        pipeline.push({
          $lookup: {
            from: 'orders',
            localField: 'order_id',
            foreignField: '_id',
            as: 'order'
          }
        });
        pipeline.push({ $unwind: '$order' });
      
        // 3c. if they asked to filter by table_number, match on the populated field
        if (tableNum != null) {
          pipeline.push({ $match: { 'order.table_number': tableNum } });
        }
      
        // 3d. sort however you like
        pipeline.push({ $sort: { 'order.table_number': 1, payment_date: -1 } });
      
        // 3e. project exactly the fields you need
        pipeline.push({
          $project: {
            order_number:   '$order.order_number',
            table_number:   '$order.table_number',
            amount:         1,
            payment_method: 1,
            status:         1,
            payment_date:   1
          }
        });
      
        // 4. run the aggregation
        const payments = await PaymentsModel.aggregate(pipeline);
      
        // 5. you already have flat fields, so just return them
        return payments.map(p => ({
          order_number:   p.order_number,
          table_number:   p.table_number,
          amount:         p.amount,
          payment_method: p.payment_method,
          status:         p.status,
          payment_date:   p.payment_date
        }));
      }      
      

    async getReports(query) {
        const { start, end } = query;
        if (!start || !end) {
          throw new CustomError("start and end required", 400, "BadRequest");
        }
      
        const startDate = new Date(start);
        const endDate   = new Date(end);
        endDate.setHours(23, 59, 59, 999);
      
        // common $match stage
        const dateMatch = { payment_date: { $gte: startDate, $lte: endDate } };
      
        // ——— 1. products: productName + quantitySold ———
        const products = await PaymentsModel.aggregate([
          { $match: dateMatch },
          { $lookup: {
              from: 'orderitems',
              localField: 'order_id',
              foreignField: 'order_id',
              as: 'items'
          }},
          { $unwind: '$items' },
          { $group: {
              _id: '$items.menu_id',
              quantitySold: { $sum: '$items.quantity' }
          }},
          { $lookup: {
              from: 'menus',
              localField: '_id',
              foreignField: '_id',
              as: 'menu'
          }},
          { $unwind: '$menu' },
          { $project: {
              _id:         0,
              productName: '$menu.name',
              quantitySold: 1
          }},
          { $sort: { quantitySold: -1 } }
        ]);
      
        // ——— 2. daily: payment_date + numberOfOrders + totalSumOfEachDay ———
        const daily = await PaymentsModel.aggregate([
          { $match: dateMatch },
          { $group: {
              _id: {
                $dateToString: { format: '%Y-%m-%d', date: '$payment_date' }
              },
              numberOfOrders:    { $sum: 1 },
              totalSumOfEachDay: { $sum: '$amount' }   // adjust field name if different
          }},
          { $project: {
              _id: 0,
              payment_date:      '$_id',
              numberOfOrders:    1,
              totalSumOfEachDay: 1
          }},
          { $sort: { payment_date: 1 } }
        ]);
        return { products, daily };
      }
      
    
    async updatePayment(orderId, data) {
        // 1) Verify the order exists
        const order = await OrdersModel
          .findOne({order_number: orderId})
          .select('_id');              // we only need the _id
        if (!order) {
          throw new CustomError(`Order ${orderId} not found`, 404, "NotFoundError");
        }
      
        // 2) Atomically update the payment for that order
        const updatedPayment = await PaymentsModel.findOneAndUpdate(
          { order_id: order._id },    // filter
          { $set: data },             // apply only the provided fields
          {
            new: true,                // return the updated document
            runValidators: true       // ensure your schema validators still run
          }
        );
      
        // 3) If there was no matching payment, error out
        if (!updatedPayment) {
          throw new CustomError(`Payment for order ${orderId} not found`, 404, "NotFoundError");
        }
      
        // 4) Return the updated payment (or you could return a message)
        return updatedPayment;
      }
      

    async createPayment(data){
        console.log(data);
        const result = await PaymentsModel.create(data)
        await orderService.changeStatusofOrder(data.order_id, "completed");
        return result;
    }

    async deletePayment(orderNumber) {
        const order = await OrdersModel.findOne({ order_number: orderNumber });
    
        if (!order) {
            throw new CustomError(`Buyurtma topilmadi: ${orderNumber}`, 404, "NotFoundError");
        }
    
        const result = await PaymentsModel.findOneAndDelete({ order_id: order._id });
    
        if (!result) {
            throw new CustomError("To‘lov topilmadi yoki allaqachon o‘chirilgan", 404, "NotFoundError");
        }
    
        return "✅ Check muvaffaqqiyatli o'chirildi";
    }
    
}

let paymentService = new PaymentService()
export default paymentService