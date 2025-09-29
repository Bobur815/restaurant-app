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
          price: "$menu.price",
          quantity: "$quantity",
          portions: "$portions",
          soldByWeight: "$soldByWeight",
          total_price: "$total_price",
          units: "$units",
          weight_kg: "$weight_kg"
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

  // CREATE
  async createOrder(data) {
    const { table_number, payment_method, items = [] } = data;

    if (!Array.isArray(items) || items.length === 0) {
      throw new CustomError("❌ Mahsulotlar bo'sh!", 400, "BadRequest");
    }

    // total_amountni serverda hisoblaymiz (ishonchlilik)
    const computedTotal = items.reduce((sum, it) => {
      const tp = Number(it.total_price ?? 0);
      return sum + (Number.isFinite(tp) ? tp : 0);
    }, 0);

    const order = await OrdersModel.create({
      table_number,
      total_amount: Math.round(computedTotal * 100) / 100,
      payment_method
    });

    const order_id = order._id;

    // OrderItem hujjatlari
    const orderItems = items.map(it => ({
      order_id,
      menu_id: it.menu_id,
      soldByWeight: !!it.soldByWeight,
      quantity: Number(it.quantity ?? 0),          // weight: effective kg; non-weight: dona
      portions: it.soldByWeight ? null : (it.portions ?? null),
      unit_price: Number(it.unit_price ?? it.price ?? 0),
      total_price: Number(it.total_price ?? 0),

      // ✅ Qo'shimcha maydonlar:
      units: it.soldByWeight ? Number(it.units ?? 1) : null,
      weight_kg: it.soldByWeight ? Number(it.weight_kg ?? 0) : null,
    }));


    await OrderItemModel.insertMany(orderItems);

    // Sessiondagi sotuvlarni yangilash
    for (const it of items) {
      const isWeight = !!it.soldByWeight;
      const qty = Number(it.quantity ?? 0);
      const portion = isWeight ? 1 : Number(it.portions ?? 1);
      const effectiveQty = isWeight ? qty : (qty * portion);
      if (effectiveQty !== 0) {
        await SessionService.recordSale(it.menu_id, effectiveQty);
      }
    }

    return "✅ Buyurtma yaratildi va itemlar qo'shildi!";
  }


  // UPDATE
  async updateOrder(data) {
    const { table_number, payment_method, items = [] } = data;

    const order = await OrdersModel.findOne({ table_number, status: 'pending' });
    if (!order) {
      throw new CustomError("❌ Buyurtma topilmadi!", 404, "NotFoundError");
    }

    // Yangi totalni hisoblab qo'yamiz
    const computedTotal = items.reduce((sum, it) => {
      const tp = Number(it.total_price ?? 0);
      return sum + (Number.isFinite(tp) ? tp : 0);
    }, 0);

    order.total_amount = Math.round(computedTotal * 100) / 100;
    order.payment_method = payment_method;
    await order.save();

    const order_id = order._id;

    // Eski itemlarni olib, rekord-sotuv delta hisoblaymiz
    const oldItems = await OrderItemModel.find({ order_id }).lean();

    // Eski itemlarni o‘chirib, yangilarini qo‘yamiz (soddaroq va xavfsiz)
    await OrderItemModel.deleteMany({ order_id });

    const newItems = items.map(it => ({
      order_id,
      menu_id: it.menu_id,
      soldByWeight: !!it.soldByWeight,
      quantity: Number(it.quantity ?? 0),
      portions: it.soldByWeight ? null : (it.portions ?? null),
      unit_price: Number(it.unit_price ?? it.price ?? 0),
      total_price: Number(it.total_price ?? 0),
      units: it.soldByWeight ? Number(it.units ?? 1) : null,
      weight_kg: it.soldByWeight ? Number(it.weight_kg ?? 0) : null,
      updatedAt: uzbekistanTime(), // timestamps ham qo'yadi, lekin siz xohlasangiz qoldiring
    }));

    await OrderItemModel.insertMany(newItems);

    // === Delta hisob: effectiveQty (zaxiradan yedirish birligi)
    // weight: qty(kg)
    // non-weight: qty * portions
    const eff = (doc) => {
      const isWeight = !!doc.soldByWeight;
      const q = Number(doc.quantity ?? 0);
      const p = isWeight ? 1 : Number(doc.portions ?? 1);
      return q * p;
    };

    const oldMap = new Map(
      oldItems.map(i => [String(i.menu_id), eff(i)])
    );
    const newMap = new Map(
      newItems.map(i => [String(i.menu_id), eff(i)])
    );

    const allIds = new Set([...oldMap.keys(), ...newMap.keys()]);
    for (const id of allIds) {
      const prevEff = oldMap.get(id) ?? 0;
      const nextEff = newMap.get(id) ?? 0;
      const delta = nextEff - prevEff; // + qo‘shildi, - kamaydi
      if (delta !== 0) {
        await SessionService.recordSale(id, delta);
      }
    }

    return order_id;
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
