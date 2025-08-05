import OrderItemModel from "../models/Order_items.model.js";
import OrdersModel from "../models/Orders.model.js";
import CustomError from "../utils/CustomError.js";

const uzbekistanTime = () => {
  const now = new Date();
  now.setHours(now.getHours() + 5); // Convert from UTC to UTC+5 manually
  return now;
};

class OrderService {

  async getOrdersOfTable(table_number) {

    const orders = await OrderItemModel.aggregate([
      {
        $lookup: {
          from: "orders",
          localField: "order_id",
          foreignField: "_id",
          as: "order"
        }
      },
      { $unwind: "$order" },
      {
        $match: {
          "order.table_number": +table_number,
          "order.status": "pending"
        }
      },
      {
        $lookup: {
          from: "menus",
          localField: "menu_id",
          foreignField: "_id",
          as: "menu"
        }
      },
      { $unwind: "$menu" },
      {
        $project: {
          _id: "$menu._id",
          name: "$menu.name",
          image_url: "$menu.image_url",
          price: "$price",
          quantity: "$quantity",
          portions: "$portions"
        }
      }
    ]);
    return orders;
  }

  async getOrder(query) {
    
    // 1) load the order itself
    const order = await OrdersModel
      .findOne(query)
      .lean()
      .exec();
    
    if (!order) {
      throw new CustomError("Order not found", 404, "NotFoundError");
    }

    // 2) load all order‐items for that order, populating each menu_id
    const items = await OrderItemModel
      .find({ order_id: order._id })          // match FK
      .populate("menu_id", "name image_url price")  // only these fields
      .lean()
      .exec();

    // 3) merge and return
    return {
      ...order,
      items
    };
  }

  async createOrder(data) {
    const { table_number, total_amount, payment_method, items } = data;

    const order = await OrdersModel.create({
      table_number,
      total_amount,
      payment_method
    })

    const order_id = order._id;

    const orderItems = items.map(item => ({
      order_id,
      menu_id: item.menu_id,
      quantity: item.quantity,
      price: item.price,
      portions: item.portions,
      createdAt: uzbekistanTime(),
      updatedAt: uzbekistanTime()
    }));

    await OrderItemModel.insertMany(orderItems);
    return "✅ Ordersga item qo'shildi!"
  }

  async changeStatusofOrder(order_id, status) {
    const order = await OrdersModel.findById(order_id)
    if (!order) {
      throw new CustomError("❌ Buyurtma topilmadi!", 404, "NotFoundError");
    }

    order.status = status;
    await order.save()
    return {
      data: order,
      message: "✅ Buyurtma muvaffaqqiyatli yangilandi!"
    }
  }

  async updateOrder(data) {
    const { table_number, total_amount, payment_method, items } = data;

    const order = await OrdersModel.findOne({ table_number, status: 'pending' });

    if (!order) {
      throw new CustomError("❌ Buyurtma topilmadi!", 404, "NotFoundError");
    }

    const order_id = order._id
    order.total_amount = total_amount;
    order.payment_method = payment_method;
    await order.save();

    await OrderItemModel.deleteMany({ order_id });

    const newItems = items.map(item => ({
      order_id,
      menu_id: item.menu_id,
      quantity: item.quantity,
      price: item.price,
      portions: item.portions,
      updatedAt: uzbekistanTime()
    }));

    await OrderItemModel.insertMany(newItems);

    return order_id;
  }

  async cancelOrder(table_number) {

    // Step 1: Pending holatdagi buyurtmani topish
    const order = await OrdersModel.findOne({ table_number, status: "pending" });

    if (!order) {
      return ("❌ Bekor qilinadigan buyurtma topilmadi.");
    }

    const order_id = order._id;

    // Step 2: order_items collection'dan tegishli itemlarni o‘chirish
    await OrderItemModel.deleteMany({ order_id });

    // Step 3: orders collection'dan buyurtmaning o‘zini o‘chirish
    await OrdersModel.deleteOne({ _id: order_id });

    return "✅ Buyurtma muvaffaqqiyatli bekor qilindi."
  }
}

const orderService = new OrderService();
export default orderService;
