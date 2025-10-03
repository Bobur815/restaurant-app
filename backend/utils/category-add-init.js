import prisma from "../database/prisma.js";

export async function myInitFunction() {
    const categories = await prisma.category.findMany();
    if (!categories.length) {
        const categories = ['Ovqatlar', 'Salatlar', 'Ichimliklar', 'Desertlar', 'Non mahsulotlari'];
        for (let category of categories) {
            await prisma.category.create({ data: { name: category } });
        }
        return "✅ Kategoriyalar qo'shildi"
    }
}
