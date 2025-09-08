import OrdersModel from "../models/Orders.model.js";
import PaymentsModel from "../models/Payments.model.js";
import CustomError from "../utils/CustomError.js";
import orderService from "./Order.service.js";
import sessionService from "./Session.service.js";

class PaymentService {
  constructor() { }

  async getChecksByQuery(filter) {

    let sortKey;
    if (filter.orderByType === 'table_number') {
      sortKey = 'order.table_number';
    } else if (filter.orderByType === 'payment_date') {
      sortKey = 'payment_date';
    } else if (filter.orderByType === 'amount') {
      sortKey = 'amount';
    } else {
      // agar noto‘g‘ri kelgan bo‘lsa, default bo‘yicha sana bo‘yicha ko'payish
      sortKey = 'payment_date';
    }
    const start = new Date(filter.startDate);
    const end = new Date(filter.endDate);
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
    const sortDir = filter.orderDirection === 'desc' ? -1 : 1;

    // Sort obyektini dinamik to‘ldiramiz
    const sortStage = { [sortKey]: sortDir };
    // Faqat stol bo‘yicha yoki summa bo‘yicha sort qilar ekansiz, ikkinchi darajali sana sortini ham qo‘shish mumkin
    if (sortKey !== 'payment_date') {
      sortStage.payment_date = -1;
    }

    pipeline.push({ $sort: sortStage });

    // 3e. project exactly the fields you need
    pipeline.push({
      $project: {
        order_number: '$order.order_number',
        table_number: '$order.table_number',
        amount: 1,
        payment_method: 1,
        status: 1,
        payment_date: 1
      }
    });

    // 4. run the aggregation
    const payments = await PaymentsModel.aggregate(pipeline);

    // 5. you already have flat fields, so just return them
    return payments.map(p => ({
      order_number: p.order_number,
      table_number: p.table_number,
      amount: p.amount,
      payment_method: p.payment_method,
      status: p.status,
      payment_date: p.payment_date
    }));
  }


  async getReports(query) {
    const { start, end, bytype = 'payment_date', direction = 'asc' } = query;
    if (!start || !end) throw new CustomError("start and end required", 400, "BadRequest");

    const startDate = new Date(start);
    const endDate = new Date(end);
    endDate.setHours(23, 59, 59, 999);

    const dateMatch = { payment_date: { $gte: startDate, $lte: endDate } };

    // --- whitelist & mapping ---
    const byWhitelist = new Set(['payment_date', 'amount']);
    const dir = direction === 'desc' ? -1 : 1;
    const by = byWhitelist.has(bytype) ? bytype : 'payment_date';

    // qaysi maydon bo‘yicha sort qilamiz?
    // 'amount' => totalSumOfEachDay; 'payment_date' => payment_date
    const sortField = by === 'amount' ? 'totalSumOfEachDay' : 'payment_date';


    // ---- sortSpec ni to‘g‘ri quramiz
    const sortSpec = {};
    sortSpec[sortField] = dir;
    // faqat amount bo‘lsa ikkilamchi tartib sifatida sanani qo‘shamiz
    if (sortField !== 'payment_date') {
      sortSpec['payment_date'] = 1;
    }
    // 1) Mahsulotlar bo‘yicha (o‘zizdagi kabi)
    const productsByDate = await PaymentsModel.aggregate([
      { $match: dateMatch },
      {
        $lookup: {
          from: 'orderitems',
          localField: 'order_id',
          foreignField: 'order_id',
          as: 'items'
        }
      },
      { $unwind: '$items' },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$payment_date' } },
            menuId: '$items.menu_id'
          },
          quantitySold: { $sum: '$items.quantity' }
        }
      },
      {
        $lookup: {
          from: 'menus',
          localField: '_id.menuId',
          foreignField: '_id',
          as: 'menu'
        }
      },
      { $unwind: '$menu' },
      {
        $project: {
          _id: 0,
          date: '$_id.date',
          productName: '$menu.name',
          quantitySold: 1
        }
      },
      {
        $group: {
          _id: '$date',
          products: { $push: { productName: '$productName', quantitySold: '$quantitySold' } }
        }
      },
      { $project: { _id: 0, date: '$_id', products: 1 } },
      { $sort: { date: 1 } } // bu qismini o‘zgartirmadik
    ]);

    // 2) Kunlik umumiy + breakdown
    const daily = await PaymentsModel.aggregate([
      { $match: dateMatch },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$payment_date' } },

          numberOfPayments: { $sum: 1 },
          totalSumOfEachDay: { $sum: '$amount' },

          cashSum: { $sum: { $cond: [{ $eq: ['$payment_method', 'cash'] }, '$amount', 0] } },
          cardSum: { $sum: { $cond: [{ $eq: ['$payment_method', 'card'] }, '$amount', 0] } },
          clickSum: { $sum: { $cond: [{ $eq: ['$payment_method', 'click'] }, '$amount', 0] } },
          creditSum: { $sum: { $cond: [{ $eq: ['$payment_method', 'debt'] }, '$amount', 0] } },
        }
      },
      { $addFields: { plasticSum: { $add: ['$cardSum', '$clickSum'] } } },
      {
        $project: {
          _id: 0,
          payment_date: '$_id',
          numberOfOrders: '$numberOfPayments',
          totalSumOfEachDay: 1,
          cashSum: 1,
          cardSum: 1,
          clickSum: 1,
          plasticSum: 1,
          creditSum: 1
        }
      },
      // --- dinamik sort ---
      { $sort: sortSpec} // ikkilamchi qat'iy tartib sifatida sana
    ]);

    return { daily, productsByDate };
  }



  async updatePayment(orderId, data) {
    // 1) Verify the order exists
    const order = await OrdersModel
      .findOne({ order_number: orderId })
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


  async createPayment(data) {
    // 1) create the payment record
    const result = await PaymentsModel.create(data);

    // 2) mark the order completed
    const order = await orderService.changeStatusofOrder(
      data.order_id,
      "completed"
    );

    // 3) re-fetch the fully-populated order
    const fullOrder = await orderService.getOrder({ _id: order.data._id });

    // 4) for each item, bump the session’s soldQuantity
    if (data.sessionId && Array.isArray(fullOrder.items)) {
      await Promise.all(
        fullOrder.items.map(item =>
          sessionService.recordSale(
            data.sessionId,
            // item.menu_id is now an object, so grab its _id
            item.menu_id._id || item.menu_id,
            item.quantity
          )
        )
      );
    }

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