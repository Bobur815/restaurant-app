import pool from '../../src/db.js';

const [rows] = await pool.query('SELECT * FROM menu');

const GET = async (req, res) => {
    res.json(rows);
}

const POST = async (req,res) => {

}

const DELETE = (req,res) => {

}

const PUT = (req,res) => {
    
}

export default {
    GET,
    POST,
    DELETE,
    PUT
}