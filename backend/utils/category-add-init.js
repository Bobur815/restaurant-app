import categoryService from "../service/Category.service.js";

export async function myInitFunction() {
    const categories = await categoryService.getAll()
    if (!categories.length) {
        const categories = ['Ovqatlar', 'Salatlar', 'Ichimliklar', 'Desertlar', 'Non mahsulotlari'];
        for (let category of categories) {
            await categoryService.create({ name: category })
        }
        return "✅ Kategoriyalar qo'shildi"
    }
}
