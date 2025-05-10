import pool from "../config/Database.js"

const GET = async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM menu');
    res.json(rows);
}
const GET_BY_ID = async (req, res) => {
    let {dish_id} = req.params;
    try {
        const [rows] = await pool.query('SELECT * FROM menu WHERE id = ?', [dish_id]);
        
        if (rows.length === 0) {
            return res.status(404).json({ error: "Mahsulot topilmadi!" });
        }

        res.status(200).json(rows[0]);  
    } catch (error) {
        res.status(500).json({ error: "Serverda xatolik yuz berdi!" });
    }
}

const GET_BY_CATEGORY = async (req, res) => {
    const {category} = req.params;

    try {
        const [rows] = await pool.query('SELECT * FROM menu WHERE category = ?', [category]);
        res.status(200).json(rows)
    } catch (error) {
        res.status(500).json({ error: "Serverda xatolik yuz berdi!" });
    }
}

// POST method - yangi mahsulot qo'shish
const POST = async (req, res) => {
    try {
        
        const { name, price, image_url, description,category,portions } = req.body;
        // Kiritilgan ma'lumotlarni tekshirish (oddiy validatsiya)
        if (!name || !price) {
            return res.status(400).json({ message: "Name va Price majburiy!" });
        }

        const query = `
            INSERT INTO menu (name, price, image_url, description,category,portions)
            VALUES (?, ?, ?, ?,?,?)
        `;

        const [result] = await pool.query(query, [name, price, image_url, description,category,portions]);

        res.status(201).json({ 
            message: " ✅ Menu item qo'shildi!", 
            insertedId: result.insertId 
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Server xatosi" });
    }
}


const DELETE = async (req, res) => {
    let { dish_id } = req.params;

    try {
        const result = await pool.query(`DELETE FROM menu WHERE id = ?`, [dish_id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Mahsulot topilmadi!" });
        }

        res.status(200).json({ message: "✅ Mahsulot muvaffaqqiyatli o'chirildi!" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Serverda xatolik!" });
    }
}


const PUT = async (req, res) => {
    const { dish_id } = req.params;
    const { name, price, image_url, description, category } = req.body;

    try {
        await pool.query(`
            UPDATE menu 
            SET name = ?, price = ?, image_url = ?, description = ?, category = ?
            WHERE id = ?
        `, [name, price, image_url, description, category, dish_id]);

        res.status(200).json({ message: "Mahsulot yangilandi" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Serverda xatolik yuz berdi!" });
    }
};

// Buyurtmalar bilan ishlash
const GET_ORDERS_OF_TABLE = async (req, res) => {
    const {table_number} = req.params;
    try {
        const [orders] = await pool.query(`
            SELECT menu.id, menu.image_url, menu.name, oi.price, oi.quantity, oi.portions 
            FROM orders AS o
            INNER JOIN order_items AS oi ON o.id = oi.order_id
            JOIN menu ON menu.id = oi.menu_id
            WHERE o.table_number = ? and o.status = ?;
            `,[table_number,"pending"]);
        res.status(200).json(orders);
    } catch (error) {
        res.status(500).json({ error: "Serverda xatolik yuz berdi!" });
    }
}

const POST_ORDER = async (req,res) => {
    try {
        const {table_number,total_amount,payment_method,items} = req.body;

        const query = `
            INSERT INTO orders (table_number, total_amount, payment_method)
            VALUES (?,?,?)
        `;

        let [result] = await pool.query(query,[table_number,total_amount,payment_method]);
        let order_id = result.insertId;

        const item_query = `
            INSERT INTO order_items (order_id, menu_id, quantity,price,portions)
            VALUES (?,?,?,?,?)
        `
        for (let item of items){
            await pool.query(item_query,[order_id,item.menu_id,item.quantity,item.price,item.portions]);
        }

        res.status(201).json({ 
            message: " ✅ Ordersga item qo'shildi!", 
            insertedId: result.insertId 
        });
    } catch (error) {
        res.status(400).json({
            error:"Xatolik yuz berdi"
        })
    }
}

const UPDATE_ORDER = async (req, res) => {
    const connection = await pool.getConnection(); // Get a dedicated connection
    try {
        const { table_number, total_amount, payment_method, items } = req.body;

        await connection.beginTransaction(); // 🔒 Start transaction

        // Step 1: Get order_id
        const [orderRows] = await connection.query(
            `SELECT id FROM orders WHERE table_number = ? AND status = 'pending'`,
            [table_number]
        );

        if (orderRows.length === 0) {
            await connection.rollback(); // ⛔ Revert if not found
            return res.status(404).json({ message: "❌ Buyurtma topilmadi!" });
        }

        const order_id = orderRows[0].id;

        // Step 2: Update orders table
        await connection.query(
            `UPDATE orders SET total_amount = ?, payment_method = ? WHERE id = ?`,
            [total_amount, payment_method, order_id]
        );

        // Step 3: Delete old items
        await connection.query(`DELETE FROM order_items WHERE order_id = ?`, [order_id]);

        // Step 4: Insert new items
        const item_query = `
            INSERT INTO order_items (order_id, menu_id, quantity, price, portions)
            VALUES (?, ?, ?, ?, ?)
        `;

        for (let item of items) {
            await connection.query(item_query, [
                order_id,
                item.menu_id,
                item.quantity,
                item.price,
                item.portions
            ]);
        }

        await connection.commit(); // ✅ Commit the transaction

        res.status(202).json({
            message: "✅ Buyurtma muvaffaqqiyatli yangilandi!",
            order_id
        });

    } catch (error) {
        await connection.rollback(); // ⛔ Rollback on any failure
        console.error("Xato:", error);
        res.status(500).json({ error: "❌ Xatolik yuz berdi, buyurtma saqlanmadi." });
    } finally {
        connection.release(); // Always release connection
    }
};

const CANCEL_ORDER = async (req, res) => {
    const connection = await pool.getConnection();

    try {
        const { table_number } = req.params;

        await connection.beginTransaction();

        // Step 1: Get the pending order ID for this table
        const [orderRows] = await connection.query(
            `SELECT id FROM orders WHERE table_number = ? AND status = 'pending'`,
            [table_number]
        );

        if (orderRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: "❌ Bekor qilinadigan buyurtma topilmadi." });
        }

        const order_id = orderRows[0].id;

        // Step 2: Delete order items
        await connection.query(
            `DELETE FROM order_items WHERE order_id = ?`,
            [order_id]
        );

        // Step 3: Delete the order itself
        await connection.query(
            `DELETE FROM orders WHERE id = ?`,
            [order_id]
        );

        await connection.commit();

        res.status(200).json({
            message: "✅ Buyurtma muvaffaqqiyatli bekor qilindi.",
            order_id
        });

    } catch (error) {
        await connection.rollback();
        console.error("Xato:", error);
        res.status(500).json({ error: "❌ Xatolik yuz berdi, buyurtma bekor qilinmadi." });
    } finally {
        connection.release();
    }
};

export default {
    GET,
    GET_BY_ID,
    GET_BY_CATEGORY,
    GET_ORDERS_OF_TABLE,
    POST_ORDER,
    POST,
    DELETE,
    PUT,
    UPDATE_ORDER,
    CANCEL_ORDER
}