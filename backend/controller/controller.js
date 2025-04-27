import pool from '../../src/db.js';

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


// POST method - yangi ma'lumot qo'shish
const POST = async (req, res) => {
    try {
        const { name, price, image_url, description,category } = req.body;

        // Kiritilgan ma'lumotlarni tekshirish (oddiy validatsiya)
        if (!name || !price) {
            return res.status(400).json({ message: "Name va Price majburiy!" });
        }

        const query = `
            INSERT INTO menu (name, price, image_url, description,category)
            VALUES (?, ?, ?, ?,?)
        `;

        const [result] = await pool.query(query, [name, price, image_url, description,category]);

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


export default {
    GET,
    GET_BY_ID,
    GET_BY_CATEGORY,
    POST,
    DELETE,
    PUT
}