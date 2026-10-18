export async function categoryOptions(category, page) {
  const categories = await loadAllCategories()

  if (!page) {
    category.innerHTML += `<option value="all">Hammasi</option>`
  }
  for (let cat of categories) {
    
    category.innerHTML += `<option value="${cat.id}">${cat.name}</option>`
  }
}

export async function loadAllCategories() {
  try {
    const res = await fetch('http://localhost:3000/api/category');
    if (!res.ok) throw new Error(`Server xatosi: ${res.status}`);
    const categories = await res.json();
    return categories;
  } catch (err) {
    console.error('loadAllCategories error:', err);
    return [];  // yoki xatoni qaytarish / qayta tashlash
  }
}
