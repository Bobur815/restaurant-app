// backend/database/prisma.js
import { PrismaClient } from '@prisma/client';

// prevent creating many PrismaClient instances in dev mode (nodemon)
let prisma;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient();
} else {
  if (!global.prisma) {
    global.prisma = new PrismaClient();
  }
  prisma = global.prisma;
}

export default prisma;
