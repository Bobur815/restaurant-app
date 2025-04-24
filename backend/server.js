import express from 'express';
import cors from 'cors';
import router from "./router/router.js"

const PORT = 3000;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

app.use(router)

app.listen(PORT, () => console.log(`✅ Backend running at http://localhost:${PORT}`));
