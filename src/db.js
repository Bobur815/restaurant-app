
import mysql from 'mysql2/promise';
import dotenv from "dotenv"
import path from 'path';

dotenv.config({ path: path.resolve('C:/Users/user/Desktop/restaurant-app/.env') })

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});
export default pool;
