import mongoose from "mongoose";
import OrderItemModel from "../models/Order_items.model.js";
import OrdersModel from "../models/Orders.model.js";
import CustomError from "../utils/CustomError.js";
import SessionService from "./Session.service.js";

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
      return [];
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

    for (let item of items) {
      await SessionService.recordSale(item.menu_id, item.quantity)
    }

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

    const oldItems = await OrderItemModel.find({ order_id }).lean();
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

    const oldMap = new Map(oldItems.map(i => [i.menu_id.toString(), i.quantity]));
    const newMap = new Map(items.map(i => [i.menu_id.toString(), i.quantity]));

    const allIds = new Set([...oldMap.keys(), ...newMap.keys()]);

    for (const id of allIds) {
      const prevQ = oldMap.get(id) ?? 0;
      const nextQ = newMap.get(id) ?? 0;
      const delta = nextQ - prevQ; // + qo‘shish, - kamaytirish

      if (delta !== 0) {
        await SessionService.recordSale(id, delta /* manfiy bo‘lishi ham mumkin */);
      }
    }

    return order_id;
  }


  async cancelOrder(table_number) {
    // 0) Pending orderni olamiz
    const order = await OrdersModel.findOne({ table_number, status: "pending" });
    if (!order) return "❌ Bekor qilinadigan buyurtma topilmadi.";

    const order_id = order._id;
    const oldItems = await OrderItemModel.find({ order_id }).lean();

    // 1) Kompensatsiya ro‘yxati
    const applied = []; // { menu_id, delta } larni yig‘amiz

    try {
      // 2) Avval Session statistikani orqaga suramiz (delta = -qty)
      for (const it of oldItems) {
        const delta = -Number(it.quantity);
        await SessionService.recordSale(it.menu_id, delta); // transaksiyasiz
        applied.push({ menu_id: it.menu_id, delta }); // orqaga qaytarish uchun yozib qo‘yamiz
      }

      // 3) Endi itemlar va orderni o‘chiramiz
      await OrderItemModel.deleteMany({ order_id });
      const delRes = await OrdersModel.deleteOne({ _id: order_id, status: "pending" });
      if (delRes.deletedCount !== 1) {
        // race guard
        throw new CustomError("Buyurtma holati o‘zgargan bo‘lishi mumkin", 409, "ConflictException");
      }

      return "✅ Buyurtma muvaffaqiyatli bekor qilindi.";
    } catch (err) {
      // 4) Kompensatsiya: agar yuqorida xato bo‘lsa, o‘zgartirilgan statistikani qaytaramiz
      try {
        // applied ketma-ketligining TESKARI tartibida qaytaramiz (odatda xavfsizroq)
        for (let i = applied.length - 1; i >= 0; i--) {
          const { menu_id, delta } = applied[i];
          await SessionService.recordSale(menu_id, -delta); // -delta = asl miqdorni qaytarish
        }
      } catch (revertErr) {
        console.error("cancelOrder compensation error:", revertErr);
        // Bu yerda admin logga yozish muhim; userga umumiy xabar beramiz
      }

      console.error("cancelOrder (no-tx) error:", err);
      if (err instanceof CustomError) throw err;
      throw new CustomError("Bekor qilishda xatolik yuz berdi", 500, "CancelOrderError");
    }
  }


}

const orderService = new OrderService();
export default orderService;
