import MenuModel from "../models/Menu.model.js";

const getProductByMenuId = async (menuId) => {
  const product = await MenuModel.findById(menuId).lean();
  return product;
};
export default getProductByMenuId;