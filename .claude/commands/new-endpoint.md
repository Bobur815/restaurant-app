---
description: Add a new API endpoint following the router/controller/service layering
argument-hint: <resource> <METHOD /path> <what it does>
---

Add a backend endpoint: $ARGUMENTS

Steps:

1. Read an existing vertical slice end to end as the template: `backend/router/order.router.js`, `backend/controller/Order.controller.js`, `backend/service/Order.service.js`. Also read the Prisma models involved in `backend/prisma/schema.prisma`.
2. Add the Joi validator to `backend/utils/Joi.validation.js` if the endpoint takes a body or query params.
3. Add the service method (all Prisma access lives here; use `prisma.$transaction` for multi-step writes; convert `Decimal` with `Number()`/`roundN`).
4. Add the controller method (`try/catch -> next(error)`, correct status code).
5. Add the route. If it's a new resource, create `backend/router/<name>.routes.js` and register `{ url, funk }` in `backend/router/index.routers.js`. Mind route order: `/:param` routes shadow literal paths declared after them.
6. Verify: start the backend alone (`cd backend && DATABASE_URL="file:./data/app.db" node server.js`) and exercise the endpoint with curl, including one invalid input. Report the exact commands and responses.

Do not touch `backend/models/` or `SetupGate.js`. User-facing messages in Uzbek.
