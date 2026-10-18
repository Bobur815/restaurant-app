import prisma from "../database/prisma.js";

const getProductByMenuId = async (menuId) => {
  const product = await prisma.menu.findUnique({
    where: { id: menuId },
  });
  return product;
};
export default getProductByMenuId;