---
paths:
  - "backend/**/*.js"
---

# Backend rules (Express 5 + Prisma + SQLite)

- Layering is router -> controller -> service -> prisma. Controllers never import Prisma; services own all queries. Don't collapse layers.
- New routers must be added to `backend/router/index.routers.js` as `{ url, funk }`. The `/api` prefix is added in `server.js`; do not include it in `url`.
- Controllers are classes with `async method(req, res, next)` and `try { ... } catch (error) { next(error) }`. Services are `export default new (class XService { ... })()`.
- Validate input with Joi in `utils/Joi.validation.js` (`Validators`). Route params and query values arrive as strings; coerce with `idInt` / `toIntId` before using as Prisma ids.
- Throw `new CustomError(message, statusCode, name)`. `ErrorHandler` reads `err.status`, not `err.statusCode`, so a thrown CustomError currently returns HTTP 500. Don't rely on the status code until that is fixed, and don't silently change the handler without checking renderer code that reads responses.
- Prisma `Decimal` fields come back as Decimal objects. Convert with `Number()` and round with `roundN` before returning JSON or doing arithmetic.
- Multi-step writes that touch stock, orders, payments or counters must use `prisma.$transaction`. Order numbers use `nextSeqTx(tx)` and must be generated inside the same transaction as the order insert.
- Prisma model accessors are camelCase singular (`prisma.order`, `prisma.recieptSettings`, `prisma.setting`, `prisma.user`). Not `prisma.settings` or `prisma.users`.
- Do not import anything from `backend/models/` (legacy Mongoose, dead code) or `backend/middleware/SetupGate.js` (broken, unused).
- User-facing messages returned by the API are Uzbek (Latin). Log messages and code are English.
- Bind to `127.0.0.1` only. Never listen on `0.0.0.0`.
- Never log passwords or full user records.
